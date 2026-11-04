/**
 * AI 学习路线：让模型 + 联网资料给现有节点重排一条「学得动」的顺序。
 *
 * 为什么需要：本地生成的学习路线是按「L1→L2→L3→L4 + 分支顺序」机械分段的，
 * 分支之间的先后、L3 之间的依赖并不是真的按「先学什么后学什么」排的。
 * 这里让模型按「前置依赖 + 认知难度 + 该领域主流学习路径」重排，并用联网资料校准。
 *
 * 并发设计：
 *   ① 3 个角度并发 search（学习路径 / 课程大纲 / 新手常见顺序）
 *   ② 一次 research（带 schema）产出阶段划分
 *   ③ 结果做严格校验：只允许引用真实存在的节点 id，缺的阶段自动补齐
 */
import { searchMany, research, netAvailable } from './net';
import type { KnowledgePoint, Project, Route } from './types';

export interface AiRouteResult {
  route: Route;
  /** 模型给的排序理由（每个阶段一句） */
  rationale: { stage: string; why: string }[];
  sources: string[];
  elapsedMs: number;
  /** 真实联网了没（离线时为 false，仅模型排序） */
  webUsed: boolean;
}

const ROUTE_SCHEMA = {
  properties: {
    stages: {
      type: 'array',
      description: '3-4 个学习阶段，按先后顺序',
      items: {
        type: 'object',
        description: '一个学习阶段',
        properties: {
          name: { type: 'string', description: '阶段名，如「打基础」「核心方法」「实战」' },
          why: { type: 'string', description: '为什么这个阶段排在这里，一句话' },
          layer: { type: 'string', description: '主要层级：L1 / L2 / L3 / L4' },
          node_ids: {
            type: 'array',
            items: { type: 'string' },
            description: '该阶段的节点 id 列表，必须来自给定清单',
          },
        },
        required: ['name', 'node_ids'],
      },
    },
    summary: { type: 'string', description: '一句话说明这条路线适合谁' },
  },
  required: ['stages'],
};

/** 把节点压缩成「id 名称」清单，控制 prompt 长度 */
function nodeList(nodes: KnowledgePoint[], cap = 90): string {
  const picked = nodes.slice(0, cap);
  return picked.map((n) => `${n.id}\t${n.name}\t${n.level}`).join('\n');
}

