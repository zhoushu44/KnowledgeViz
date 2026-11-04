/**
 * AI 生成链路（适配低吞吐内置模型：少量大调用 + 本地结构化展开）
 *
 * ① 骨架调用：domain / dimensions / relation_types（8 个一级分支）
 * ② 大纲调用：把 8 个分支拆成 2 组并发，每组返回「2 个 L2 × 2 个 L3」及其 io 三段式
 * ③ 本地展开：按 KSB-YAML 规范生成 root / L1 / L2 / L3 / L4 节点、依赖边、学习路线
 *
 * 这样每次调用的输出规模可控（≤2000 token），总体 1–3 分钟可完成，
 * 且结构、id、父子关系、路线引用由本地代码保证 100% 合法。
 */
import * as yaml from 'js-yaml';
import type { Category, Edge, KnowledgePoint, Project, Route } from './types';
import { chat, type ChatMessage } from './llm';
import { parseBundle, type ValidationIssue } from './ksb';
import { looksLikePrompt } from './prompt';
import { searchMany, netAvailable, type SearchBundle } from './net';

export interface GenerateInput {
  name: string;
  description: string;
  category: Category;
}

export type Stage = 'skeleton' | 'web' | 'tree' | 'relation' | 'route' | 'validate' | 'repair';

export interface GenerateHooks {
  onStage?: (stage: Stage, detail?: string, pct?: number) => void;
  onDelta?: (chars: number) => void;
  signal?: AbortSignal;
}

export interface GenerateResult {
  ok: boolean;
  project?: Project;
  issues: ValidationIssue[];
  rounds: number;
  rawLength: number;
  /** 联网依据（挂到项目上，方便事后核对这份体系基于什么资料） */
  webEvidence?: { query: string; results: { title: string; url: string }[] }[];
  /**
   * 降级记录：骨架或大纲走的是本地模板而非模型时写入。
   * 非空表示「这份体系不是模型按你的领域生成的结构」，必须在界面上明确告知用户，
   * 否则用户会拿到一套「基础理论 / 核心概念 / 关键方法」的占位分支却以为是自己领域的拆解。
   */
  degraded?: { stage: 'skeleton' | 'outline'; reason: string }[];
}

const SYSTEM = `你是知识工程专家。严格按用户要求输出 YAML，代码块之外不要任何解释。
所有 id 只用小写字母、数字、下划线；所有名称必须是该领域真实存在的术语。`;

/** 从模型输出抽取 yaml 代码块（兼容缺围栏的情况） */
export function extractYaml(text: string): string[] {
  const blocks: string[] = [];
  const re = /```ya?ml\s*\n([\s\S]*?)```/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) blocks.push(m[1].trim());
  if (!blocks.length) {
    const generic = /```\s*\n([\s\S]*?)```/g;
    while ((m = generic.exec(text))) blocks.push(m[1].trim());
  }
  if (!blocks.length) {
    const idx = [...text.matchAll(/^(domain|dimensions|relation_types|outline|knowledge_points)\s*:/gm)].map((x) => x.index ?? 0);
    for (let i = 0; i < idx.length; i++) blocks.push(text.slice(idx[i], idx[i + 1] ?? text.length).trim());
  }
  return blocks;
}

/** 宽松解析：解析失败时修掉制表符/前导空行再试一次 */
function parseLoose<T = any>(text: string): T | null {
  try {
    return yaml.load(text) as T;
  } catch {
    try {
      return yaml.load(text.replace(/\t/g, '  ').replace(/^\s*\n/, '')) as T;
    } catch {
      return null;
    }
  }
}

function findBlock(blocks: string[], key: string): string | undefined {
  const re = new RegExp(`^\\s*${key}\\s*:`, 'm');
  return blocks.find((b) => re.test(b));
}

const PALETTE = ['#2E4A9E', '#F59E0B', '#22B573', '#14B8A6', '#E11D63', '#9333EA', '#92400E', '#F97316'];

const LAYERS = [
  { id: 'L1', name: '核心理论基础' },
  { id: 'L2', name: '关键技术与方法' },
  { id: 'L3', name: '系统与工程' },
  { id: 'L4', name: '前沿与实战' },
];

const STOP_WORDS = new Set([
  '知识体系', '体系', '涵盖', '覆盖', '包括', '面向', '构建', '建立', '输出', '核心', '主要', '相关', '以及',
  '等', '与', '和', '的', '了', '在', '对', '从', '为', '一个', '领域', '内容', '方面', '能力', '方法',
  '技术', '管理', '分析', '设计', '实现', '应用', '系统', '平台', '数据', '业务', '流程', '架构', '模型',
  '工具', '标准', '治理', '实践', '角色', '任务', '要求', '输出要求', '质量约束', '语言', '风格', '中文名',
]);

const GENERIC_BRANCHES = ['基础理论', '核心概念', '关键方法', '技术体系', '工程实践', '工具与平台', '治理与合规', '前沿趋势'];

/**
 * 把「内置提示词」压缩成一段领域描述（用于模型 prompt 与项目卡片摘要）。
 * 提示词原文动辄上千字，直接塞进 description 会让卡片与节点定义全是 markdown。
 */
