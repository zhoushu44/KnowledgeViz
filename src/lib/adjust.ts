/**
 * 思维导图「说我不满意的地方，AI 去调整」的编辑引擎
 *
 *  - buildAdjustMessages：把当前知识树压成紧凑清单 + 编辑规则，交给模型
 *  - parseAdjustment：从模型输出里抽 JSON 编辑计划，并逐条校验（只认真实 id）
 *  - applyAdjustment：把编辑计划落到 Project 上，产出「预览结果 + 变更说明」
 *  - localAdjustment：模型不可用时的本地规则兜底（只处理明确的增删改移指令）
 *
 * 设计原则：AI 只出「计划」，落库前一定先算一遍预览给用户确认；应用后可一键撤回。
 */
import type { Edge, KnowledgePoint, Level, Project, ProjectIndex, Route } from './types';
import { chat, loadLlmConfig, type ChatMessage } from './llm';

export type NewLevel = Exclude<Level, 'root'>;

export type AdjustOp =
  | {
      kind: 'add';
      id?: string;
      parentId: string;
      name: string;
      nameEn?: string;
      definition?: string;
      description?: string;
      difficulty?: number;
      importance?: number;
      studyMinutes?: number;
      unit?: 'input' | 'process' | 'output';
    }
  | { kind: 'rename'; id: string; name: string; nameEn?: string }
  | {
      kind: 'update';
      id: string;
      definition?: string;
      description?: string;
      difficulty?: number;
      importance?: number;
      studyMinutes?: number;
      tags?: string[];
    }
  | { kind: 'move'; id: string; parentId: string }
  | { kind: 'remove'; id: string };

export interface AdjustmentPlan {
  reply: string;
  ops: AdjustOp[];
}

export interface AdjustmentResponse extends AdjustmentPlan {
  source: 'ai' | 'local';
  dropped: string[];
  raw: string;
}

export interface AdjustStep {
  kind: AdjustOp['kind'];
  /** 这一条的中文说明（未生效时为原因） */
  label: string;
  /** 是否真的改到了数据（比如改名成同名、移动到自己子树下 -> false） */
  ok: boolean;
}

export interface AdjustPreview {
  project: Project;
  lines: string[];
  counts: { add: number; rename: number; update: number; move: number; remove: number };
  /** 与入参 ops 一一对应的执行结果，供 UI 做逐条勾选 */
  steps: AdjustStep[];
  touched: string[];
  /** 需要连带展开的父节点（新增 / 移动的落点 + 它们的祖先） */
  expand: string[];
  /** 可能导致重新导入失败的结构性提醒 */
  warnings: string[];
}

const KIND_LABEL: Record<AdjustOp['kind'], string> = {
  add: '新增',
  rename: '改名',
  update: '修改',
  move: '移动',
  remove: '删除',
};

const NEXT_LEVEL: Record<string, NewLevel | undefined> = {
  root: 'L1',
  L1: 'L2',
  L2: 'L3',
  L3: 'L4',
};

const LEVEL_INDEX: Record<NewLevel, number> = { L1: 1, L2: 2, L3: 3, L4: 4 };
const LEVEL_BY_INDEX: NewLevel[] = ['L1', 'L2', 'L3', 'L4'];

const LEVEL_DIFFICULTY: Record<NewLevel, number> = { L1: 1, L2: 2, L3: 3, L4: 2 };

const clip = (v: unknown, max: number): string => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/** 生成纯 ASCII 的节点 id（不能用中文：YAML 引用与校验都按 id 走） */
function slugId(base: string, salt = 0): string {
  const clean = base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 24);
  return `${clean || 'node'}${salt ? `_${salt}` : ''}`;
}

/** 生成给模型看的紧凑树清单：L4 不逐条列，只报数量，避免上下文爆炸 */
export function treeOutline(project: Project, idx: ProjectIndex): string {
  const lines: string[] = [];
  const root = project.nodes.find((n) => !n.parent);
  if (!root) return '（空项目）';
  const walk = (n: KnowledgePoint, depth: number) => {
    if (n.level === 'L4') return;
    const pad = '  '.repeat(depth);
    const def = n.definition ? `｜${clip(n.definition, 34)}` : '';
    const kids = idx.children.get(n.id) ?? [];
    const l4 = kids.filter((k) => k.level === 'L4').length;
    const tail = l4 ? `（内含 ${l4} 个 L4 原子单元）` : '';
    lines.push(`${pad}${n.id} :: ${n.name} [${n.level}]${def}${tail}`);
    for (const k of kids) walk(k, depth + 1);
  };
  walk(root, 0);
  return lines.join('\n');
}