export async function aiBuildRoute(
  project: Project,
  opts: { routeId?: string; level?: Route['level']; maxNodes?: number; signal?: AbortSignal } = {}
): Promise<AiRouteResult> {
  const level = opts.level ?? 'advanced';

  // 整体超时 + 异常兜底：无论 research 报错还是卡住，都要在 100s 内给出可用结果。
  // （之前只有 race 超时分支，inner 抛错会直接 reject，用户什么也拿不到）
  let timer: ReturnType<typeof setTimeout> | null = null;
  const fallback = (why: string): AiRouteResult => {
    const nodes = project.nodes.filter((n) => n.level !== 'root');
    const stages = localTopoStages(nodes);
    return {
      route: {
        id: opts.routeId ?? `route_ai_${Date.now().toString(36)}`,
        name: `${project.name.replace(/知识体系$/, '')}AI 学习路线`,
        level,
        description: `${why}，已按前置依赖与层级自动排序（可重试获得 AI 版本）`,
        nodeCount: stages.reduce((a, s) => a + s.nodes.length, 0),
        stages,
      },
      rationale: stages.map((s) => ({ stage: s.name, why: `按「${s.layer}」层级与前置依赖排序` })),
      sources: [],
      elapsedMs: 0,
      webUsed: false,
    };
  };

  try {
    return await Promise.race([
      aiBuildRouteInner(project, { ...opts, level }),
      new Promise<AiRouteResult>((resolve) => {
        timer = setTimeout(() => resolve(fallback('AI 响应超时（100s）')), 100_000);
      }),
    ]);
  } catch (e: any) {
    // 网关 401 / 上游 key 掉线 / 网络错误 → 本地兜底，而不是抛给用户
    return fallback(`联网调研不可用（${String(e?.message ?? e).slice(0, 60)}）`);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function aiBuildRouteInner(
  project: Project,
  opts: { routeId?: string; level?: Route['level']; maxNodes?: number; signal?: AbortSignal } = {}
): Promise<AiRouteResult> {
  const t0 = Date.now();
  const base = project.routes.find((r) => r.id === opts.routeId) ?? project.routes[0];

  // 参与重排的节点：有层级的全部（去掉 root），太多时按重要性抽样
  const pool = project.nodes
    .filter((n) => n.level !== 'root')
    .sort((a, b) => (b.importance ?? 0) - (a.importance ?? 0));
  const cap = opts.maxNodes ?? 90;
  const nodes = pool.length <= cap ? pool.slice().sort(byLevelThenBranch(project)) : sampleEvenly(pool, cap);

  const validIds = new Set(nodes.map((n) => n.id));
  const level = opts.level ?? base?.level ?? 'advanced';

  // ---------- 联网校准 ----------
  let webBrief = '';
  let sources: string[] = [];
  const webUsed = netAvailable();
  if (webUsed) {
    try {
      const bundles = await Promise.race([
        searchMany(
          [
            `${project.name} 学习路线 学习顺序 入门到进阶`,
            `${project.name} 课程大纲 教学顺序 知识模块`,
            `${project.name} 新手 常见误区 先学什么`,
          ],
          { maxResults: 5, depth: 'advanced' }
        ),
        new Promise<any[]>((_, rej) => setTimeout(() => rej(new Error('联网检索超时')), 25_000)),
      ]);
      const lines: string[] = [];
      const seen = new Set<string>();
      for (const b of bundles) {
        for (const h of b.results ?? []) {
          if (!h.url || seen.has(h.url)) continue;
          seen.add(h.url);
          sources.push(h.url);
          lines.push(`- ${h.title}：${String(h.content ?? '').slice(0, 90)}`);
          if (lines.length >= 12) break;
        }
        if (lines.length >= 12) break;
      }
      webBrief = lines.join('\n');
    } catch {
      /* 联网失败不阻断，退化为纯模型排序 */
    }
  }

  const targetHint =
    level === 'beginner'
      ? '这条路线面向零基础，前两阶段必须只放 L1/L2，不要过早出现 L4 原子单元。'
      : level === 'expert'
        ? '这条路线面向已有基础的人，可以跳过入门概念，聚焦 L3 方法与 L4 原子单元。'
        : '这条路线要覆盖从基础到前沿的完整路径。';

  const task =
    `为「${project.name}」重排一条可执行的学习路线。\n` +
    `领域描述：${project.description}\n` +
    `${targetHint}\n\n` +
    (webBrief ? `以下是联网检索到的该领域学习路径参考，请据此校准先后顺序：\n${webBrief}\n\n` : '') +
    `可用的知识点清单（id \t 名称 \t 层级），**只能使用这些 id**：\n${nodeList(nodes)}\n\n` +
    `要求：\n` +
    `1. 分成 3-4 个阶段，按「先学什么后学什么」的真实顺序排；\n` +
    `2. 每个阶段给 name（4-8 字）和 why（一句话说明为什么排在这里）；\n` +
    `3. node_ids 必须是上面清单里出现过的 id，不要编造；\n` +
    `4. 前导依赖必须先出现（如果 B 依赖 A，A 要在前面的阶段）；\n` +
    `5. 覆盖尽可能多的节点，不要漏掉 L1 全部节点。`;

  const res = await research(task, { schema: ROUTE_SCHEMA, model: 'mini' });
  const parsed = (typeof res.content === 'string' ? safeJson(res.content) : res.content) as {
    stages?: { name?: string; why?: string; layer?: string; node_ids?: string[] }[];
    summary?: string;
  } | null;

  const rawStages = Array.isArray(parsed?.stages) ? parsed!.stages! : [];

  // 模型没给出有效结构（schema 失败/超时/上游 key 掉线）→ 本地按依赖拓扑排序兜底，
  // 保证「点了 AI 重排」永远有可用的结果，而不是让用户等 4 分钟后看到报错。
  if (!rawStages.length) {
    const fallback = localTopoStages(nodes);
    return {
      route: {
        id: opts.routeId ?? `route_ai_${Date.now().toString(36)}`,
        name: `${project.name.replace(/知识体系$/, '')}AI 学习路线`,
        level,
        description: 'AI 未返回有效结构，已按前置依赖与层级自动排序（建议重试以获得联网版本）',
        nodeCount: fallback.reduce((a, s) => a + s.nodes.length, 0),
        stages: fallback,
      },
      rationale: fallback.map((s) => ({ stage: s.name, why: `按「${s.layer}」层级与前置依赖排序` })),
      sources: sources.slice(0, 6),
      elapsedMs: Date.now() - t0,
      webUsed,
    };
  }

  // ---------- 校验与修补 ----------
  const used = new Set<string>();
  const stages: Route['stages'] = [];
  const rationale: { stage: string; why: string }[] = [];

  for (const s of rawStages.slice(0, 5)) {
    const ids = (s.node_ids ?? []).map(String).filter((id) => validIds.has(id) && !used.has(id));
    if (!ids.length) continue;
    for (const id of ids) used.add(id);
    const name = String(s.name ?? '').trim() || `阶段 ${stages.length + 1}`;
    stages.push({ name, layer: String(s.layer ?? 'L2'), nodes: ids });
    rationale.push({ stage: name, why: String(s.why ?? '').trim() });
  }

  // 模型漏掉的节点：按层级补到最后一个阶段，避免节点凭空消失
  const missing = nodes.filter((n) => !used.has(n.id));
  if (missing.length) {
    if (stages.length) {
      stages[stages.length - 1].nodes.push(...missing.map((n) => n.id));
    } else {
      stages.push({ name: '全部知识点', layer: 'L2', nodes: missing.map((n) => n.id) });
    }
  }

  // 依赖顺序修正：若 B 依赖 A 但 B 在前，把 A 提到 B 所在阶段
  const stageOf = new Map<string, number>();
  stages.forEach((s, i) => s.nodes.forEach((id) => stageOf.set(id, i)));
  for (let pass = 0; pass < 3; pass++) {
    let moved = false;
    for (const n of nodes) {
      const si = stageOf.get(n.id);
      if (si === undefined) continue;
      for (const pre of n.prerequisites) {
        const pi = stageOf.get(pre);
        if (pi !== undefined && pi > si) {
          // A 在更后面的阶段 → 把 A 拉到 B 的阶段
          stages[pi].nodes = stages[pi].nodes.filter((id) => id !== pre);
          stages[si].nodes.unshift(pre);
          stageOf.set(pre, si);
          moved = true;
        }
      }
    }
    if (!moved) break;
  }
  const cleaned = stages.filter((s) => s.nodes.length > 0);

  const route: Route = {
    id: opts.routeId ?? `route_ai_${Date.now().toString(36)}`,
    name: `${project.name.replace(/知识体系$/, '')}AI 学习路线`,
    level,
    description: String(parsed?.summary ?? '').trim() || '按前置依赖与认知难度重排的学习顺序',
    nodeCount: cleaned.reduce((a, s) => a + s.nodes.length, 0),
    stages: cleaned,
  };

  return { route, rationale, sources: sources.slice(0, 6), elapsedMs: Date.now() - t0, webUsed };
}

function byLevelThenBranch(project: Project) {
  const order: Record<string, number> = { L1: 0, L2: 1, L3: 2, L4: 3 };
  const bOrder = new Map(project.branches.map((b, i) => [b.id, i]));
  return (a: KnowledgePoint, b: KnowledgePoint) =>
    (order[a.level] ?? 2) - (order[b.level] ?? 2) || (bOrder.get(a.branch) ?? 0) - (bOrder.get(b.branch) ?? 0);
}

function sampleEvenly<T>(list: T[], cap: number): T[] {
  const step = list.length / cap;
  return Array.from({ length: cap }, (_, i) => list[Math.floor(i * step)]);
}

/**
 * 本地兜底排序：按层级分阶段 + 阶段内按前置依赖拓扑排序。
 * 这不是「AI 结果」，只是保证功能可用；UI 会标注「未返回有效结构」。
 */
function localTopoStages(nodes: KnowledgePoint[]): Route['stages'] {
  const order: Record<string, number> = { L1: 0, L2: 1, L3: 2, L4: 3 };
  const groups: Record<string, KnowledgePoint[]> = { L1: [], L2: [], L3: [], L4: [] };
  for (const n of nodes) (groups[n.level] ?? groups.L4).push(n);

  const names: Record<string, string> = {
    L1: '建立全局认知',
    L2: '核心子领域',
    L3: '关键方法',
    L4: '落地原子单元',
  };

  const out: Route['stages'] = [];
  const seen = new Set<string>();
  for (const lvl of ['L1', 'L2', 'L3', 'L4']) {
    const list = groups[lvl];
    if (!list.length) continue;
    // 拓扑：前置在同一批里就先排前面
    const pending = new Set(list.map((n) => n.id));
    const ordered: string[] = [];
    const byId = new Map(list.map((n) => [n.id, n]));
    let guard = 0;
    while (pending.size && guard++ < 500) {
      let progressed = false;
      for (const n of list) {
        if (!pending.has(n.id)) continue;
        const blockers = n.prerequisites.filter((p) => pending.has(p));
        if (blockers.length === 0) {
          ordered.push(n.id);
          pending.delete(n.id);
          progressed = true;
        }
      }
      if (!progressed) {
        // 有环：把剩下的按名字顺序补齐，避免死循环
        for (const id of [...pending]) {
          ordered.push(id);
          pending.delete(id);
        }
      }
    }
    void byId;
    for (const id of ordered) seen.add(id);
    out.push({ name: names[lvl], layer: lvl, nodes: ordered });
  }
  return out;
}

function safeJson(text: string): any {
  const s = String(text ?? '').trim().replace(/^```(?:json)?|```$/gm, '').trim();
  for (const cand of [s, s.match(/\{[\s\S]*\}/)?.[0]].filter(Boolean) as string[]) {
    try {
      return JSON.parse(cand);
    } catch {
      try {
        return JSON.parse(cand.replace(/([{,]\s*)([A-Za-z_]\w*)\s*:/g, '$1"$2":').replace(/,\s*([}\]])/g, '$1'));
      } catch {
        /* next */
      }
    }
  }
  return null;
}