export function summarizePrompt(text: string, name: string): string {
  const grab = (label: string) => new RegExp(`${label}[:：]\\s*([^\\n]+)`).exec(text)?.[1]?.trim() ?? '';
  // 模板里领域名写成「为「{{领域名称}}」构建知识体系」，不是 key: value
  const quoted = /为「([^」]*)」构建知识体系/.exec(text)?.[1]?.trim() ?? '';
  const isPlaceholder = (v: string) => !v || /^[（(].*[）)]$/.test(v) || v.includes('填写');
  const rawName = !isPlaceholder(quoted) ? quoted : isPlaceholder(grab('领域名称')) ? name : grab('领域名称');
  const domainName = rawName.replace(/知识体系$/, '').trim() || name.replace(/知识体系$/, '');
  const def = grab('领域描述') || grab('一句话定义');
  const scope = grab('涵盖范围');
  const audience = grab('目标受众');
  const scene = grab('应用场景');
  const clean = (v: string) => (isPlaceholder(v) ? '' : v);
  const parts = [
    `${domainName}知识体系`,
    clean(def) ? `${clean(def)}。` : '',
    clean(scope) ? `涵盖${clean(scope).replace(/^涵盖范围[:：]\s*/, '')}。` : '',
    clean(audience) ? `面向${clean(audience).replace(/^目标受众[:：]\s*/, '')}。` : '',
    clean(scene) ? `典型场景：${clean(scene).replace(/^应用场景[:：]\s*/, '')}。` : '',
  ].filter(Boolean);
  return parts.join('') || text.replace(/^#.*$/gm, '').replace(/\s+/g, ' ').trim().slice(0, 120);
}

/**
 * 从一段文本里抽候选分支名。
 * 普通描述：按标点切分；提示词模式：优先读「涵盖范围:」一行，其次读「一句话定义 / 领域描述」一行。
 */
function extractBranchNames(text: string): string[] {
  let src = text;
  // 兼容「涵盖范围：a、b」与摘要里的「涵盖a、b」
  const scope = /涵盖(?:范围)?[:：]\s*([^\n。]+)/.exec(text)?.[1];
  if (scope) {
    src = scope;
  } else if (/^#{1,6}\s*(角色|任务|输出要求)/m.test(text)) {
    const def = /(一句话定义|领域描述)[:：]\s*([^\n]+)/.exec(text)?.[2];
    src = def ?? '';
  }
  return src
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^\s{0,3}#{1,6}\s.*$/gm, ' ')
    .replace(/\{\{[^}]*\}\}/g, ' ')
    .split(/[、，,。；;\/\n]+/)
    .map((x) =>
      x
        .replace(/^[\s\d.、·\-*]+/, '')
        // 摘要句里的「涵盖客户开发」「面向初创团队」这类前缀
        .replace(/^(涵盖范围|涵盖|一句话定义|领域描述|定义|面向|应用场景|典型场景|目标受众|领域名称)[:：]?\s*/, '')
        // 普通描述里的动词前缀：「构建企业架构」「覆盖业务架构」
        .replace(/^(构建|建立|输出|生成|覆盖|涵盖|包括|包含|聚焦|围绕)\s*/, '')
        .replace(/^为「[^」]*」构建知识体系$/, '')
        .replace(/[（(][^）)]*[）)]/g, '')
        .replace(/知识体系$/, '')
        .replace(/等(核心|主要)?(领域|方面|内容)?$/, '')
        .trim()
    )
    .filter((x) => x.length >= 2 && x.length <= 10 && !STOP_WORDS.has(x) && !x.startsWith('#') && /[\u4e00-\u9fa5]/.test(x));
}

/** 本地兜底骨架：模型不可用时也能出体系（分支从领域描述里抽取，抽不够就用通用八分法） */
function localSkeleton(input: GenerateInput) {
  const uniq: string[] = [];
  for (const x of extractBranchNames(input.description)) if (!uniq.includes(x)) uniq.push(x);
  const picked = [...uniq.slice(0, 8)];
  for (const g of GENERIC_BRANCHES) {
    if (picked.length >= 8) break;
    if (!picked.includes(g)) picked.push(g);
  }
  const names = picked.slice(0, 8);
  const en = ['Foundations','Core Concepts','Key Methods','Technology','Engineering Practice','Tools & Platforms','Governance','Frontier'];
  const branches = names.map((n, i) => ({ id: `b${i + 1}`, name: n, nameEn: en[i] ?? `Branch ${i + 1}`, color: PALETTE[i % PALETTE.length] }));
  return {
    id: 'project',
    name: input.name,
    nameEn: input.name,
    category: input.category,
    description: input.description.slice(0, 120),
    branches,
  };
}

