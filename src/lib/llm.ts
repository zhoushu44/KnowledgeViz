/** 内置大模型配置与流式调用（Electron 主进程代理，规避浏览器 CORS） */

export interface LlmConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
  maxTokens: number;
  /** 透传给接口的额外请求体字段（如关闭思维链、强制 JSON） */
  extraBody?: Record<string, unknown>;
  /** 是否流式返回（默认 true） */
  stream?: boolean;
  /**
   * 把 system 消息折叠进第一条 user 消息再发。
   * 内置代理会静默丢弃 system（实测 prompt_tokens 恒定、system 内容完全不参与），
   * 折叠后同样的提示词才能生效；对遵循 system 的接口也无害。
   */
  mergeSystemIntoUser?: boolean;
}

/**
 * 默认模型配置。
 * 接口地址与 key 通过构建期环境变量注入（Vite 的 VITE_ 前缀），不写死在源码里：
 *   VITE_KSB_LLM_BASE_URL   如 https://your-gateway.example.com/v1
 *   VITE_KSB_LLM_API_KEY    对应 key
 * 也可以在应用内「模型设置」里填（存 localStorage，优先生效）。
 */
export const DEFAULT_LLM: LlmConfig = {
  baseUrl: import.meta.env.VITE_KSB_LLM_BASE_URL ?? '',
  apiKey: import.meta.env.VITE_KSB_LLM_API_KEY ?? '',
  model: import.meta.env.VITE_KSB_LLM_MODEL ?? 'deepseek-v4-flash',
  temperature: 0.3,
  maxTokens: 4000,
  // 关掉内置思维链：否则大量 token 花在 reasoning 上，正文容易被截断
  extraBody: { chat_template_kwargs: { enable_thinking: false } },
  // 生成链路用非流式：代理对 SSE 的分块很慢，非流式整包返回反而更快
  stream: false,
  // 代理会丢弃 system 消息，必须折叠进 user
  mergeSystemIntoUser: true,
};

/** 设置弹窗可改的项（写 localStorage，不改内置默认值） */
export const LLM_PRESETS = [
  { label: 'deepseek-v4-flash（推荐 · 快）', model: 'deepseek-v4-flash' },
  { label: 'minimax-m3.1-flash（备用）', model: 'minimaxai/minimax-m3.1-flash' },
  { label: 'stepfun-5-preview（质量高 · 慢）', model: 'stepfun-ai/step-5-preview' },
  { label: 'z-ai/glm-5.3-flash', model: 'z-ai/glm-5.3-flash' },
];

const CFG_KEY = 'ksb.llm.v1';

