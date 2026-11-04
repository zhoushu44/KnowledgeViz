/**
 * 内置联网调研（渲染层封装）
 *
 * 全部能力都在 Electron 主进程（electron/net.cjs）里跑，这里只做类型 + 降级：
 *   · 桌面版：走 window.ksbNet（IPC）
 *   · 浏览器预览：直接 throw，由页面提示「请用桌面版」
 *
 * 并发模型（与主进程闸门一致）：
 *   search / extract → 16 路并发
 *   research        → 6 路并发（实测 8 路上限，留余量）
 * 页面层可以一次提交几十条，闸门会自己排队。
 */

export interface SearchHit {
  title: string;
  url: string;
  content: string;
  score: number;
  published: string;
  domain: string;
}

export interface SearchBundle {
  query: string;
  results: SearchHit[];
  answer: string;
  responseTime?: number;
  error?: string;
}

export interface ExtractRow {
  url: string;
  title?: string;
  chars: number;
  content: string;
  error?: string;
}

export interface SourceDetail {
  url: string;
  title: string;
}

export interface ResearchResult {
  task?: string;
  content: string | Record<string, unknown>;
  /** 已拍平的 URL 字符串数组（网关原始返回是 {url,title,favicon} 对象数组） */
  sources: string[];
  sourceDetail?: SourceDetail[];
  requestId: string;
  elapsedMs: number;
  error?: string;
}

export type Verdict = 'true' | 'false' | 'uncertain';
export type JudgeStatus = 'decided' | 'disputed' | 'abstained' | 'failed';

export interface JudgeResult {
  claim: string;
  verdict: Verdict;
  /** 票型后验置信度（不是模型自报值） */
  confidence: number;
  /** 模型自报置信度，仅作对照 */
  rawConfidence?: number;
  agreement: number;
  votes: Partial<Record<Verdict, number>>;
  samples: number;
  failedSamples?: number;
  reason: string;
  evidence: string[];
  status: JudgeStatus;
  mode?: 'fast' | 'deep';
  elapsedMs?: number;
}

export interface NetTick {
  jobId: string;
  phase: string;
  requestId?: string;
  elapsedMs?: number;
  task?: string;
  claim?: string;
}

interface DesktopNet {
  search: (queries: string[], opts?: Record<string, unknown>) => Promise<SearchBundle[]>;
  extract: (urls: string[], opts?: Record<string, unknown>) => Promise<ExtractRow[]>;
  research: (task: string, opts?: Record<string, unknown>) => Promise<ResearchResult>;
  researchMany: (tasks: string[], opts?: Record<string, unknown>) => Promise<ResearchResult[]>;
  judge: (claim: string, opts?: Record<string, unknown>) => Promise<JudgeResult>;
  judgeMany: (claims: string[], opts?: Record<string, unknown>) => Promise<JudgeResult[]>;
  onTick: (cb: (t: NetTick) => void) => () => void;
}

declare global {
  interface Window {
    ksbNet?: DesktopNet;
  }
}

const api = () => (typeof window !== 'undefined' ? window.ksbNet : undefined);

export const netAvailable = () => Boolean(api());

export function onNetTick(cb: (t: NetTick) => void): () => void {
  return api()?.onTick(cb) ?? (() => {});
}

function need() {
  const a = api();
  if (!a) throw new Error('联网调研需要桌面版（Electron）；浏览器预览模式不可用');
  return a;
}

export async function searchMany(queries: string[], opts: { maxResults?: number; depth?: string; topic?: string; days?: number; domains?: string[] } = {}) {
  return need().search(queries, opts);
}

export async function extractMany(urls: string[], opts: { batch?: number; maxChars?: number } = {}) {
  return need().extract(urls, opts);
}

export async function research(task: string, opts: { model?: string; schema?: unknown } = {}) {
  return need().research(task, opts);
}

export async function researchMany(tasks: string[], opts: { model?: string } = {}) {
  return need().researchMany(tasks, opts);
}

export async function stableJudge(claim: string, opts: { samples?: number; mode?: 'fast' | 'deep' } = {}) {
  return need().judge(claim, opts);
}

export async function judgeMany(claims: string[], opts: { samples?: number; mode?: 'fast' | 'deep' } = {}) {
  return need().judgeMany(claims, opts);
}

/** 置信度分档（基于实测：3/3 = 0.80 已是「高」） */
export function confidenceTier(c: number): { label: string; color: string; note: string } {
  if (c >= 0.78) return { label: '高', color: 'var(--success)', note: '票型一致，可作为结论' };
  if (c >= 0.6) return { label: '中', color: 'var(--warning)', note: '存在分歧，建议加票或换角度复核' };
  return { label: '低', color: 'var(--danger)', note: '证据不足，不要当结论使用' };
}

export const VERDICT_META: Record<Verdict, { icon: string; text: string; color: string }> = {
  true: { icon: '✅', text: '真', color: 'var(--success)' },
  false: { icon: '❌', text: '假', color: 'var(--danger)' },
  uncertain: { icon: '❓', text: '不确定', color: 'var(--text-3)' },
};

export const STATUS_NOTE: Record<JudgeStatus, string> = {
  decided: '一致率高，结论可用',
  disputed: '票数分裂，不建议直接采信',
  abstained: '判为 uncertain，证据不足（不等于假）',
  failed: '采样全部失败，检查网络后重试',
};
