/** KSB-YAML 数据模型 —— 与需求文档 §6 一一对应 */

export type Level = 'root' | 'L1' | 'L2' | 'L3' | 'L4';

export type Category = '学科知识' | '行业工作' | '通用知识';

export type RelationTypeId =
  | 'depends'
  | 'contains'
  | 'constrains'
  | 'extends'
  | 'evolved'
  | 'analogy'
  | 'contrast';

export interface RelationType {
  id: RelationTypeId;
  name: string;
  nameEn: string;
  color: string;
  style: 'solid' | 'dashed' | 'dotted';
  arrow: boolean;
  directed: boolean;
}

export interface Branch {
  id: string;
  name: string;
  nameEn: string;
  color: string;
}

export interface Layer {
  id: string;
  name: string;
}

export interface DimensionValue {
  id: string;
  name: string;
  color?: string;
}

export interface Dimension {
  id: string;
  name: string;
  role: 'row' | 'column' | 'filter' | 'color';
  values: DimensionValue[];
}

/** 知识点（knowledge_points.yaml 的一项） */
export interface KnowledgePoint {
  id: string;
  name: string;
  nameEn?: string;
  level: Level;
  branch: string;
  parent?: string;
  definition: string;
  description: string;
  difficulty: number; // 1-4
  importance: number; // 0-100
  centrality: number; // 0-100
  studyMinutes: number;
  tags: string[];
  dimensions: Record<string, string | string[]>;
  prerequisites: string[];
  /** L4 原子单元类型 */
  unit?: 'input' | 'process' | 'output';
  /** 组装说明 */
  assembleNote?: string;
  /** 可组装 / 通向 */
  composeTo?: string[];
  examples?: string[];
  resources?: { title: string; type: 'book' | 'link' | 'course'; url?: string }[];
  /** 可直接学习的内容（可在详情面板里编辑） */
  learning?: LearningContent;
}

/** 学习内容：目标 + 分节讲解 + 练习 + 误区 + 延伸 */
export interface LearningSection {
  title: string;
  body: string;
}

export interface LearningContent {
  /** 学完这个节点能做到什么（3–5 条） */
  goals?: string[];
  /** 分节讲解（是什么 / 怎么做 / 为什么 / 边界） */
  sections?: LearningSection[];
  /** 动手练习 */
  practice?: string;
  /** 常见误区 */
  pitfalls?: string[];
  /** 延伸阅读 / 下一步 */
  further?: string[];
  /** 是否由 AI 补全 */
  source?: 'template' | 'ai' | 'manual';
  updatedAt?: string;
}

/** 显式关系（非结构关系） */
export interface Edge {
  from: string;
  to: string;
  type: RelationTypeId;
  note?: string;
}

export interface RouteStage {
  name: string;
  layer: string;
  nodes: string[];
}

export interface Route {
  id: string;
  name: string;
  level: 'beginner' | 'intermediate' | 'advanced' | 'expert';
  nodeCount: number;
  description: string;
  stages: RouteStage[];
}

export interface ProjectMeta {
  id: string;
  name: string;
  nameEn?: string;
  category: Category;
  description: string;
  createdAt: string;
  updatedAt: string;
  stats: { nodes: number; edges: number; branches: number };
}

/** 一个完整项目（= 一个 KSB-YAML 目录） */
export interface Project extends ProjectMeta {
  branches: Branch[];
  layers: Layer[];
  dimensions: Dimension[];
  nodes: KnowledgePoint[];
  edges: Edge[];
  routes: Route[];
}