export function loadLlmConfig(): LlmConfig {
  try {
    const raw = localStorage.getItem(CFG_KEY);
    if (!raw) return DEFAULT_LLM;
    return { ...DEFAULT_LLM, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_LLM;
  }
}

export function saveLlmConfig(cfg: LlmConfig) {
  try {
    localStorage.setItem(CFG_KEY, JSON.stringify(cfg));
  } catch {
    /* ignore */
  }
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatOptions {
  signal?: AbortSignal;
  /** 单次请求硬超时（毫秒），默认 120s */
  timeoutMs?: number;
  /** 是否流式（默认 true）。生成大段 YAML 时用 false 更快 */
  stream?: boolean;
  /** 覆盖本次调用的模型参数（token 预算等） */
  cfg?: LlmConfig;
  onDelta?: (text: string) => void;
  onReasoning?: (text: string) => void;
}

interface DesktopLlm {
  chat: (
    cfg: LlmConfig,
    messages: ChatMessage[],
    requestId: string
  ) => Promise<{ ok: boolean; text?: string; error?: string }>;
  onDelta: (cb: (m: { requestId: string; delta?: string; reasoning?: string; done?: boolean; error?: string }) => void) => () => void;
  cancel: (requestId: string) => Promise<{ ok: boolean }>;
}

declare global {
  interface Window {
    ksbLlm?: DesktopLlm;
  }
}

const desktopLlm = () => (typeof window !== 'undefined' ? window.ksbLlm : undefined);

let seq = 0;

/**
 * 把 system 指令折叠进首条 user 消息。
 * 有些 OpenAI 兼容代理会静默丢弃 system（实测输入 token 恒定、指令完全不生效），
 * 折叠后提示词才能到达模型；对正常接口无副作用（指令位置略变，语义不变）。
 */
export function foldSystem(messages: ChatMessage[]): ChatMessage[] {
  const sys = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n').trim();
  const rest = messages.filter((m) => m.role !== 'system');
  if (!sys) return rest;
  const firstUser = rest.findIndex((m) => m.role === 'user');
  if (firstUser < 0) return [{ role: 'user', content: sys }, ...rest];
  const merged: ChatMessage[] = [...rest];
  merged[firstUser] = { role: 'user', content: `${sys}\n\n${merged[firstUser].content}` };
  return merged;
}

/** 按配置决定是否折叠 system（默认折叠：内置代理需要） */
function prepareMessages(messages: ChatMessage[], cfg: LlmConfig): ChatMessage[] {
  return cfg.mergeSystemIntoUser === false ? messages : foldSystem(messages);
}

/** 流式对话：优先走桌面壳代理；浏览器直连（需服务端允许 CORS） */
export async function chat(messages: ChatMessage[], opts: ChatOptions = {}, cfgOverride?: LlmConfig): Promise<string> {
  const cfg = cfgOverride ?? opts.cfg ?? loadLlmConfig();
  const timeoutMs = opts.timeoutMs ?? 120_000;
  const ctl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; ctl.abort(); }, timeoutMs);
  const onOuterAbort = () => ctl.abort();
  opts.signal?.addEventListener('abort', onOuterAbort);
  try {
    return await chatInner(messages, { ...opts, signal: ctl.signal }, cfg);
  } catch (e: any) {
    // 区分「用户取消」和「我们自己的超时」，让上层能正确回退
    if (timedOut && !opts.signal?.aborted) {
      throw new Error(`模型响应超时（${Math.round(timeoutMs / 1000)}s）`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener('abort', onOuterAbort);
  }
}

async function chatInner(messages: ChatMessage[], opts: ChatOptions, cfg: LlmConfig): Promise<string> {
  const payloadMessages = prepareMessages(messages, cfg);
  const api = desktopLlm();
  if (api) {
    const requestId = `r${Date.now()}_${++seq}`;
    const off = api.onDelta((m) => {
      if (m.requestId !== requestId) return;
      if (m.delta) opts.onDelta?.(m.delta);
      if (m.reasoning) opts.onReasoning?.(m.reasoning);
    });
    const onAbort = () => void api.cancel(requestId);
    opts.signal?.addEventListener('abort', onAbort);
    try {
      const res = await api.chat({ ...cfg, stream: opts.stream !== false }, payloadMessages, requestId);
      if (!res.ok) throw new Error(res.error || '模型调用失败');
      return res.text ?? '';
    } finally {
      opts.signal?.removeEventListener('abort', onAbort);
      off();
    }
  }

  // 浏览器直连（无 CORS 时会失败，由上层降级）
  const res = await fetch(`${cfg.baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify({
      model: cfg.model,
      messages: payloadMessages,
      temperature: cfg.temperature,
      max_tokens: cfg.maxTokens,
      stream: opts.stream !== false,
      ...(cfg.extraBody ?? {}),
    }),
    signal: opts.signal,
  });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let out = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const parts = buf.split('\n');
    buf = parts.pop() ?? '';
    for (const line of parts) {
      const t = line.trim();
      if (!t.startsWith('data:')) continue;
      const payload = t.slice(5).trim();
      if (payload === '[DONE]') continue;
      try {
        const j = JSON.parse(payload);
        const d = j.choices?.[0]?.delta;
        if (d?.reasoning_content) opts.onReasoning?.(d.reasoning_content);
        if (d?.content) {
          out += d.content;
          opts.onDelta?.(d.content);
        }
      } catch {
        /* ignore malformed line */
      }
    }
  }
  return out;
}

/** 从模型输出里抽取 ```yaml 代码块（缺少围栏时退化为整段） */
export function extractYamlBlocks(text: string): string[] {
  const blocks: string[] = [];
  const re = /```ya?ml\s*\n([\s\S]*?)```/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) blocks.push(m[1].trim());
  if (!blocks.length) {
    const generic = /```\s*\n([\s\S]*?)```/g;
    while ((m = generic.exec(text))) blocks.push(m[1].trim());
  }
  if (!blocks.length && /^\s*(domain|dimensions|knowledge_points|relation_types|scenarios)\s*:/m.test(text)) {
    blocks.push(text.trim());
  }
  return blocks;
}
