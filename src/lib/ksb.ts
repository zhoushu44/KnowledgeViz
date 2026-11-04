/**
 * KSB-YAML 五文件解析 / 校验 / 序列化
 * 规范见需求文档 §6，字段名与 YAML 原文一一对应（snake_case）
 */
import * as yaml from 'js-yaml';
import type {
  Branch, Category, Dimension, Edge, KnowledgePoint, Layer, Project, RelationTypeId, Route,
} from './types';

export const BUNDLE_FILES = [
  'domain.yaml',
  'dimensions.yaml',
  'knowledge_points.yaml',
  'relation_types.yaml',
  'scenarios.yaml',
] as const;

export type BundleName = (typeof BUNDLE_FILES)[number];

export interface ValidationIssue {
  file: string;
  message: string;
  line?: number;
}

export interface ParseResult {
  ok: boolean;
  project?: Project;
  issues: ValidationIssue[];
}

const CATEGORIES: Category[] = ['学科知识', '行业工作', '通用知识'];

/** 在原始文本里定位某个 `id: xxx` 所在行，用于行号级报错 */
function lineOfId(content: string | undefined, id: string): number | undefined {
  if (!content) return undefined;
  const lines = content.split(/\r?\n/);
  const re = new RegExp(`^\\s*-?\\s*id:\\s*["']?${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']?\\s*$`);
  const idx = lines.findIndex((l) => re.test(l));
  return idx >= 0 ? idx + 1 : undefined;
}

const asArray = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const str = (v: unknown, fallback = '') => (typeof v === 'string' ? v : fallback);

function normalizeNode(raw: any): KnowledgePoint {
  return {
    id: str(raw?.id),
    name: str(raw?.name),
    nameEn: str(raw?.name_en ?? raw?.nameEn),
    level: (raw?.level ?? 'L3') as KnowledgePoint['level'],
    branch: str(raw?.branch),
    parent: str(raw?.parent) || undefined,
    definition: str(raw?.definition),
    description: str(raw?.description ?? raw?.definition),
    difficulty: Math.round(num(raw?.difficulty, 2)),
    importance: Math.round(num(raw?.importance, 70)),
    centrality: Math.round(num(raw?.centrality, 50)),
    studyMinutes: Math.round(num(raw?.study_minutes ?? raw?.studyMinutes, 30)),
    tags: asArray<string>(raw?.tags).map((t) => String(t)),
    dimensions: (raw?.dimensions ?? {}) as Record<string, string | string[]>,
    prerequisites: asArray<string>(raw?.prerequisites).map(String),
    unit: raw?.unit,
    assembleNote: raw?.assemble_note ?? raw?.assembleNote,
    composeTo: asArray<string>(raw?.compose_to ?? raw?.composeTo).map(String),
    examples: asArray<string>(raw?.examples).map(String),
    resources: asArray<any>(raw?.resources).map((r) => ({
      title: str(r?.title),
      type: (r?.type === 'book' || r?.type === 'course' ? r.type : 'link') as 'book' | 'link' | 'course',
      url: r?.url,
    })),
    learning: raw?.learning
      ? {
          goals: asArray<string>(raw.learning.goals).map(String),
          sections: asArray<any>(raw.learning.sections).map((x) => ({ title: str(x?.title), body: str(x?.body) })),
          practice: raw.learning.practice ? str(raw.learning.practice) : undefined,
          pitfalls: asArray<string>(raw.learning.pitfalls).map(String),
          further: asArray<string>(raw.learning.further).map(String),
          source: raw.learning.source,
          updatedAt: raw.learning.updated_at ?? raw.learning.updatedAt,
        }
      : undefined,
  };
}