export const RELATION_TYPES: RelationType[] = [
  { id: 'depends', name: '前导依赖', nameEn: 'depends', color: '#3B82F6', style: 'solid', arrow: true, directed: true },
  { id: 'constrains', name: '约束关系', nameEn: 'constrains', color: '#EF5350', style: 'solid', arrow: true, directed: true },
  { id: 'contains', name: '组成包含', nameEn: 'contains', color: '#5B6ABF', style: 'solid', arrow: false, directed: true },
  { id: 'extends', name: '扩展外延', nameEn: 'extends', color: '#8B5CF6', style: 'dashed', arrow: true, directed: true },
  { id: 'evolved', name: '演进发展', nameEn: 'evolved', color: '#C026D3', style: 'solid', arrow: true, directed: true },
  { id: 'analogy', name: '类比参照', nameEn: 'analogy', color: '#16A34A', style: 'dotted', arrow: false, directed: false },
  { id: 'contrast', name: '对比区分', nameEn: 'contrast', color: '#F59E0B', style: 'dashed', arrow: false, directed: false },
];

export const CATEGORY_STYLE: Record<Category, { icon: string; color: string; bg: string; sub: string }> = {
  学科知识: { icon: 'cap', color: '#3B62D9', bg: '#EEF3FF', sub: '学校学科' },
  行业工作: { icon: 'bag', color: '#2E9E52', bg: '#EAF7EE', sub: '工作行业' },
  通用知识: { icon: 'book', color: '#7B4BD8', bg: '#F3EEFF', sub: '公共通用' },
};

export const STAGE_ORDER = ['basic', 'core', 'adv'];

export const STAGE_LABEL: Record<string, string> = {
  basic: '基础入门',
  core: '核心进阶',
  adv: '高级前沿',
};

export const DIFFICULTY_LABEL = ['', '基础', '入门', '进阶', '专家'];

/** 建立索引，供各视图 O(1) 查询 */
export function indexProject(p: Project) {
  const byId = new Map<string, KnowledgePoint>();
  const children = new Map<string, KnowledgePoint[]>();
  const outgoing = new Map<string, { to: string; type: RelationTypeId }[]>();
  const incoming = new Map<string, { from: string; type: RelationTypeId }[]>();
  const branchById = new Map(p.branches.map((b) => [b.id, b]));

  for (const n of p.nodes) byId.set(n.id, n);
  for (const n of p.nodes) {
    if (n.parent && byId.has(n.parent)) {
      if (!children.has(n.parent)) children.set(n.parent, []);
      children.get(n.parent)!.push(n);
    }
  }
  for (const n of p.nodes) {
    for (const pre of n.prerequisites) {
      if (!byId.has(pre)) continue;
      if (!outgoing.has(pre)) outgoing.set(pre, []);
      outgoing.get(pre)!.push({ to: n.id, type: 'depends' });
      if (!incoming.has(n.id)) incoming.set(n.id, []);
      incoming.get(n.id)!.push({ from: pre, type: 'depends' });
    }
    if (n.parent && byId.has(n.parent)) {
      if (!outgoing.has(n.parent)) outgoing.set(n.parent, []);
      outgoing.get(n.parent)!.push({ to: n.id, type: 'contains' });
      if (!incoming.has(n.id)) incoming.set(n.id, []);
      incoming.get(n.id)!.push({ from: n.parent, type: 'contains' });
    }
  }
  for (const e of p.edges) {
    if (!byId.has(e.from) || !byId.has(e.to)) continue;
    if (e.type === 'depends' || e.type === 'contains') continue; // 已由结构生成
    if (!outgoing.has(e.from)) outgoing.set(e.from, []);
    outgoing.get(e.from)!.push({ to: e.to, type: e.type });
    if (!incoming.has(e.to)) incoming.set(e.to, []);
    incoming.get(e.to)!.push({ from: e.from, type: e.type });
  }

  const pathOf = (id: string): KnowledgePoint[] => {
    const out: KnowledgePoint[] = [];
    let cur = byId.get(id);
    let guard = 0;
    while (cur && guard++ < 20) {
      out.unshift(cur);
      cur = cur.parent ? byId.get(cur.parent) : undefined;
    }
    return out;
  };

  return { byId, children, outgoing, incoming, branchById, pathOf };
}

export type ProjectIndex = ReturnType<typeof indexProject>;