function localSkeletonText(domain: any) {
  const domainYaml = yaml.dump({ domain: { ...domain, version: '1.0.0', layers: LAYERS } }, { lineWidth: 160, noRefs: true });
  const dimsYaml = yaml.dump({
    dimensions: [
      { id: 'dim_stage', name: '学习阶段', role: 'column', values: [
        { id: 'basic', name: '基础入门', color: '#EBF5FF' },
        { id: 'core', name: '核心进阶', color: '#E9F7EF' },
        { id: 'adv', name: '高级前沿', color: '#FDF2E9' }] },
      { id: 'dim_field', name: '知识领域', role: 'row', values: domain.branches.map((b: any, i: number) => ({ id: `f${i + 1}`, name: b.name })) },
      { id: 'dim_ability', name: '能力领域', role: 'filter', values: [
        { id: 'a1', name: '理论理解', color: '#7C3AED' }, { id: 'a2', name: '工程实现', color: '#0EA5E9' },
        { id: 'a3', name: '系统设计', color: '#F59E0B' }, { id: 'a4', name: '研究创新', color: '#E11D63' }] },
      { id: 'dim_industry', name: '应用场景', role: 'filter', values: [
        { id: 'i1', name: '互联网产品', color: '#3B82F6' }, { id: 'i2', name: '智能制造', color: '#22B573' },
        { id: 'i3', name: '医疗健康', color: '#14B8A6' }, { id: 'i4', name: '金融风控', color: '#F59E0B' },
        { id: 'i5', name: '科研教育', color: '#8B5CF6' }] },
    ],
  }, { lineWidth: 160, noRefs: true });
  const relYaml = yaml.dump({ relation_types: [
    { id: 'depends', name: '前导依赖', name_en: 'depends', color: '#3B82F6', style: 'solid', arrow: true, directed: true },
    { id: 'contains', name: '组成包含', name_en: 'contains', color: '#5B6ABF', style: 'solid', arrow: false, directed: true },
    { id: 'constrains', name: '约束关系', name_en: 'constrains', color: '#EF5350', style: 'solid', arrow: true, directed: true },
    { id: 'extends', name: '扩展外延', name_en: 'extends', color: '#8B5CF6', style: 'dashed', arrow: true, directed: true },
    { id: 'evolved', name: '演进发展', name_en: 'evolved', color: '#C026D3', style: 'solid', arrow: true, directed: true },
    { id: 'analogy', name: '类比参照', name_en: 'analogy', color: '#16A34A', style: 'dotted', arrow: false, directed: false },
    { id: 'contrast', name: '对比区分', name_en: 'contrast', color: '#F59E0B', style: 'dashed', arrow: false, directed: false },
  ] }, { lineWidth: 160, noRefs: true });
  return { domainYaml, dimsYaml, relYaml };
}

function skeletonMessages(input: GenerateInput, webBrief = ''): ChatMessage[] {
  const ref = webBrief
    ? `\n\n以下是联网检索到的该领域真实资料标题，**8 个分支请优先复用这些标题里出现的术语**（不要自造）：\n${webBrief}\n`
    : '';
  return [
    { role: 'system', content: SYSTEM },
    {
      role: 'user',
      content: `为「${input.name}」设计知识体系骨架。
领域描述：${input.description}
分类：${input.category}${ref}
只输出 3 个 yaml 代码块（domain / dimensions / relation_types），不要解释。
每个代码块的第一行必须是它的顶层键，外层包装不能省：
\`\`\`yaml
domain:
  id: project
  ...
\`\`\`
（dimensions 块以 \`dimensions:\` 开头，relation_types 块以 \`relation_types:\` 开头）

domain.yaml 要求：
- id 用 project；name 用「${input.name}」；name_en 给英文名；category 固定「${input.category}」
- description：60 字以内的领域定义
- layers 固定 4 条：L1 核心理论基础 / L2 关键技术与方法 / L3 系统与工程 / L4 前沿与实战
- branches 恰好 8 个，id 依次 b1…b8，每个给 name / name_en / color（从 ${PALETTE.join(' ')} 依次取）
- **分支命名硬规则**：每个分支必须是该领域里真实可分析的维度/通路/分项，写成「分项名」或「分项名 + 符号」，
  例如「成本&损失通路」「奖赏通路」「价值 V」「注意力 A」。
  **严禁**使用「基础理论 / 核心概念 / 关键方法 / 技术体系 / 工程实践 / 工具与平台 / 治理与合规 / 前沿趋势」
  这类通用占位词——它们不含任何领域信息，出现即视为不合格。

dimensions.yaml 要求：
- dim_stage：column，values = basic 基础入门 / core 核心进阶 / adv 高级前沿
- dim_field：row，values 恰好 8 个（f1…f8，name 与 8 个分支同名）
- dim_ability：filter，4 个值（a1 理论理解 / a2 工程实现 / a3 系统设计 / a4 研究创新），各给 color
- dim_industry：filter，5 个值（i1 互联网产品 / i2 智能制造 / i3 医疗健康 / i4 金融风控 / i5 科研教育），各给 color

relation_types.yaml 要求：固定 7 条
depends 前导依赖 #3B82F6 solid arrow:true
contains 组成包含 #5B6ABF solid arrow:false
constrains 约束关系 #EF5350 solid arrow:true
extends 扩展外延 #8B5CF6 dashed arrow:true
evolved 演进发展 #C026D3 solid arrow:true
analogy 类比参照 #16A34A dotted arrow:false
contrast 对比区分 #F59E0B dashed arrow:false`,
    },
  ];
}