function systemPrompt(project: Project, idx: ProjectIndex, selectedId?: string | null): string {
  const selected = selectedId ? idx.byId.get(selectedId) : undefined;
  const selectedBlock = selected
    ? `\n用户当前选中的节点：${selected.id} :: ${selected.name} [${selected.level}]\n定义：${clip(selected.definition, 80)}\n描述：${clip(selected.description, 160)}\n（用户说「这个」「它」时多半指它）\n`
    : '';
  return `你是「知识体系可视化平台」思维导图页的编辑助手。用户在导图页看到 AI 生成的知识体系后提出不满，你要把不满翻译成一组**可执行的编辑操作**。

# 输出
只输出一个 JSON 对象，不要 markdown 代码围栏，不要任何解释文字：
{"reply":"一句话回应（≤60字，说明你打算怎么改）","ops":[...]}

# 可用操作
1) 新增节点
{"kind":"add","id":"可选：小写字母/数字/下划线，不填自动生成","parentId":"父节点 id","name":"名称","nameEn":"英文名","definition":"一句话定义（≤40字）","description":"展开说明（≤120字）"}
2) 改名
{"kind":"rename","id":"节点 id","name":"新名称","nameEn":"可选的新英文名"}
3) 修改内容
{"kind":"update","id":"节点 id","definition":"可选","description":"可选","difficulty":1}
4) 移动节点（换父节点，连子树一起移动）
{"kind":"move","id":"节点 id","parentId":"新父节点 id"}
5) 删除节点（连同其全部子节点）
{"kind":"remove","id":"节点 id"}

# 规则
- id 只能来自下面的知识树清单；add 的 parentId 也必须来自清单。禁止编造 id。
- 一次最多 24 个操作；只做用户明确要求的事，不要顺手大改。
- 「精简 / 太多 / 太杂」→ 用 remove 删掉最不相关的节点，或 rename 合并同类；「拆细 / 细化 / 不够具体」→ 在对应 L3 下 add 2–3 个 L4 原子单元（unit 依次 input / process / output）。
- add 的 id 形如 adj_xxx，不能与现有 id 重复。
- 用户指代不明（比如「这个分支」但没选中节点）时，ops 返回空数组，在 reply 里反问是哪一个。
- 布局、配色、字号不在可编辑范围；用户提这些时在 reply 里说明，并给一条可替代的内容建议。
- 不要为了凑数而增删；宁少勿滥。

# 当前项目
${project.name}（${project.category}）· ${project.nodes.length} 个节点 · ${project.branches.length} 个一级分支
${selectedBlock}
# 知识树清单（id :: 名称 [层级]｜定义）
${treeOutline(project, idx)}`;
}

/** 组装一次调整请求的消息（带最近几轮对话） */
export function buildAdjustMessages(
  project: Project,
  idx: ProjectIndex,
  text: string,
  history: { role: 'user' | 'assistant'; content: string }[] = [],
  selectedId?: string | null
): ChatMessage[] {
  const msgs: ChatMessage[] = [{ role: 'system', content: systemPrompt(project, idx, selectedId) }];
  for (const h of history.slice(-6)) msgs.push({ role: h.role, content: h.content });
  msgs.push({ role: 'user', content: text });
  return msgs;
}