/** 五文件 → 内部 Project 模型 + 校验 */
export function parseBundle(
  files: Record<string, string>,
  fallbackName = '导入的知识体系',
  opts: { loose?: boolean } = {}
): ParseResult {
  const loose = Boolean(opts.loose);
  const issues: ValidationIssue[] = [];

  for (const f of BUNDLE_FILES) {
    if (!files[f] || !files[f].trim()) {
      issues.push({ file: f, message: `缺少 ${f}` });
    }
  }
  if (issues.length) return { ok: false, issues };

  const docs: Partial<Record<BundleName, any>> = {};
  for (const f of BUNDLE_FILES) {
    try {
      docs[f] = yaml.load(files[f]);
    } catch (e: any) {
      const line = Number(/line (\d+)/.exec(String(e?.message))?.[1]);
      issues.push({ file: f, message: `解析失败：${String(e?.message).split('\n')[0]}`, line });
    }
  }
  if (issues.length) return { ok: false, issues };

  const domainDoc = docs['domain.yaml']?.domain ?? docs['domain.yaml'] ?? {};
  const branchesRaw = asArray<any>(domainDoc?.branches);
  const layersRaw = asArray<any>(domainDoc?.layers);
  const dimsRaw = asArray<any>(docs['dimensions.yaml']?.dimensions);
  const kpRaw = asArray<any>(docs['knowledge_points.yaml']?.knowledge_points);
  const routeRaw = asArray<any>(docs['scenarios.yaml']?.scenarios);

  const branches: Branch[] = branchesRaw.map((b) => ({
    id: str(b?.id),
    name: str(b?.name),
    nameEn: str(b?.name_en ?? b?.nameEn),
    color: str(b?.color, '#2E4A9E'),
  }));
  const layers: Layer[] = (layersRaw.length
    ? layersRaw
    : [
        { id: 'L1', name: '核心理论基础' },
        { id: 'L2', name: '关键技术与方法' },
        { id: 'L3', name: '系统与工程' },
        { id: 'L4', name: '前沿与实战' },
      ]
  ).map((l) => ({ id: str(l?.id), name: str(l?.name) }));

  const dimensions: Dimension[] = dimsRaw.map((d) => ({
    id: str(d?.id),
    name: str(d?.name),
    role: (d?.role ?? 'filter') as Dimension['role'],
    values: asArray<any>(d?.values).map((v) => ({ id: str(v?.id), name: str(v?.name), color: v?.color })),
  }));

  const nodes: KnowledgePoint[] = kpRaw.map(normalizeNode);

  // ---- 校验规则（§6.6）----
  if (branches.length < 5) issues.push({ file: 'domain.yaml', message: `分支数 ${branches.length} 不足（需 ≥ 5）` });
  if (nodes.length < 30) issues.push({ file: 'knowledge_points.yaml', message: `节点数 ${nodes.length} 过少，无法构成体系（需 ≥ 30）` });

  const seen = new Map<string, number>();
  const branchIds = new Set(branches.map((b) => b.id));
  const nodeIds = new Set<string>();
  // YAML 里节点维度常用短键（stage / field / ability），dimensions.yaml 里是 dim_stage / dim_field …
  // 这里同时建立「全名」与「去掉 dim_ 前缀的短名」两套索引，两种写法都能对上
  const dimValueIds = new Set<string>();
  for (const d of dimensions) {
    const short = d.id.replace(/^dim_/, '');
    for (const v of d.values) {
      dimValueIds.add(`${d.id}:${v.id}`);
      dimValueIds.add(`${short}:${v.id}`);
    }
  }

  nodes.forEach((n, i) => {
    const line = lineOfId(files['knowledge_points.yaml'], n.id) ?? i + 1;
    if (!n.id) issues.push({ file: 'knowledge_points.yaml', message: `第 ${line} 行：节点缺少 id`, line });
    const key = n.id.toLowerCase();
    if (seen.has(key)) {
      issues.push({ file: 'knowledge_points.yaml', message: `id 重复：${n.id}（第 ${line} 行，另见第 ${seen.get(key)} 行）`, line });
    } else {
      seen.set(key, line);
    }
    nodeIds.add(n.id);
    if (!branchIds.has(n.branch)) issues.push({ file: 'knowledge_points.yaml', message: `第 ${line} 行：引用了不存在的分支 ${n.branch}`, line });
    if (n.difficulty < 1 || n.difficulty > 4) issues.push({ file: 'knowledge_points.yaml', message: `第 ${line} 行：难度超出范围（${n.difficulty}）`, line });
    if (n.importance < 0 || n.importance > 100) issues.push({ file: 'knowledge_points.yaml', message: `第 ${line} 行：重要度超出范围（${n.importance}）`, line });
    if (n.centrality < 0 || n.centrality > 100) issues.push({ file: 'knowledge_points.yaml', message: `第 ${line} 行：枢纽度超出范围（${n.centrality}）`, line });
    if (!loose) {
      for (const [dimId, val] of Object.entries(n.dimensions)) {
        for (const v of Array.isArray(val) ? val : [val]) {
          if (!dimValueIds.has(`${dimId}:${v}`)) {
            issues.push({ file: 'knowledge_points.yaml', message: `第 ${line} 行：节点「${n.name}」引用了不存在的维度值 ${dimId}/${v}`, line });
          }
        }
      }
    }
  });

  nodes.forEach((n, i) => {
    const line = lineOfId(files['knowledge_points.yaml'], n.id) ?? i + 1;
    if (n.parent && !nodeIds.has(n.parent)) issues.push({ file: 'knowledge_points.yaml', message: `第 ${line} 行：父节点 ${n.parent} 不存在`, line });
    for (const p of n.prerequisites) {
      if (!nodeIds.has(p)) issues.push({ file: 'knowledge_points.yaml', message: `第 ${line} 行：前导 ${p} 不存在`, line });
    }
    if (!loose && n.level === 'L4' && n.prerequisites.length === 0 && n.parent) {
      issues.push({ file: 'knowledge_points.yaml', message: `L4 节点 ${n.id} 无前导`, line });
    }
  });

  // depends 环路检测
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const state = new Map<string, 0 | 1 | 2>();
  const stack: string[] = [];
  const cycle = (id: string): string[] | null => {
    const s = state.get(id) ?? 0;
    if (s === 1) {
      const from = stack.indexOf(id);
      return [...stack.slice(from), id];
    }
    if (s === 2) return null;
    state.set(id, 1);
    stack.push(id);
    for (const p of byId.get(id)?.prerequisites ?? []) {
      if (!byId.has(p)) continue;
      const hit = cycle(p);
      if (hit) return hit;
    }
    stack.pop();
    state.set(id, 2);
    return null;
  };
  for (const n of nodes) {
    const hit = cycle(n.id);
    if (hit) {
      issues.push({ file: 'knowledge_points.yaml', message: `检测到前导依赖成环：${hit.map((id) => byId.get(id)?.name ?? id).join(' → ')}` });
      break;
    }
  }

  // 每个分支至少 1 个 L4
  if (!loose) {
    for (const b of branches) {
      if (!nodes.some((n) => n.branch === b.id && n.level === 'L4')) {
        issues.push({ file: 'knowledge_points.yaml', message: `分支「${b.name}」没有原子单元（L4）` });
      }
    }
  }

  const edges: Edge[] = [];
  for (const n of nodes) {
    for (const p of n.prerequisites) edges.push({ from: p, to: n.id, type: 'depends' });
  }
  for (const n of nodes) {
    if (n.parent) edges.push({ from: n.parent, to: n.id, type: 'contains' });
  }

  const routes: Route[] = routeRaw.map((r) => {
    const stages = asArray<any>(r?.stages).map((s) => ({
      name: str(s?.name),
      layer: str(s?.layer, 'L1'),
      nodes: asArray<string>(s?.nodes).map(String).filter((id) => nodeIds.has(id)),
    }));
    const count = stages.reduce((s, st) => s + st.nodes.length, 0);
    return {
      id: str(r?.id),
      name: str(r?.name),
      level: (r?.level ?? 'intermediate') as Route['level'],
      description: str(r?.description),
      nodeCount: num(r?.node_count ?? r?.nodeCount, count),
      stages,
    };
  });
  for (const r of routeRaw) {
    for (const e of asArray<any>(r?.edges)) {
      if (nodeIds.has(str(e?.from)) && nodeIds.has(str(e?.to))) {
        edges.push({ from: str(e?.from), to: str(e?.to), type: (e?.type ?? 'depends') as RelationTypeId });
      }
    }
  }

  if (issues.length) return { ok: false, issues };

  const now = new Date().toISOString();
  const project: Project = {
    id: str(domainDoc?.id) || `import_${Date.now().toString(36)}`,
    name: str(domainDoc?.name) || fallbackName,
    nameEn: str(domainDoc?.name_en ?? domainDoc?.nameEn),
    category: CATEGORIES.includes(domainDoc?.category) ? domainDoc.category : '通用知识',
    description: str(domainDoc?.description),
    createdAt: str(domainDoc?.created_at ?? domainDoc?.createdAt, now),
    updatedAt: now,
    stats: {
      nodes: nodes.length,
      edges: edges.length,
      branches: branches.length,
    },
    branches,
    layers,
    dimensions,
    nodes,
    edges,
    routes,
  };
  return { ok: true, project, issues: [] };
}