function outlineMessages(input: GenerateInput, branches: any[], from: number, webBrief = ''): ChatMessage[] {
  const list = branches.map((b, i) => `${i + 1}. ${b.id} ${b.name}（${b.nameEn ?? b.name_en ?? b.name}）`).join('\n');
  const ref = webBrief
    ? `\n参考这些该领域的真实资料标题，L2/L3 名称优先使用其中出现的术语（不要编造）：\n${webBrief.slice(0, 1200)}\n`
    : '';
  return [
    { role: 'system', content: SYSTEM },
    {
      role: 'user',
      content: `领域「${input.name}」（${input.description}）${ref}
请为下面 ${branches.length} 个分支各设计 2 个二级子领域（L2），每个 L2 下再设计 2 个三级方法（L3）。
每个 L3 需要给出三段式原子单元的要点：input（输入识别）、process（处理步骤）、output（输出检验），各一句话（≤24 字）。

分支列表：
${list}

**命名硬规则（必须遵守，否则整份输出作废）**
- L2 = 「机制名-系统归属」。机制名要具体到可观测的心理/业务机制，如「损失线索检测」「主观损失加权调制」；
  系统归属只能取 系统1 / 系统2 / 双系统，如「损失线索检测模块-系统1」「主观损失加权调制模块-系统1」。
- L3 = 具体的线索或操作，写成「变量/线索 + 怎么看或怎么做」，
  如「金钱成本线索-看到价格、运费」「风险损失线索-看到差评、过敏提示」「锚定原价」「压缩选择集」。
- **严禁**「XX基础 / XX核心概念 / XX总体框架 / XX实践 / XX实施方法 / XX度量与优化」这类空话命名，
  也不要把分支名直接加后缀当子领域名。

只输出 1 个 yaml 代码块，结构严格如下：
\`\`\`yaml
outline:
  - branch: b1
    l2:
      - name: 机制名-系统1
        name_en: Sub Domain
        def: 一句话定义（≤30字）
        l3:
          - name: 变量/线索-怎么看
            name_en: Method
            def: 一句话定义（≤30字）
            desc: 展开说明（30-60字）
            input: 输入识别要点
            process: 处理步骤要点
            output: 输出检验要点
\`\`\`
每个分支 2 个 L2、每个 L2 2 个 L3，不要多也不要少；不要输出其它文字。`,
    },
  ];
}

/** 让模型输出更稳：把数组里缺字段的项补成可渲染的最小对象 */
function normalizeOutline(raw: any, branches: any[]): { branch: string; l2: any[] }[] {
  const byId = new Map(branches.map((b) => [b.id, b]));
  const out: { branch: string; l2: any[] }[] = [];
  const list = Array.isArray(raw) ? raw : Array.isArray(raw?.branches) ? raw.branches : [];
  for (const item of list) {
    const bid = String(item?.branch ?? '').trim();
    if (!byId.has(bid)) continue;
    const l2s = (Array.isArray(item?.l2) ? item.l2 : []).slice(0, 2);
    out.push({
      branch: bid,
      l2: l2s.map((l2: any) => ({
        name: String(l2?.name ?? ''),
        nameEn: String(l2?.name_en ?? l2?.nameEn ?? ''),
        def: String(l2?.def ?? l2?.definition ?? ''),
        l3: (Array.isArray(l2?.l3) ? l2.l3 : []).slice(0, 2).map((l3: any) => ({
          name: String(l3?.name ?? ''),
          nameEn: String(l3?.name_en ?? l3?.nameEn ?? ''),
          def: String(l3?.def ?? l3?.definition ?? ''),
          desc: String(l3?.desc ?? l3?.description ?? ''),
          input: String(l3?.input ?? ''),
          process: String(l3?.process ?? ''),
          output: String(l3?.output ?? ''),
        })),
      })),
    });
  }
  return out;
}

/**
 * 本地把「骨架 + 大纲」展开成完整的 KSB-YAML 项目。
 * 所有 id / parent / prerequisites / 路线引用都在这里确定，保证校验必过。
 */
