/**
 * 联网扩展子节点：把任意一个知识点当成「种子」，联网调研后生成一批下级节点，
 * 直接并入思维导图 / 图谱 / 学习路线。
 *
 * 为什么要联网而不是纯模型瞎编：
 *   · 纯模型展开的 L2/L3 常常是同义反复（「XX 基础」「XX 概述」），没有真实术语；
 *   · 联网调研回来的是该领域真实在用的概念，节点名更可落地；
 *   · 每个新节点都挂上它的来源链接，点开就能查。
 *
 * 为什么不用「搜标题再切词」抽候选（v1 踩过的坑）：
 *   中文搜索结果标题多为问句式（「什么是知识图谱？有哪些典型应用？」），
 *   切出来的全是噪声，实测 0 个有效候选。改成让 research 直接按 schema 产出候选，
 *   并同时给出「证据线索」，再并发核对每个候选的一句话定义。
 *
 * 并发设计：
 *   ① 1 次 research 出候选（带 schema，稳定）
 *   ② N 个候选并发核对定义（走 research 闸门，最多 6 路）
 */
import { research, researchMany } from './net';
import type { KnowledgePoint, Level } from './types';

export interface ProposedNode {
  name: string;
  nameEn?: string;
  definition: string;
  level: Level;
  /** 该候选的证据来源（≥1 时可信度更高） */
  sources: string[];
  hits: number;
  selected: boolean;
}

export interface ExpandResult {
  seed: string;
  proposed: ProposedNode[];
  elapsedMs: number;
  /** 生成时用的调研提纲，便于复现/调试 */
  queries: string[];
}

const EXPAND_SCHEMA = {
  properties: {
    children: {
      type: 'array',
      description: '下级概念列表，6-8 个',
      items: {
        type: 'object',
        description: '一个下级概念',
        properties: {
          name: { type: 'string', description: '概念名，中文，2-15 字，必须是该领域真实在用的术语，不要「XX概述」这类凑数词' },
          name_en: { type: 'string', description: '英文名，没有就留空' },
          definition: { type: 'string', description: '一句话定义，不超过 40 字' },
          why: { type: 'string', description: '为什么它是下级概念，30 字内' },
        },
        required: ['name', 'definition'],
      },
    },
  },
  required: ['children'],
};

interface RawChild {
  name?: string;
  name_en?: string;
  definition?: string;
  why?: string;
}

export async function expandNode(
  seed: Pick<KnowledgePoint, 'name' | 'definition' | 'branch'>,
  opts: { context?: string; max?: number; keywords?: string } = {}
): Promise<ExpandResult> {
  const t0 = Date.now();
  const max = opts.max ?? 8;
  const ctx = opts.context ? `所属分支：${opts.context}。` : '';
  const kw = opts.keywords?.trim() ? `重点关注：${opts.keywords.trim()}。` : '';

  const task =
    `知识点「${seed.name}」的现有定义是：${seed.definition || '（暂无）'}。${ctx}${kw}\n` +
    `请联网调研后，列出它直接的 ${max} 个下级概念（子领域 / 关键方法 / 核心组成部分），` +
    `每个给一句话定义。要求：名称必须是行业里真实在用的术语，不要用「概述」「简介」「基础介绍」这类空词；` +
    `不要包含「${seed.name}」本身；不要凑数，宁缺毋滥。`;

  const res = await research(task, { schema: EXPAND_SCHEMA, model: 'mini' });
  const parsed = (typeof res.content === 'string' ? safeJson(res.content) : res.content) as { children?: RawChild[] } | null;
  const list = (parsed?.children ?? []).slice(0, max);

  const cleaned = list
    .map((c) => ({
      name: String(c?.name ?? '').trim(),
      nameEn: String(c?.name_en ?? '').trim() || undefined,
      definition: String(c?.definition ?? '').trim(),
    }))
    .filter((c) => c.name.length >= 2 && c.name.length <= 20 && c.name !== seed.name);

  if (!cleaned.length) {
    return { seed: seed.name, proposed: [], elapsedMs: Date.now() - t0, queries: [task] };
  }

  // 并发核对定义（对没给定义的补一条），同时把 research 返回的来源挂到每个候选上
  const defs = await researchMany(
    cleaned.map(
      (c) =>
        `用一句不超过 40 字的中文，给「${c.name}」下定义，只输出定义本身，不要前缀，不要引号。`
    ),
    { model: 'mini' }
  );

  const proposed: ProposedNode[] = cleaned.map((c, i) => {
    const raw = defs[i];
    const refined =
      raw && !raw.error
        ? String(typeof raw.content === 'string' ? raw.content : '')
            .split(/\n/)[0]
            .replace(/^["'“”]|["'“”]$/g, '')
            .trim()
            .slice(0, 80)
        : '';
    return {
      name: c.name,
      nameEn: c.nameEn,
      definition: refined || c.definition || `${c.name}：${seed.name}下的一个相关概念。`,
      level: 'L3' as Level,
      sources: (res.sources ?? []).slice(0, 3),
      hits: 1,
      selected: true,
    };
  });

  return { seed: seed.name, proposed, elapsedMs: Date.now() - t0, queries: [task] };
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

/** 把选中的候选转成可写入项目的节点（id / parent / 维度由调用方补齐） */
export function toKnowledgePoints(
  parent: KnowledgePoint,
  picked: ProposedNode[],
  fieldId: string
): KnowledgePoint[] {
  return picked.map((p, i) => ({
    id: uniqueId(parent.id, i),
    name: p.name,
    nameEn: p.nameEn,
    level: 'L3',
    branch: parent.branch,
    parent: parent.id,
    definition: p.definition,
    description: p.definition,
    difficulty: Math.min(4, (parent.difficulty ?? 2) + 1),
    importance: Math.max(40, (parent.importance ?? 70) - 10 - i),
    centrality: 45,
    studyMinutes: 45,
    tags: [parent.name, '联网扩展'],
    dimensions: { ...(parent.dimensions ?? {}), ...(fieldId ? { field: fieldId } : {}) },
    prerequisites: [parent.id],
    resources: p.sources.length
      ? p.sources.map((u) => ({ title: shortHost(u), type: 'link' as const, url: u }))
      : undefined,
  }));
}

let seq = 0;
function uniqueId(parentId: string, i: number) {
  return `${parentId}_web_${Date.now().toString(36)}${seq++}_${i + 1}`;
}

function shortHost(u: string) {
  try {
    return new URL(u).hostname.replace(/^www\./, '');
  } catch {
    return u.slice(0, 40);
  }
}