/** 内部模型 → 五文件 YAML 文本 */
export function serializeProject(p: Project): Record<BundleName, string> {
  const domain = {
    domain: {
      id: p.id,
      name: p.name,
      name_en: p.nameEn,
      category: p.category,
      description: p.description,
      version: '1.0.0',
      created_at: p.createdAt,
      stats: p.stats,
      layers: p.layers,
      branches: p.branches.map((b) => ({ id: b.id, name: b.name, name_en: b.nameEn, color: b.color })),
    },
  };
  const kps = p.nodes.map((n) => ({
    id: n.id,
    name: n.name,
    name_en: n.nameEn,
    level: n.level,
    branch: n.branch,
    parent: n.parent,
    definition: n.definition,
    description: n.description,
    difficulty: n.difficulty,
    importance: n.importance,
    centrality: n.centrality,
    study_minutes: n.studyMinutes,
    tags: n.tags,
    dimensions: n.dimensions,
    unit: n.unit,
    prerequisites: n.prerequisites,
    assemble_note: n.assembleNote,
    compose_to: n.composeTo?.length ? n.composeTo : undefined,
    examples: n.examples?.length ? n.examples : undefined,
    resources: n.resources?.length ? n.resources : undefined,
    learning: n.learning
      ? {
          goals: n.learning.goals,
          sections: n.learning.sections,
          practice: n.learning.practice,
          pitfalls: n.learning.pitfalls,
          further: n.learning.further,
          source: n.learning.source,
          updated_at: n.learning.updatedAt,
        }
      : undefined,
  }));
  const scenarios = p.routes.map((r) => ({
    id: r.id,
    name: r.name,
    level: r.level,
    node_count: r.nodeCount,
    description: r.description,
    stages: r.stages,
  }));
  const relationTypes = [
    { id: 'depends', name: '前导依赖', name_en: 'depends', color: '#3B82F6', style: 'solid', arrow: true, directed: true },
    { id: 'contains', name: '组成包含', name_en: 'contains', color: '#5B6ABF', style: 'solid', arrow: false, directed: true },
    { id: 'constrains', name: '约束关系', name_en: 'constrains', color: '#EF5350', style: 'solid', arrow: true, directed: true },
    { id: 'extends', name: '扩展外延', name_en: 'extends', color: '#8B5CF6', style: 'dashed', arrow: true, directed: true },
    { id: 'evolved', name: '演进发展', name_en: 'evolved', color: '#C026D3', style: 'solid', arrow: true, directed: true },
    { id: 'analogy', name: '类比参照', name_en: 'analogy', color: '#16A34A', style: 'dotted', arrow: false, directed: false },
    { id: 'contrast', name: '对比区分', name_en: 'contrast', color: '#F59E0B', style: 'dashed', arrow: false, directed: false },
  ];
  const opt = { lineWidth: 160, noRefs: true } as yaml.DumpOptions;
  return {
    'domain.yaml': yaml.dump(domain, opt),
    'dimensions.yaml': yaml.dump({ dimensions: p.dimensions }, opt),
    'knowledge_points.yaml': yaml.dump({ knowledge_points: kps }, opt),
    'relation_types.yaml': yaml.dump({ relation_types: relationTypes }, opt),
    'scenarios.yaml': yaml.dump({ scenarios }, opt),
  };
}