export function expandProject(
  input: GenerateInput,
  domain: any,
  outline: { branch: string; l2: any[] }[],
): Project {
  const nodes: KnowledgePoint[] = [];
  const edges: Edge[] = [];
  const branchOrder = new Map<string, number>();

  const push = (n: KnowledgePoint) => {
    nodes.push(n);
    if (n.parent) edges.push({ from: n.parent, to: n.id, type: 'contains' });
  };

  const branches: any[] = (domain?.branches ?? []).slice(0, 8);
  branches.forEach((b, i) => branchOrder.set(b.id, i));

  nodes.push({
    id: 'root',
    name: input.name,
    nameEn: domain?.name_en ?? domain?.nameEn ?? input.name,
    level: 'root',
    branch: branches[0]?.id ?? 'b1',
    definition: String(domain?.description ?? input.description).slice(0, 60),
    description: String(domain?.description ?? input.description),
    difficulty: 1,
    importance: 100,
    centrality: 100,
    studyMinutes: 0,
    tags: [],
    dimensions: { stage: 'basic' },
    prerequisites: [],
  });

  const stageOf = (lvl: string): 'basic' | 'core' | 'adv' =>
    lvl === 'L1' ? 'basic' : lvl === 'L2' ? 'basic' : lvl === 'L3' ? 'core' : 'adv';

  branches.forEach((b, bi) => {
    const bid = b.id;
    push({
      id: bid,
      name: b.name,
      nameEn: b.name_en ?? b.nameEn ?? b.name,
      level: 'L1',
      branch: bid,
      parent: 'root',
      definition: `${b.name}：${input.name}的核心分支之一。`,
      description: `${b.name}（${b.name_en ?? b.name}）覆盖该方向的核心理论、关键方法与工程实践，是构建完整知识体系的第 ${bi + 1} 根支柱。`,
      difficulty: 1,
      importance: 96,
      centrality: 88,
      studyMinutes: 30,
      tags: [b.name, '基础入门'],
      dimensions: { stage: 'basic', field: `f${bi + 1}`, ability: ['a1'] },
      prerequisites: [],
    });

    const ol = outline.find((o) => o.branch === bid);
    const l2s = ol?.l2?.length ? ol.l2 : [];
    l2s.forEach((l2, li) => {
      const l2id = `${bid}_l2_${li + 1}`;
      push({
        id: l2id,
        name: l2.name || `${b.name}子领域${li + 1}`,
        nameEn: l2.nameEn,
        level: 'L2',
        branch: bid,
        parent: bid,
        definition: l2.def || `${b.name}下的二级子领域。`,
        description: l2.def || `${b.name}下的二级子领域，承接一级分支并向下分解为可执行的方法。`,
        difficulty: 2,
        importance: 88 - li * 3,
        centrality: 72,
        studyMinutes: 40,
        tags: [b.name, '核心进阶'],
        dimensions: { stage: 'core', field: `f${bi + 1}`, ability: ['a2'] },
        prerequisites: li > 0 ? [`${bid}_l2_${li}`] : [],
      });

      const l3s: any[] = l2.l3?.length ? l2.l3 : [];
      l3s.forEach((l3: any, mi: number) => {
        const l3id = `${bid}_l3_${li + 1}_${mi + 1}`;
        push({
          id: l3id,
          name: l3.name || `${l2.name}方法${mi + 1}`,
          nameEn: l3.nameEn,
          level: 'L3',
          branch: bid,
          parent: l2id,
          definition: l3.def || `${l2.name}下的三级方法。`,
          description: l3.desc || l3.def || `${l3.name}的具体做法、适用边界与实践要点。`,
          difficulty: 3,
          importance: 82 - mi * 4,
          centrality: 64,
          studyMinutes: 60,
          tags: [l2.name, '核心进阶'],
          dimensions: { stage: 'core', field: `f${bi + 1}`, ability: ['a3'] },
          prerequisites: mi > 0 ? [`${bid}_l3_${li + 1}_${mi}`] : [l2id],
        });

        const units: [('input' | 'process' | 'output'), string, string][] = [
          ['input', '输入识别', l3.input || '识别该方法的输入对象、边界与前置条件'],
          ['process', '处理步骤', l3.process || '按标准步骤执行核心处理并记录中间产物'],
          ['output', '输出检验', l3.output || '产出可验收的结果并对照标准逐项检查'],
        ];
        let prev = '';
        units.forEach(([unit, label, text]) => {
          const uid = `${l3id}_${unit}`;
          push({
            id: uid,
            name: `${l3.name}·${label}`,
            nameEn: `${l3.nameEn || 'Method'} ${unit.toUpperCase()}`,
            level: 'L4',
            branch: bid,
            parent: l3id,
            definition: text,
            description: `${text}。属于「${l3.name}」的三段式原子单元（${label}），用于把方法论落到可执行的检查清单。`,
            difficulty: unit === 'process' ? 3 : 2,
            importance: 76,
            centrality: 55,
            studyMinutes: unit === 'process' ? 45 : 30,
            tags: [l3.name, 'L4原子单元'],
            dimensions: { stage: 'adv', field: `f${bi + 1}`, ability: ['a4'] },
            prerequisites: prev ? [prev] : [l3id],
            unit,
            assembleNote: prev ? `承接「${l3.name}·${prev === `${l3id}_input` ? '输入识别' : '处理步骤'}」的产出` : `以「${l3.name}」为直接前导`,
          });
          prev = uid;
        });
      });
    });
  });

  // 学习路线：全览 / 入门 / 专家
  const order: Record<string, number> = { L1: 0, L2: 1, L3: 2, L4: 3 };
  const body = nodes.filter((n) => n.level !== 'root');
  const sorted = [...body].sort((a, b) => (order[a.level] ?? 2) - (order[b.level] ?? 2));
  const mkRoute = (id: string, name: string, level: Route['level'], desc: string, picked: KnowledgePoint[]): Route => {
    const stageNames = [
      { name: '基础理论', layer: 'L1' },
      { name: '核心方法', layer: 'L2' },
      { name: '系统实践', layer: 'L3' },
      { name: '前沿拓展', layer: 'L4' },
    ];
    return {
      id,
      name,
      level,
      description: desc,
      nodeCount: picked.length,
      stages: stageNames.map((s, si) => ({
        name: s.name,
        layer: s.layer,
        nodes: picked
          .filter((_, i) => Math.floor((i * stageNames.length) / Math.max(1, picked.length)) === si)
          .map((n) => n.id),
      })),
    };
  };

  const baseName = input.name.replace(/知识体系$/, '').trim() || input.name;
  /** 均匀抽样：路线只保留 ~70 个节点，和参考产品的 81 节点量级一致，保证图上可读 */
  const sample = (list: KnowledgePoint[], cap: number) => {
    if (list.length <= cap) return list;
    const step = list.length / cap;
    return Array.from({ length: cap }, (_, i) => list[Math.floor(i * step)]);
  };
  const routes: Route[] = [
    mkRoute('route_overview', `${baseName}系统全览路线`, 'advanced', '从基础理论到前沿实践的完整学习路径', sample(sorted, 72)),
    mkRoute(
      'route_beginner',
      '入门路线',
      'beginner',
      '只保留一级分支、二级子领域与三级方法，快速建立全局认知',
      sample(sorted.filter((n) => n.level !== 'L4'), 42),
    ),
    mkRoute(
      'route_expert',
      '专家路线',
      'expert',
      '聚焦三级方法与原子单元，适合已有基础的从业者',
      sample(sorted.filter((n) => n.level === 'L3' || n.level === 'L4'), 54),
    ),
  ];

  const branchCount = branches.length;
  return {
    id: input.name,
    name: input.name,
    nameEn: domain?.name_en ?? domain?.nameEn,
    category: input.category,
    description: String(domain?.description ?? input.description),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    stats: { nodes: nodes.length, edges: edges.length, branches: branchCount },
    branches: branches.map((b) => ({
      id: b.id,
      name: b.name,
      nameEn: b.name_en ?? b.nameEn ?? b.name,
      color: b.color ?? '#2E4A9E',
    })),
    layers: LAYERS,
    dimensions: [
      {
        id: 'dim_stage',
        name: '学习阶段',
        role: 'column' as const,
        values: [
          { id: 'basic', name: '基础入门', color: '#EBF5FF' },
          { id: 'core', name: '核心进阶', color: '#E9F7EF' },
          { id: 'adv', name: '高级前沿', color: '#FDF2E9' },
        ],
      },
      {
        id: 'dim_field',
        name: '知识领域',
        role: 'row' as const,
        values: branches.map((b, i) => ({ id: `f${i + 1}`, name: b.name })),
      },
      {
        id: 'dim_ability',
        name: '能力领域',
        role: 'filter' as const,
        values: [
          { id: 'a1', name: '理论理解', color: '#7C3AED' },
          { id: 'a2', name: '工程实现', color: '#0EA5E9' },
          { id: 'a3', name: '系统设计', color: '#F59E0B' },
          { id: 'a4', name: '研究创新', color: '#E11D63' },
        ],
      },
      {
        id: 'dim_industry',
        name: '应用场景',
        role: 'filter' as const,
        values: [
          { id: 'i1', name: '互联网产品', color: '#3B82F6' },
          { id: 'i2', name: '智能制造', color: '#22B573' },
          { id: 'i3', name: '医疗健康', color: '#14B8A6' },
          { id: 'i4', name: '金融风控', color: '#F59E0B' },
          { id: 'i5', name: '科研教育', color: '#8B5CF6' },
        ],
      },
    ],
    nodes,
    edges,
    routes,
  };
}