function asNumber(v: unknown, min: number, max: number): number | undefined {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return undefined;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/** 校验模型给的原始 ops：只保留结构合法、id 真实、不越界的操作 */
export function normalizeOps(raw: unknown, project: Project): { ops: AdjustOp[]; dropped: string[] } {
  const ids = new Set(project.nodes.map((n) => n.id));
  const usedNew = new Set<string>();
  const dropped: string[] = [];
  const out: AdjustOp[] = [];
  const list = Array.isArray(raw) ? raw : [];
  for (const item of list.slice(0, 40)) {
    const r = item as Record<string, unknown>;
    const kind = String(r?.kind ?? '');
    const id = clip(r?.id, 64);
    if (kind === 'add') {
      const parentId = clip(r?.parentId, 64);
      const name = clip(r?.name, 40);
      const parent = project.nodes.find((n) => n.id === parentId);
      if (!name || !parent) {
        dropped.push(`新增「${name || '未命名'}」：父节点不存在`);
        continue;
      }
      if (parent.level === 'L4') {
        dropped.push(`新增「${name}」：「${parent.name}」已是 L4 原子单元，不能再往下加`);
        continue;
      }
      let newId = id && /^[a-z0-9_]+$/i.test(id) ? id.toLowerCase() : '';
      if (!newId || ids.has(newId) || usedNew.has(newId)) newId = `adj_${slugId(newId || name)}`;
      let salt = 1;
      while (ids.has(newId) || usedNew.has(newId)) newId = `adj_${slugId(name, salt++)}`;
      usedNew.add(newId);
      out.push({
        kind: 'add',
        id: newId,
        parentId,
        name,
        nameEn: clip(r?.nameEn, 80) || undefined,
        definition: clip(r?.definition, 200) || undefined,
        description: clip(r?.description, 400) || undefined,
        difficulty: asNumber(r?.difficulty, 1, 4),
        importance: asNumber(r?.importance, 0, 100),
        studyMinutes: asNumber(r?.studyMinutes ?? r?.study_minutes, 5, 600),
        unit: r?.unit === 'input' || r?.unit === 'process' || r?.unit === 'output' ? r.unit : undefined,
      });
      continue;
    }
    if (kind === 'rename') {
      const name = clip(r?.name, 40);
      if (!ids.has(id) || !name) {
        dropped.push(`改名：节点 ${id || '（空）'} 不存在或新名称为空`);
        continue;
      }
      out.push({ kind: 'rename', id, name, nameEn: clip(r?.nameEn, 80) || undefined });
      continue;
    }
    if (kind === 'update') {
      if (!ids.has(id)) {
        dropped.push(`修改：节点 ${id || '（空）'} 不存在`);
        continue;
      }
      const patch: AdjustOp & { kind: 'update' } = { kind: 'update', id };
      const def = clip(r?.definition, 200);
      const desc = clip(r?.description, 400);
      if (def) patch.definition = def;
      if (desc) patch.description = desc;
      const diff = asNumber(r?.difficulty, 1, 4);
      if (diff !== undefined) patch.difficulty = diff;
      const imp = asNumber(r?.importance, 0, 100);
      if (imp !== undefined) patch.importance = imp;
      const mins = asNumber(r?.studyMinutes ?? r?.study_minutes, 5, 600);
      if (mins !== undefined) patch.studyMinutes = mins;
      if (Array.isArray(r?.tags)) patch.tags = (r.tags as unknown[]).map((t) => clip(t, 20)).filter(Boolean).slice(0, 8);
      if (Object.keys(patch).length <= 2) {
        dropped.push(`修改「${id}」：没有给出任何要改的字段`);
        continue;
      }
      out.push(patch);
      continue;
    }
    if (kind === 'move') {
      const parentId = clip(r?.parentId, 64);
      if (!ids.has(id) || !ids.has(parentId) || id === parentId) {
        dropped.push(`移动：${id || '（空）'} → ${parentId || '（空）'} 无效`);
        continue;
      }
      out.push({ kind: 'move', id, parentId });
      continue;
    }
    if (kind === 'remove') {
      if (!ids.has(id) || project.nodes.find((n) => n.id === id)?.level === 'root') {
        dropped.push(`删除：${id || '（空）'} 不存在或为根节点`);
        continue;
      }
      out.push({ kind: 'remove', id });
      continue;
    }
    dropped.push(`未知操作：${kind || '（空）'}`);
  }
  // 同一个节点只保留最后一次「改名 / 修改」，避免同一条消息里反复覆盖
  const seen = new Map<string, number>();
  const unique: AdjustOp[] = [];
  for (const op of out) {
    if (op.kind === 'rename' || op.kind === 'update') {
      const key = `${op.kind}:${op.id}`;
      const prev = seen.get(key);
      if (prev !== undefined) unique[prev] = op;
      else {
        seen.set(key, unique.length);
        unique.push(op);
      }
    } else if (op.kind === 'remove') {
      if (unique.some((o) => o.kind === 'remove' && o.id === op.id)) continue;
      unique.push(op);
    } else {
      unique.push(op);
    }
  }
  return { ops: unique, dropped };
}

function extractJson(text: string): Record<string, unknown> | null {
  // 模型有时会把思维链一起吐出来，所以只看「像编辑计划」的对象：带 ops / reply
  const fenced = [...text.matchAll(/```(?:json)?\s*\n([\s\S]*?)```/gi)].map((m) => m[1]);
  for (const src of [...fenced, text]) {
    const direct = tryParse(src);
    if (direct && Array.isArray(direct.ops)) return direct;

    // 从每个 { 开始做括号配对，命中第一个含 "ops" 的完整对象
    for (let i = 0; i < src.length; i++) {
      if (src[i] !== '{') continue;
      let depth = 0;
      let inStr = false;
      let esc = false;
      for (let j = i; j < src.length; j++) {
        const ch = src[j];
        if (inStr) {
          if (esc) esc = false;
          else if (ch === '\\') esc = true;
          else if (ch === '"') inStr = false;
          continue;
        }
        if (ch === '"') inStr = true;
        else if (ch === '{') depth++;
        else if (ch === '}') {
          depth--;
          if (depth === 0) {
            const raw = src.slice(i, j + 1);
            if (raw.includes('"ops"')) {
              const parsed = tryParse(raw);
              if (parsed && Array.isArray(parsed.ops)) return parsed;
            }
            break;
          }
        }
      }
    }
  }
  return null;
}

function tryParse(s: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(s.trim());
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** 调模型拿编辑计划；模型不可用/输出不可解析时抛错，由调用方决定是否走本地兜底 */
export async function requestAdjustment(args: {
  project: Project;
  idx: ProjectIndex;
  text: string;
  history?: { role: 'user' | 'assistant'; content: string }[];
  selectedId?: string | null;
  signal?: AbortSignal;
}): Promise<AdjustmentResponse> {
  const messages = buildAdjustMessages(args.project, args.idx, args.text, args.history, args.selectedId);
  // 编辑计划是小输出任务：限住 max_tokens + 强制 JSON，避免长篇解释
  const cfg = loadLlmConfig();
  const raw = await chat(
    messages,
    { signal: args.signal, stream: false, timeoutMs: 120_000 },
    {
      ...cfg,
      temperature: 0.2,
      maxTokens: Math.min(cfg.maxTokens, 2500),
      extraBody: { ...(cfg.extraBody ?? {}), response_format: { type: 'json_object' } },
    }
  );
  const json = extractJson(raw);
  if (!json) throw new Error('模型没有返回可解析的修改计划');
  const { ops, dropped } = normalizeOps(json.ops, args.project);
  return {
    reply: clip(json.reply ?? json.summary, 200) || (ops.length ? '按你的要求调整如下：' : '没太理解要改哪里，可以说得更具体一点。'),
    ops,
    dropped,
    raw,
    source: 'ai',
  };
}

function findNodeByName(project: Project, raw: string): KnowledgePoint[] {
  const name = raw
    .replace(/[「」“”"'《》]/g, '')
    .replace(/(这个|那个|该|它的|的)?(节点|知识点|分支|子分支|子树|下面|底下)/g, '')
    .replace(/^(请|帮我|麻烦|把|将|在|给|对)/, '')
    .replace(/(都|全部|一起|下|里|中)$/g, '')
    .trim();
  if (!name) return [];
  const exact = project.nodes.filter((n) => n.name === name);
  if (exact.length) return exact;
  return project.nodes.filter((n) => n.name.includes(name) || (n.nameEn ?? '').toLowerCase() === name.toLowerCase());
}

/** id 是否在 rootId 的子树里（含间接子节点，不含自身） */
function isUnder(project: Project, id: string, rootId: string): boolean {
  const byId = new Map(project.nodes.map((n) => [n.id, n]));
  let cur = byId.get(id);
  let guard = 0;
  while (cur?.parent && guard++ < 50) {
    if (cur.parent === rootId) return true;
    cur = byId.get(cur.parent);
  }
  return false;
}

/**
 * 本地规则兜底：只认「改名 / 删除 / 新增 / 移动 / 拆细 / 精简」这几类明确指令。
 * 命中不了就返回 null，绝不猜。
 */
export function localAdjustment(text: string, project: Project, selectedId?: string | null): AdjustmentResponse | null {
  const t = text.replace(/\s+/g, ' ').trim();
  const mk = (reply: string, ops: AdjustOp[]): AdjustmentResponse => ({ reply, ops, dropped: [], raw: t, source: 'local' });
  const selected = selectedId ? project.nodes.find((n) => n.id === selectedId) : undefined;
  const pick = (fragment: string): KnowledgePoint[] => {
    const cleaned = fragment.replace(/[「」“”"'《》]/g, '').replace(/^(这个|那个|该|它)/, '').trim();
    if (cleaned) return findNodeByName(project, cleaned);
    return selected ? [selected] : [];
  };
  const kidsOf = (id: string) => project.nodes.filter((n) => n.parent === id);

  // 拆细：把一个 L3 方法补成 input / process / output 三个 L4 原子单元
  if (/(拆细|拆开|细化|展开|拆成|拆解|再细一点|不够细)/.test(t)) {
    const target = pick(/(?:把|将)?\s*[「“"]?([^」”"，。；,;]{1,24}?)[」”"]?\s*(?:这个|那个)?(?:节点|分支|方法)?\s*(?:再)?(?:拆细|拆开|细化|展开|拆成|拆解)/.exec(t)?.[1] ?? '');
    const node = target.length === 1 ? target[0] : undefined;
    if (node && node.level === 'L3') {
      const has = new Set(kidsOf(node.id).map((k) => k.unit));
      const units: ['input' | 'process' | 'output', string, string][] = [
        ['input', '输入识别', `明确「${node.name}」要处理的输入对象、前置条件与边界，列成可核对的清单。`],
        ['process', '处理步骤', `按「${node.name}」的标准步骤推进，逐步记录中间产物，异常时先定位再继续。`],
        ['output', '输出检验', `产出「${node.name}」的交付物，并用验收标准逐项检查是否达标。`],
      ];
      const ops: AdjustOp[] = units
        .filter(([unit]) => !has.has(unit))
        .map(([unit, label, def]) => ({
          kind: 'add' as const,
          parentId: node.id,
          name: `${node.name}·${label}`,
          definition: def.slice(0, 60),
          description: `${def} 属于「${node.name}」的三段式原子单元（${label}）。`,
          unit,
        }));
      if (ops.length) return mk(`把「${node.name}」按输入识别 / 处理步骤 / 输出检验拆成 ${ops.length} 个原子单元。`, ops);
      return mk(`「${node.name}」已经有三段式原子单元了，不用再拆。`, []);
    }
    // 选了 L1/L2：把它下面还缺三段式的 L3 方法一起补齐
    if (node && (node.level === 'L1' || node.level === 'L2')) {
      const l3s = project.nodes.filter((n) => n.level === 'L3' && isUnder(project, n.id, node.id));
      const ops: AdjustOp[] = [];
      for (const l3 of l3s) {
        const has = new Set(kidsOf(l3.id).map((k) => k.unit));
        const labels: ['input' | 'process' | 'output', string][] = [['input', '输入识别'], ['process', '处理步骤'], ['output', '输出检验']];
        for (const [unit, label] of labels) {
          if (has.has(unit)) continue;
          ops.push({
            kind: 'add',
            parentId: l3.id,
            name: `${l3.name}·${label}`,
            definition: `${l3.name}的${label}：${unit === 'input' ? '确认输入对象、前置条件与边界' : unit === 'process' ? '按标准步骤推进并记录中间产物' : '产出交付物并按标准验收'}`,
            unit,
          });
        }
      }
      if (ops.length) return mk(`「${node.name}」下有 ${l3s.length} 个方法，补齐了三段式原子单元（${ops.length} 个）。`, ops.slice(0, 24));
      return mk(`「${node.name}」下的方法都已经有三段式原子单元了。`, []);
    }
    if (!node) return mk('要拆细哪个节点？在导图上点一下它，或者直接说节点全名。', []);
    return mk(`「${node.name}」已经是 L4 原子单元，不能再往下拆；可以改成补充它的定义或示例。`, []);
  }

  // 精简：去掉某个节点下的全部 L4 原子单元
  if (/(精简|太细|去掉原子单元|删掉 ?L4|删掉原子|只要两?级|压缩层级)/i.test(t)) {
    const target = pick(/(?:把|将)?\s*[「“"]?([^」”"，。；,;]{1,24}?)[」”"]?\s*(?:这个|那个)?(?:分支|节点|方法)?\s*(?:精简|压缩)/.exec(t)?.[1] ?? '');
    const node = target.length === 1 ? target[0] : undefined;
    if (node) {
      const l4 = project.nodes.filter((n) => n.level === 'L4' && isUnder(project, n.id, node.id));
      if (l4.length) return mk(`删掉「${node.name}」下的 ${l4.length} 个 L4 原子单元，图层回到方法级。`, l4.map((n) => ({ kind: 'remove' as const, id: n.id })));
    }
    if (!node) return mk('要精简哪一块？点一下导图上的节点，或说节点全名。', []);
  }

  let m = /(?:把|将)?\s*([^，。；,;]{1,24}?)\s*(?:改名为|更名|改名|改叫|改成|换成|改为)\s*[「“"]?([^」”"，。；,;]{1,40}?)[」”"]?\s*(?:吧|呢)?\s*$/i.exec(t);
  if (m) {
    const hit = findNodeByName(project, m[1]);
    const nextName = m[2].replace(/^[为成作到]\s*/, '').replace(/[「」“”"']/g, '').trim();
    if (hit.length === 1 && nextName) return mk(`已把「${hit[0].name}」改名为「${nextName}」。`, [{ kind: 'rename', id: hit[0].id, name: nextName }]);
    if (hit.length > 1) return mk(`「${m[1]}」匹配到 ${hit.length} 个节点，说全名我再改。`, []);
  }

  m = /(?:删除|删掉|去掉|移除|干掉)\s*[「“"]?([^」”"，。；,;]{1,30}?)[」”"]?\s*(?:节点|分支|知识点|这一块)?\s*$/i.exec(t);
  if (m) {
    const hit = findNodeByName(project, m[1]);
    if (hit.length === 1) return mk(`已删除「${hit[0].name}」及其子节点。`, [{ kind: 'remove', id: hit[0].id }]);
    if (hit.length > 1) return mk(`「${m[1]}」匹配到 ${hit.length} 个节点，说全名我再删。`, []);
  }

  m = /(?:把|将)?\s*([^，。；,;]{1,24}?)\s*(?:移到|移动到|挪到|放到|挂到)\s*[「“"]?([^」”"，。；,;]{1,30}?)[」”"]?\s*(?:下|下面|底下|里面)?\s*$/i.exec(t);
  if (m) {
    const a = findNodeByName(project, m[1]);
    const b = findNodeByName(project, m[2]);
    if (a.length === 1 && b.length === 1) return mk(`已把「${a[0].name}」移到「${b[0].name}」下面。`, [{ kind: 'move', id: a[0].id, parentId: b[0].id }]);
  }

  m = /(?:在|给)\s*[「“"]?([^」”"，。；,;]{1,30}?)[」”"]?\s*(?:下|下面|底下)?\s*(?:新增|添加|加|补充|补)\s*[「“"]?([^」”"，。；,;]{1,40}?)[」”"]?\s*(?:节点|子节点|知识点)?\s*$/i.exec(t);
  if (m) {
    const parent = findNodeByName(project, m[1]);
    const name = m[2].replace(/[「」“”"']/g, '').trim();
    if (parent.length === 1 && name) return mk(`已在「${parent[0].name}」下新增「${name}」。`, [{ kind: 'add', parentId: parent[0].id, name }]);
  }

  return null;
}

/** 把编辑计划落到项目上（纯函数，不改入参），同时生成可读的变更说明 */
export function applyAdjustment(project: Project, ops: AdjustOp[]): AdjustPreview {
  let nodes: KnowledgePoint[] = project.nodes.map((n) => ({
    ...n,
    tags: [...n.tags],
    dimensions: { ...n.dimensions },
    prerequisites: [...n.prerequisites],
  }));
  let byId = new Map(nodes.map((n) => [n.id, n]));
  const lines: string[] = [];
  const counts = { add: 0, rename: 0, update: 0, move: 0, remove: 0 };
  const touched: string[] = [];
  const expand: string[] = [];
  let seq = 0;

  const kidsOf = (id: string) => nodes.filter((n) => n.parent === id);
  const collect = (id: string) => {
    const out: string[] = [];
    const walk = (pid: string) => kidsOf(pid).forEach((k) => { out.push(k.id); walk(k.id); });
    walk(id);
    return out;
  };
  const freshId = () => {
    let id = '';
    do id = `adj_${++seq}`; while (byId.has(id));
    return id;
  };

  const steps: AdjustStep[] = ops.map((op) => ({
    kind: op.kind,
    label: `${KIND_LABEL[op.kind]}：待执行`,
    ok: false,
  }));

  // 删除放最后：同一批里「先移走再删父节点」这类组合才能按预期生效
  const ordered: { op: AdjustOp; at: number }[] = [
    ...ops.map((op, at) => ({ op, at })).filter(({ op }) => op.kind !== 'remove'),
    ...ops.map((op, at) => ({ op, at })).filter(({ op }) => op.kind === 'remove'),
  ];

  const done = (at: number, label: string) => {
    steps[at] = { kind: ops[at].kind, label, ok: true };
    lines.push(label);
  };
  const fail = (at: number, label: string) => {
    steps[at] = { kind: ops[at].kind, label: `${label}（未生效）`, ok: false };
  };

  for (const { op, at } of ordered) {
    if (op.kind === 'add') {
      const parent = byId.get(op.parentId);
      if (!parent) { fail(at, `新增「${op.name}」：父节点不存在`); continue; }
      const level: NewLevel = NEXT_LEVEL[parent.level] ?? 'L4';
      const id = op.id && !byId.has(op.id) ? op.id : freshId();
      const node: KnowledgePoint = {
        id,
        name: op.name,
        nameEn: op.nameEn,
        level,
        branch: parent.branch,
        parent: parent.id,
        definition: op.definition || `${op.name}：${parent.name}下的${level}知识点。`,
        description: op.description || `${op.name}的具体做法、适用边界与判断标准，是「${parent.name}」向下拆解出的一层内容。`,
        difficulty: op.difficulty ?? LEVEL_DIFFICULTY[level],
        importance: op.importance ?? Math.max(40, parent.importance - 6),
        centrality: Math.min(90, Math.max(30, parent.centrality - 5)),
        studyMinutes: op.studyMinutes ?? (level === 'L4' ? 30 : 45),
        tags: [parent.name, level === 'L4' ? 'L4原子单元' : 'AI调整'],
        dimensions: { ...parent.dimensions },
        prerequisites: level === 'L1' ? [] : [parent.id],
        unit: level === 'L4' ? op.unit : undefined,
        assembleNote: level === 'L4' ? `以「${parent.name}」为直接前导` : undefined,
        examples: [],
        resources: [],
      };
      nodes.push(node);
      byId.set(id, node);
      counts.add++;
      touched.push(id);
      expand.push(parent.id);
      done(at, `新增「${op.name}」→ 挂在「${parent.name}」下`);
      continue;
    }
    if (op.kind === 'rename') {
      const node = byId.get(op.id);
      if (!node) { fail(at, '改名：节点不存在'); continue; }
      const old = node.name;
      if (old === op.name) { fail(at, `改名「${old}」：新名称与原来相同`); continue; }
      node.name = op.name;
      if (op.nameEn) node.nameEn = op.nameEn;
      // L3 改名时，同步它下面 L4 的「X·输入识别」前缀
      const prefix = `${old}·`;
      for (const k of kidsOf(node.id)) {
        if (k.name.startsWith(prefix)) k.name = `${op.name}·${k.name.slice(prefix.length)}`;
      }
      counts.rename++;
      touched.push(node.id);
      done(at, `改名「${old}」→「${op.name}」`);
      continue;
    }
    if (op.kind === 'update') {
      const node = byId.get(op.id);
      if (!node) { fail(at, '修改：节点不存在'); continue; }
      const fields: string[] = [];
      if (op.definition && op.definition !== node.definition) { node.definition = op.definition; fields.push('定义'); }
      if (op.description && op.description !== node.description) { node.description = op.description; fields.push('描述'); }
      if (op.difficulty !== undefined && op.difficulty !== node.difficulty) { node.difficulty = op.difficulty; fields.push('难度'); }
      if (op.importance !== undefined && op.importance !== node.importance) { node.importance = op.importance; fields.push('重要度'); }
      if (op.studyMinutes !== undefined && op.studyMinutes !== node.studyMinutes) { node.studyMinutes = op.studyMinutes; fields.push('学习时长'); }
      if (op.tags?.length) { node.tags = op.tags; fields.push('标签'); }
      if (!fields.length) { fail(at, `修改「${node.name}」：内容与原来一致`); continue; }
      counts.update++;
      touched.push(node.id);
      done(at, `修改「${node.name}」的 ${fields.join(' / ')}`);
      continue;
    }
    if (op.kind === 'move') {
      const node = byId.get(op.id);
      const parent = byId.get(op.parentId);
      if (!node) { fail(at, '移动：节点不存在'); continue; }
      if (!parent) { fail(at, '移动：目标父节点不存在'); continue; }
      if (node.level === 'root') { fail(at, '移动：根节点不能移动'); continue; }
      const descendants = new Set(collect(node.id));
      if (parent.id === node.id || descendants.has(parent.id)) { fail(at, `移动「${node.name}」：不能移到自己的子树里`); continue; }
      if (parent.level === 'L4') { fail(at, `移动「${node.name}」：「${parent.name}」是 L4 原子单元`); continue; }
      node.parent = parent.id;
      // 换父节点后按新的深度重算整棵子树的层级（最深到 L4）
      const baseIdx = LEVEL_INDEX[NEXT_LEVEL[parent.level] ?? 'L4'];
      const relevel = (n: KnowledgePoint, depth: number) => {
        n.level = LEVEL_BY_INDEX[Math.min(3, baseIdx - 1 + depth)];
        for (const k of kidsOf(n.id)) relevel(k, depth + 1);
      };
      relevel(node, 0);
      // 换分支时整棵子树跟着换色
      const branch = parent.branch;
      const repaint = (n: KnowledgePoint) => {
        n.branch = branch;
        for (const k of kidsOf(n.id)) repaint(k);
      };
      repaint(node);
      counts.move++;
      touched.push(node.id);
      expand.push(parent.id);
      done(at, `移动「${node.name}」→「${parent.name}」下`);
      continue;
    }
    if (op.kind === 'remove') {
      const node = byId.get(op.id);
      if (!node) { fail(at, '删除：节点不存在'); continue; }
      if (node.level === 'root') { fail(at, '删除：根节点不能删除'); continue; }
      const kids = collect(node.id);
      const parentId = node.parent;
      const kill = new Set([node.id, ...kids]);
      done(at, `删除「${node.name}」${kids.length ? `（含 ${kids.length} 个子节点）` : ''}`);
      counts.remove++;
      nodes = nodes.filter((n) => !kill.has(n.id));
      for (const id of kill) byId.delete(id);
      if (parentId) touched.push(parentId);
    }
  }

  // 引用清理：前导指向已删除节点的一律去掉
  for (const n of nodes) n.prerequisites = n.prerequisites.filter((p) => byId.has(p) && p !== n.id);

  // 边重建：前导依赖 + 组成包含
  const edges: Edge[] = [];
  const seenEdge = new Set<string>();
  const addEdge = (edge: Edge) => {
    const key = `${edge.type}|${edge.from}|${edge.to}`;
    if (seenEdge.has(key)) return;
    seenEdge.add(key);
    edges.push(edge);
  };
  for (const n of nodes) for (const p of n.prerequisites) addEdge({ from: p, to: n.id, type: 'depends' });
  for (const n of nodes) if (n.parent && byId.has(n.parent)) addEdge({ from: n.parent, to: n.id, type: 'contains' });

  // 路线里引用的节点同步剔除，nodeCount 重算
  const routes: Route[] = project.routes.map((r) => {
    const stages = r.stages.map((s) => ({ ...s, nodes: s.nodes.filter((id) => byId.has(id)) }));
    return { ...r, stages, nodeCount: stages.reduce((sum, s) => sum + s.nodes.length, 0) };
  });

  // 结构性提醒：这些规则导入时会被校验卡住，提前告诉用户
  const warnings: string[] = [];
  const bareBranches = project.branches.filter(
    (b) => !nodes.some((n) => n.branch === b.id && n.level === 'L4')
  );
  if (bareBranches.length) warnings.push(`「${bareBranches.map((b) => b.name).join('、')}」已没有 L4 原子单元，再导入会被校验提示`);
  if (nodes.length < 30) warnings.push(`节点只剩 ${nodes.length} 个（少于 30），重新导入时会被判为「节点过少」`);

  return {
    project: {
      ...project,
      nodes,
      edges,
      routes,
      stats: { nodes: nodes.length, edges: edges.length, branches: project.branches.length },
      updatedAt: new Date().toISOString(),
    },
    lines,
    counts,
    steps,
    touched: [...new Set(touched)].filter((id) => byId.has(id)),
    expand: [...new Set(expand)].filter((id) => byId.has(id)),
    warnings,
  };
}

export function countText(counts: AdjustPreview['counts']): string {
  return (Object.keys(KIND_LABEL) as AdjustOp['kind'][])
    .filter((k) => counts[k] > 0)
    .map((k) => `${KIND_LABEL[k]} ${counts[k]}`)
    .join(' · ');
}

export function kindLabel(kind: AdjustOp['kind']): string {
  return KIND_LABEL[kind];
}

/** 变更前快照（用于撤回） */
export interface ProjectSnapshot {
  nodes: KnowledgePoint[];
  edges: Edge[];
  routes: Route[];
  stats: Project['stats'];
}

export function snapshotOf(p: Project): ProjectSnapshot {
  return { nodes: p.nodes, edges: p.edges, routes: p.routes, stats: p.stats };
}