export function downloadText(filename: string, text: string, mime = 'text/yaml') {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}


/** 生成 5 文件模板（导入失败时可下载对照） */
export function bundleTemplate(name = '示例知识体系'): Record<BundleName, string> {
  const opt = { lineWidth: 160, noRefs: true } as yaml.DumpOptions;
  const branches = Array.from({ length: 8 }, (_, i) => ({
    id: `b${i + 1}`,
    name: `分支${i + 1}`,
    name_en: `Branch ${i + 1}`,
    color: ['#2E4A9E', '#F59E0B', '#22B573', '#14B8A6', '#E11D63', '#9333EA', '#92400E', '#F97316'][i],
  }));
  const kps: any[] = [
    { id: 'root', name, name_en: name, level: 'root', branch: 'b1', definition: '一句话说明这个领域', description: '展开说明', difficulty: 1, importance: 100, centrality: 100, study_minutes: 0, dimensions: { stage: 'basic' }, prerequisites: [] },
  ];
  for (const b of branches) {
    kps.push({ id: b.id, name: b.name, name_en: b.name_en, level: 'L1', branch: b.id, parent: 'root', definition: `${b.name}的核心内容`, description: `${b.name}覆盖的主要内容`, difficulty: 1, importance: 95, centrality: 85, study_minutes: 30, dimensions: { stage: 'basic', field: `f${branches.indexOf(b) + 1}`, ability: ['a1'] }, prerequisites: [] });
    kps.push({ id: `${b.id}_l2_1`, name: `${b.name}子领域`, name_en: `${b.name_en} Sub`, level: 'L2', branch: b.id, parent: b.id, definition: '二级子领域', description: '二级子领域说明', difficulty: 2, importance: 88, centrality: 72, study_minutes: 40, dimensions: { stage: 'core', field: `f${branches.indexOf(b) + 1}`, ability: ['a2'] }, prerequisites: [] });
    kps.push({ id: `${b.id}_l3_1`, name: `${b.name}方法`, name_en: `${b.name_en} Method`, level: 'L3', branch: b.id, parent: `${b.id}_l2_1`, definition: '三级方法', description: '三级方法说明', difficulty: 3, importance: 82, centrality: 64, study_minutes: 60, dimensions: { stage: 'core', field: `f${branches.indexOf(b) + 1}`, ability: ['a3'] }, prerequisites: [`${b.id}_l2_1`] });
    ['input', 'process', 'output'].forEach((unit, ui) => {
      kps.push({ id: `${b.id}_l3_1_${unit}`, name: `${b.name}方法·${['输入识别', '处理步骤', '输出检验'][ui]}`, name_en: `${b.name_en} ${unit}`, level: 'L4', branch: b.id, parent: `${b.id}_l3_1`, definition: '原子单元说明', description: '原子单元展开说明', difficulty: 2, importance: 76, centrality: 55, study_minutes: 30, dimensions: { stage: 'adv', field: `f${branches.indexOf(b) + 1}`, ability: ['a4'] }, prerequisites: [ui === 0 ? `${b.id}_l3_1` : `${b.id}_l3_1_${['input', 'process', 'output'][ui - 1]}`], unit });
    });
  }
  return {
    'domain.yaml': yaml.dump({ domain: { id: 'demo', name, name_en: name, category: '通用知识', description: '示例描述', version: '1.0.0', created_at: new Date().toISOString(), stats: { nodes: kps.length, edges: 0, branches: 8 }, layers: [
      { id: 'L1', name: '核心理论基础' }, { id: 'L2', name: '关键技术与方法' }, { id: 'L3', name: '系统与工程' }, { id: 'L4', name: '前沿与实战' }], branches } }, opt),
    'dimensions.yaml': yaml.dump({ dimensions: [
      { id: 'dim_stage', name: '学习阶段', role: 'column', values: [{ id: 'basic', name: '基础入门', color: '#EBF5FF' }, { id: 'core', name: '核心进阶', color: '#E9F7EF' }, { id: 'adv', name: '高级前沿', color: '#FDF2E9' }] },
      { id: 'dim_field', name: '知识领域', role: 'row', values: branches.map((b, i) => ({ id: `f${i + 1}`, name: b.name })) },
      { id: 'dim_ability', name: '能力领域', role: 'filter', values: [{ id: 'a1', name: '理论理解', color: '#7C3AED' }, { id: 'a2', name: '工程实现', color: '#0EA5E9' }, { id: 'a3', name: '系统设计', color: '#F59E0B' }, { id: 'a4', name: '研究创新', color: '#E11D63' }] },
    ] }, opt),
    'knowledge_points.yaml': yaml.dump({ knowledge_points: kps }, opt),
    'relation_types.yaml': yaml.dump({ relation_types: [
      { id: 'depends', name: '前导依赖', name_en: 'depends', color: '#3B82F6', style: 'solid', arrow: true, directed: true },
      { id: 'contains', name: '组成包含', name_en: 'contains', color: '#5B6ABF', style: 'solid', arrow: false, directed: true },
      { id: 'constrains', name: '约束关系', name_en: 'constrains', color: '#EF5350', style: 'solid', arrow: true, directed: true },
      { id: 'extends', name: '扩展外延', name_en: 'extends', color: '#8B5CF6', style: 'dashed', arrow: true, directed: true },
      { id: 'evolved', name: '演进发展', name_en: 'evolved', color: '#C026D3', style: 'solid', arrow: true, directed: true },
      { id: 'analogy', name: '类比参照', name_en: 'analogy', color: '#16A34A', style: 'dotted', arrow: false, directed: false },
      { id: 'contrast', name: '对比区分', name_en: 'contrast', color: '#F59E0B', style: 'dashed', arrow: false, directed: false },
    ] }, opt),
    'scenarios.yaml': yaml.dump({ scenarios: [{ id: 'route_overview', name: `${name}系统全览路线`, level: 'advanced', node_count: kps.length, description: '从基础到前沿的完整路径', stages: [{ name: '基础理论', layer: 'L1', nodes: kps.filter((n) => n.level !== 'root').slice(0, 10).map((n) => n.id) }] }] }, opt),
  };
}