export async function generateProject(rawInput: GenerateInput, hooks: GenerateHooks = {}): Promise<GenerateResult> {
  // 提示词模式：先把 prompt 压成领域描述，后续所有节点文本、卡片摘要都用它，避免 markdown 泄漏到知识树
  const promptMode = looksLikePrompt(rawInput.description);
  const input: GenerateInput = promptMode
    ? { ...rawInput, description: summarizePrompt(rawInput.description, rawInput.name) }
    : rawInput;
  const origDescription = rawInput.description;
  /** 送给模型的用户提示：提示词模式用原文，普通模式用描述 */
  const modelPrompt = promptMode ? origDescription : input.description;
  let rawLength = 0;
  const tick = (t: Stage, detail?: string, pct?: number) => {
    if (hooks.signal?.aborted) throw new DOMException('已取消', 'AbortError');
    hooks.onStage?.(t, detail, pct);
  };
  const ask = async (messages: ChatMessage[]) => {
    const text = await chat(messages, {
      signal: hooks.signal,
      stream: false,
      onDelta: (d) => {
        rawLength += d.length;
        hooks.onDelta?.(rawLength);
      },
    });
    return text;
  };

  // ---------- ① 骨架 ----------
  tick('skeleton', '正在生成领域骨架', 6);
  let domainText = '';
  let dimsText = '';
  let relText = '';
  let domain: any = null;
  let lastIssues: ValidationIssue[] = [];
  /** 联网检索到的领域资料：塞进骨架 prompt，让 8 个分支用真实在用的术语而不是模型自造 */
  let webEvidence: { query: string; results: { title: string; url: string }[] }[] = [];
  let webBrief = '';
  if (netAvailable()) {
    tick('web', '正在联网检索领域资料', 3);
    try {
      const bundles: SearchBundle[] = await searchMany(
        [
          `${input.name} 知识体系 核心主题 分支`,
          `${input.name} 主要领域 组成 分类`,
          `${input.name} 最新进展 关键概念`,
        ],
        { maxResults: 5, depth: 'advanced' }
      );
      const seen = new Set<string>();
      const lines: string[] = [];
      for (const b of bundles) {
        const picked: { title: string; url: string }[] = [];
        for (const h of b.results ?? []) {
          if (!h.url || seen.has(h.url)) continue;
          seen.add(h.url);
          picked.push({ title: h.title, url: h.url });
          if (picked.length >= 5) break;
        }
        if (picked.length) webEvidence.push({ query: b.query, results: picked });
        for (const p of picked) lines.push(`- ${p.title}`);
      }
      webBrief = lines.slice(0, 18).join('\n');
    } catch {
      /* 联网失败不影响主链路，回退纯模型生成 */
    }
  }
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const text = await chat(
        promptMode
          ? [
              { role: 'system', content: SYSTEM },
              {
                role: 'user',
                content: `${modelPrompt}\n\n分类：${input.category}\n请只输出 domain.yaml / dimensions.yaml / relation_types.yaml 三个代码块（knowledge_points 与 scenarios 由本地生成，不需要你输出）。\n每个代码块第一行必须是顶层键：domain: / dimensions: / relation_types:，外层包装不能省。`,
              },
            ]
          : skeletonMessages(input, webBrief),
        {
          signal: hooks.signal,
          stream: false,
          timeoutMs: 60_000,
          onDelta: (d) => {
            rawLength += d.length;
            hooks.onDelta?.(rawLength);
          },
        }
      );
      const blocks = extractYaml(text);
      domainText = findBlock(blocks, 'domain') ?? blocks[0] ?? '';
      dimsText = findBlock(blocks, 'dimensions') ?? '';
      relText = findBlock(blocks, 'relation_types') ?? '';

      // 模型偶尔漏掉顶层键（直接给 id/name/branches）：按块特征认领并补回包装，
      // 比直接判失败重试更省一轮（每次重试要多等 20–30 秒）
      const looksDomain = (b: string) => /^\s*(id|name|name_en|branches|layers)\s*:/m.test(b) && !/^\s*(dimensions|relation_types)\s*:/m.test(b);
      const looksDims = (b: string) => /^\s*(-\s*)?id:\s*dim_/m.test(b) || /^\s*values\s*:/m.test(b);
      const looksRel = (b: string) => /depends/.test(b) && /contains/.test(b) && /relation/i.test(b) === false && /arrow\s*:/.test(b);
      if (!domainText) {
        const hit = blocks.find(looksDomain);
        if (hit) domainText = `domain:\n${hit}`;
      }
      if (!dimsText) {
        const hit = blocks.find((b) => looksDims(b) && !b.startsWith(domainText));
        if (hit) dimsText = `dimensions:\n${hit}`;
      }
      if (!relText) {
        const hit = blocks.find((b) => looksRel(b) && !b.startsWith(domainText ?? ''));
        if (hit) relText = `relation_types:\n${hit}`;
      }

      // 模型常漏掉最外层 domain: 包装（直接给 id/name/branches）——两边都认
      domain = parseLoose(domainText)?.domain ?? parseLoose(domainText) ?? null;
      if (domain && !domain.name && !Array.isArray(domain.branches)) domain = null;
      if (domainText && dimsText && relText && Array.isArray(domain?.branches) && domain.branches.length >= 5) break;
      lastIssues = [{ file: 'domain.yaml', message: '骨架输出不完整（缺 domain / dimensions / relation_types，或分支不足 5 个）' }];
    } catch (e: any) {
      if (hooks.signal?.aborted) throw e;
      lastIssues = [{ file: 'domain.yaml', message: `骨架生成失败：${String(e?.message ?? e)}` }];
      domain = null;
      // 超时/接口不可用就不要再重试，直接走本地骨架，避免用户干等
      break;
    }
    if (attempt === 0) tick('repair', '骨架不完整，重试一次', 12);
  }
  const degraded: { stage: 'skeleton' | 'outline'; reason: string }[] = [];
  if (!domain || !domainText || !dimsText || !relText) {
    // 模型不可用/超时：用本地骨架继续，保证「新建 → 出体系」链路永远可走通
    domain = localSkeleton(input);
    const local = localSkeletonText(domain);
    domainText = local.domainYaml;
    dimsText = local.dimsYaml;
    relText = local.relYaml;
    lastIssues.push({ file: 'domain.yaml', message: '模型调用失败，已使用内置领域骨架模板' });
    degraded.push({
      stage: 'skeleton',
      reason: lastIssues[lastIssues.length - 1]?.message ?? '模型未返回可用的领域骨架',
    });
  }

  const branches: any[] = domain.branches.slice(0, 8).map((b: any, i: number) => ({
    id: String(b.id ?? `b${i + 1}`),
    name: String(b.name ?? `分支${i + 1}`),
    nameEn: String(b.name_en ?? b.nameEn ?? b.name ?? ''),
    color: b.color ?? PALETTE[i % PALETTE.length],
  }));
  domain.branches = branches;

  // ---------- ② 大纲（2 组并发） ----------
  tick('tree', '正在生成知识树大纲', 22);
  // 代理对并发并不友好：一次调用覆盖全部 8 个分支最省时间；
  // 失败时再退化成分组（每组 2 个分支）重试。
  const groups: any[][] = branches.length > 4 ? [branches] : [branches];
  const outlines: { branch: string; l2: any[] }[] = [];
  let groupDone = 0;
  const results = await Promise.allSettled(
    groups.map(async (g, gi) => {
      const text = await chat(outlineMessages(input, g, gi, webBrief), {
        signal: hooks.signal,
        stream: false,
        timeoutMs: 150_000,
        onDelta: (d) => {
          rawLength += d.length;
          hooks.onDelta?.(rawLength);
        },
      });
      const blocks = extractYaml(text);
      const block = findBlock(blocks, 'outline');
      const parsed = block ? parseLoose(block)?.outline : null;
      groupDone++;
      tick('tree', `知识树大纲 ${groupDone}/${groups.length} 组完成`, 22 + Math.round((groupDone / groups.length) * 50));
      return normalizeOutline(parsed, g);
    })
  );
  for (const r of results) {
    if (r.status === 'fulfilled') outlines.push(...r.value);
    else lastIssues.push({ file: 'knowledge_points.yaml', message: `大纲生成失败：${String(r.reason?.message ?? r.reason)}` });
  }
  // 整段大纲失败时，按 2 个分支一组补一次，尽量避免回退到通用模板
  const missing = branches.filter((b) => !outlines.some((o) => o.branch === b.id));
  if (missing.length && missing.length < branches.length) {
    for (let i = 0; i < missing.length; i += 2) {
      const g = missing.slice(i, i + 2);
      try {
        const text = await ask(outlineMessages(input, g, i, webBrief));
        const parsed = parseLoose(findBlock(extractYaml(text), 'outline') ?? '')?.outline;
        outlines.push(...normalizeOutline(parsed, g));
        lastIssues = lastIssues.filter((it) => !g.some((b) => it.message.includes(b.name)));
      } catch {
        /* 保持失败状态，后面用通用模板补 */
      }
    }
  }

  // 缺失的分支用「分支名 + 通用子领域」补齐，保证仍能出图
  const filledBranches: string[] = [];
  for (const b of branches) {
    if (!outlines.some((o) => o.branch === b.id)) {
      filledBranches.push(b.name);
      outlines.push({
        branch: b.id,
        l2: [
          {
            name: `${b.name}基础`,
            nameEn: `${b.nameEn} Fundamentals`,
            def: `${b.name}的基础概念、术语与总体框架。`,
            l3: [
              {
                name: `${b.name}核心概念`,
                nameEn: `${b.nameEn} Concepts`,
                def: `${b.name}领域的基础概念与关键术语。`,
                desc: `梳理${b.name}的概念体系、边界与相互关系，建立后续学习的共同语言。`,
                input: '梳理待学习的术语与概念清单',
                process: '按层次建立概念关系并对照权威资料',
                output: '能用自己的话准确解释核心概念',
              },
              {
                name: `${b.name}总体框架`,
                nameEn: `${b.nameEn} Framework`,
                def: `${b.name}的整体结构与主要组成部分。`,
                desc: `从整体视角理解${b.name}的组成模块、交互关系与典型落地路径。`,
                input: '识别体系边界与外部依赖',
                process: '拆解模块职责与交互关系',
                output: '输出可评审的整体框架图',
              },
            ],
          },
          {
            name: `${b.name}实践`,
            nameEn: `${b.nameEn} Practice`,
            def: `${b.name}在真实项目中的落地方法与常见问题。`,
            l3: [
              {
                name: `${b.name}实施方法`,
                nameEn: `${b.nameEn} Implementation`,
                def: `${b.name}落地的标准步骤与关键控制点。`,
                desc: `结合典型项目说明${b.name}的实施步骤、角色分工与交付物要求。`,
                input: '明确目标、范围与约束条件',
                process: '按阶段推进并设置评审关卡',
                output: '交付物通过评审并完成验收',
              },
              {
                name: `${b.name}度量与优化`,
                nameEn: `${b.nameEn} Metrics`,
                def: `用指标衡量${b.name}成效并持续改进。`,
                desc: `建立${b.name}的度量指标、采集方式与改进闭环，避免只做一次性的设计。`,
                input: '选定可量化的成效指标',
                process: '定期采集数据并做归因分析',
                output: '形成可复用的改进清单',
              },
            ],
          },
        ],
      });
    }
  }

  // ---------- ③ 本地展开 + 校验 ----------
  if (filledBranches.length) {
    degraded.push({
      stage: 'outline',
      reason: `以下分支的大纲未生成，已用「分支名 + 通用子领域」补齐：${filledBranches.join('、')}`,
    });
  }
  tick('relation', '正在组装节点与关系网络', 78);
  const project = expandProject(input, domain, outlines);

  tick('route', '正在生成学习路线', 90);
  const files: Record<string, string> = {
    'domain.yaml': domainText,
    'dimensions.yaml': dimsText,
    'relation_types.yaml': relText,
    'knowledge_points.yaml': yaml.dump({ knowledge_points: project.nodes }, { lineWidth: 200, noRefs: true }),
    'scenarios.yaml': yaml.dump({ scenarios: project.routes }, { lineWidth: 200, noRefs: true }),
  };
  tick('validate', '正在校验 schema 与关系图', 96);
  const res = parseBundle(files, input.name, { loose: true });
  // 大纲缺组已用本地通用模板补齐，属可接受降级：只有硬校验失败才中断
  if (res.issues.length) return { ok: false, issues: res.issues, rounds: 1, rawLength, webEvidence };

  return {
    ok: true,
    project: { ...project, description: input.description },
    issues: [],
    rounds: 1,
    rawLength,
    webEvidence,
    degraded: degraded.length ? degraded : undefined,
  };
}
