import type { Project, KnowledgePoint, Edge, Branch, Layer, Dimension, Route, Level } from '../lib/types';

/* ------------------------------------------------------------------
 * 紧凑的声明式规格 → 展开为完整 KSB-YAML 数据结构
 * ------------------------------------------------------------------ */

export interface L3Spec {
  id: string;
  name: string;
  en: string;
  def: string;
  desc: string;
  diff?: number;
  imp?: number;
  cen?: number;
  min?: number;
  pre?: string[];
  /** [输入识别, 处理步骤, 输出检验] —— 有则自动生成 3 个 L4 原子单元 */
  io?: [string, string, string];
  stage?: 'basic' | 'core' | 'adv';
}

export interface L2Spec {
  id: string;
  name: string;
  en: string;
  def: string;
  l3: L3Spec[];
  pre?: string[];
}

export interface BranchSpec {
  id: string;
  name: string;
  en: string;
  color: string;
  def: string;
  l2: L2Spec[];
}

export interface ProjectSpec {
  id: string;
  name: string;
  nameEn: string;
  category: Project['category'];
  description: string;
  createdAt: string;
  updatedAt: string;
  branches: BranchSpec[];
  layers: Layer[];
  dimensions: Dimension[];
  routes: { id: string; name: string; level: Route['level']; description: string; branchIds: string[] }[];
}

let seq = 0;
const nid = (p: string) => `${p}_${(++seq).toString(36)}`;

/** 把规格展开成完整项目 */
export function buildProject(spec: ProjectSpec, diffSeed = 0): Project {
  const nodes: KnowledgePoint[] = [];
  const edges: Edge[] = [];
  const branches: Branch[] = spec.branches.map((b) => ({ id: b.id, name: b.name, nameEn: b.en, color: b.color }));

  const rootId = 'root';
  nodes.push({
    id: rootId,
    name: spec.name,
    nameEn: spec.nameEn,
    level: 'root',
    branch: spec.branches[0].id,
    definition: spec.description.slice(0, 60),
    description: spec.description,
    difficulty: 1,
    importance: 100,
    centrality: 100,
    studyMinutes: 0,
    tags: [],
    dimensions: { stage: 'basic' },
    prerequisites: [],
  });

  const allL3: string[] = [];

  for (const b of spec.branches) {
    const bid = b.id;
    nodes.push({
      id: bid,
      name: b.name,
      nameEn: b.en,
      level: 'L1',
      branch: bid,
      parent: rootId,
      definition: b.def,
      description: b.def,
      difficulty: 1,
      importance: 96,
      centrality: 88,
      studyMinutes: 0,
      tags: [],
      dimensions: { stage: 'basic' },
      prerequisites: [],
    });

    let prevInBranch = '';
    for (const l2 of b.l2) {
      const l2id = l2.id;
      nodes.push({
        id: l2id,
        name: l2.name,
        nameEn: l2.en,
        level: 'L2',
        branch: bid,
        parent: bid,
        definition: l2.def,
        description: l2.def,
        difficulty: 2,
        importance: 88,
        centrality: 72,
        studyMinutes: 0,
        tags: [],
        dimensions: { stage: 'core' },
        prerequisites: prevInBranch ? [prevInBranch] : [],
      });
      if (prevInBranch) edges.push({ from: prevInBranch, to: l2id, type: 'depends' });
      prevInBranch = l2id;

      let prevL3 = '';
      for (const l3 of l2.l3) {
        const stage = l3.stage ?? 'core';
        const diff = l3.diff ?? Math.min(4, 2 + (diffSeed % 2));
        const imp = l3.imp ?? 70 + ((seq * 7) % 25);
        const cen = l3.cen ?? 40 + ((seq * 11) % 50);
        const pre = l3.pre ?? (prevL3 ? [prevL3] : []);
        nodes.push({
          id: l3.id,
          name: l3.name,
          nameEn: l3.en,
          level: 'L3',
          branch: bid,
          parent: l2id,
          definition: l3.def,
          description: l3.desc,
          difficulty: diff,
          importance: imp,
          centrality: cen,
          studyMinutes: l3.min ?? 20 + diff * 10,
          tags: [l2.name, { basic: '基础入门', core: '核心进阶', adv: '高级前沿' }[stage]],
          dimensions: { stage },
          prerequisites: pre,
        });
        for (const p of pre) edges.push({ from: p, to: l3.id, type: 'depends' });
        prevL3 = l3.id;
        allL3.push(l3.id);

        if (l3.io) {
          const [inp, proc, outp] = l3.io;
          const units: [string, string, 'input' | 'process' | 'output', string][] = [
            [`${l3.name}·输入识别`, `${l3.en} Input`, 'input', inp],
            [`${l3.name}·处理步骤`, `${l3.en} Process`, 'process', proc],
            [`${l3.name}·输出检验`, `${l3.en} Output`, 'output', outp],
          ];
          let prevUnit = '';
          for (const [un, uen, ut, ud] of units) {
            const uid = `${l3.id}_${ut}`;
            nodes.push({
              id: uid,
              name: un,
              nameEn: uen,
              level: 'L4',
              branch: bid,
              parent: l3.id,
              definition: ud,
              description: `${un.replace('·', '：')}。属于「${l3.name}」的三段式原子单元，用于把方法论落到可执行的检查清单。`,
              difficulty: Math.min(4, diff + (ut === 'output' ? 1 : 0)),
              importance: Math.max(30, imp - 20),
              centrality: Math.max(20, cen - 25),
              studyMinutes: 10 + diff * 5,
              tags: [l3.name, 'L4原子单元'],
              dimensions: { stage: ut === 'input' ? 'basic' : ut === 'output' ? 'adv' : 'core' },
              prerequisites: prevUnit ? [prevUnit] : [l3.id],
              unit: ut,
              assembleNote: prevUnit ? `承接「${units.find((u) => u[2] === ut)![0]}」的产出` : `以「${l3.name}」为直接前导`,
            });
            edges.push({ from: prevUnit || l3.id, to: uid, type: 'depends' });
            prevUnit = uid;
          }
        }
      }
    }
  }

  // 类比 / 对比 关系：同层不同分支的语义链接，取自规格里显式声明的部分
  for (const e of ANALOGY_EDGES[spec.id] ?? []) {
    if (nodes.some((n) => n.id === e.from) && nodes.some((n) => n.id === e.to)) edges.push(e);
  }

  const routes: Route[] = spec.routes.map((r) => {
    const pool = nodes
      .filter((n) => r.branchIds.includes(n.branch) && n.level !== 'root')
      .map((n) => n.id);
    // 每条路线控制在 ~60 个节点内，保证可读性（与参考产品 70–81 节点一致）
    const cap = Math.min(pool.length, 66);
    const ids = pool.filter((_, i) => Math.round((i * cap) / pool.length) === Math.round(((i + 1) * cap) / pool.length) - 1 || i < cap);
    const picked = ids.slice(0, cap);
    const stages = spec.layers.map((l, i) => ({
      name: l.name,
      layer: l.id,
      nodes: picked.filter((_, idx) => Math.floor((idx * spec.layers.length) / Math.max(1, picked.length)) === i),
    }));
    return {
      id: r.id,
      name: r.name,
      level: r.level,
      description: r.description,
      nodeCount: picked.length,
      stages,
    };
  });

  const branchCount = new Map<string, number>();
  for (const n of nodes) branchCount.set(n.branch, (branchCount.get(n.branch) ?? 0) + 1);

  return {
    id: spec.id,
    name: spec.name,
    nameEn: spec.nameEn,
    category: spec.category,
    description: spec.description,
    createdAt: spec.createdAt,
    updatedAt: spec.updatedAt,
    stats: { nodes: nodes.length, edges: edges.length, branches: spec.branches.length },
    branches,
    layers: spec.layers,
    dimensions: spec.dimensions,
    nodes,
    edges,
    routes,
  };
}

/** 人工预设的类比 / 对比边（key = project id） */
const ANALOGY_EDGES: Record<string, Edge[]> = {
  ai: [
    { from: 'b3_l3_det', to: 'b4_l3_mt', type: 'analogy', note: '都是编码器-解码器式的结构化输出任务' },
    { from: 'b2_l3_lr', to: 'b5_l3_mlp', type: 'extends', note: '加入隐藏层即成为神经网络' },
    { from: 'b9_l3_bfs', to: 'b9_l3_astar', type: 'contrast', note: '无信息 vs 有信息搜索' },
    { from: 'b9_l3_minimax', to: 'b9_l3_alphabeta', type: 'evolved', note: 'Alpha-Beta 是 Minimax 的剪枝优化' },
    { from: 'b1_l3_prop', to: 'b1_l3_fol', type: 'evolved', note: '一阶逻辑扩展了命题逻辑的表达力' },
    { from: 'b5_l3_cnn', to: 'b3_l3_cls', type: 'depends', note: '图像分类的主流骨干网络' },
    { from: 'b5_l3_transformer', to: 'b4_l3_seq2seq', type: 'evolved', note: 'Transformer 取代了 RNN 式的 Seq2Seq' },
    { from: 'b8_l3_slam', to: 'b3_l3_stereo', type: 'analogy', note: '都依赖多视角几何求解深度' },
  ],
};

/* ------------------------------------------------------------------
 * 人工智能知识体系
 * ------------------------------------------------------------------ */

const AI_LAYERS: Layer[] = [
  { id: 'L0', name: '基础认知' },
  { id: 'L1', name: '核心理论基础' },
  { id: 'L2', name: '关键技术与方法' },
  { id: 'L3', name: '系统与工程' },
  { id: 'L4', name: '前沿与实战' },
];

const AI_DIMENSIONS: Dimension[] = [
  {
    id: 'dim_stage',
    name: '学习阶段',
    role: 'column',
    values: [
      { id: 'basic', name: '基础入门', color: '#EBF5FF' },
      { id: 'core', name: '核心进阶', color: '#E9F7EF' },
      { id: 'adv', name: '高级前沿', color: '#FDF2E9' },
    ],
  },
  {
    id: 'dim_field',
    name: '知识领域',
    role: 'row',
    values: [
      { id: 'b1', name: '知识表示与推理' },
      { id: 'b2', name: '机器学习' },
      { id: 'b3', name: '计算机视觉' },
      { id: 'b4', name: '自然语言处理' },
      { id: 'b5', name: '深度学习' },
      { id: 'b6', name: '语音识别与合成' },
      { id: 'b7', name: '多智能体系统' },
      { id: 'b8', name: '机器人学' },
      { id: 'b9', name: '搜索与优化' },
    ],
  },
  {
    id: 'dim_ability',
    name: '能力领域',
    role: 'filter',
    values: [
      { id: 'a1', name: '理论理解', color: '#7C3AED' },
      { id: 'a2', name: '工程实现', color: '#0EA5E9' },
      { id: 'a3', name: '系统设计', color: '#F59E0B' },
      { id: 'a4', name: '研究创新', color: '#E11D63' },
    ],
  },
  {
    id: 'dim_scene',
    name: '应用场景',
    role: 'filter',
    values: [
      { id: 's1', name: '互联网产品' },
      { id: 's2', name: '智能制造' },
      { id: 's3', name: '医疗健康' },
      { id: 's4', name: '金融风控' },
      { id: 's5', name: '科研教育' },
    ],
  },
];

export const AI_SPEC: ProjectSpec = {
  id: 'ai',
  name: '人工智能知识体系',
  nameEn: 'Artificial Intelligence',
  category: '学科知识',
  description:
    '人工智能旨在使机器能够像人类一样思考、学习和决策，其核心问题包括知识表示、自动推理、机器学习、自然语言理解、计算机视觉和机器人控制等。该领域融合了计算机科学、数学、神经科学、认知科学和哲学等多个学科，形成从符号主义到连接主义的完整技术谱系。',
  createdAt: '2026-07-21T10:12:00+08:00',
  updatedAt: '2026-07-21T10:12:00+08:00',
  layers: AI_LAYERS,
  dimensions: AI_DIMENSIONS,

  branches: [
    {
      id: 'b1',
      name: '知识表示与推理',
      en: 'Knowledge Representation',
      color: '#2E4A9E',
      def: '研究如何把现实世界的知识形式化为机器可处理的结构，并在此基础上进行演绎与推理。',
      l2: [
        {
          id: 'b1_l2_logic',
          name: '逻辑基础',
          en: 'Logic Foundation',
          def: '以形式逻辑刻画命题与谓词的真值关系，是符号主义 AI 的推理基石。',
          l3: [
            {
              id: 'b1_l3_prop',
              name: '命题逻辑',
              en: 'Propositional Logic',
              def: '用命题变元与逻辑联结词表示复合命题，通过真值表判定其可满足性。',
              desc: '命题逻辑是最基础的形式系统：原子命题取真/假，联结词（¬∧∨→↔）组合出复合公式。判定方法包括真值表、归结与 SAT 求解；表达力有限，无法刻画对象间关系。',
              diff: 1, imp: 78, cen: 62, min: 30, stage: 'basic',
              io: [
                '已知前提集合与待证结论的自然语言描述，识别其中的原子命题与联结词。',
                '把语句翻译为命题公式，化为合取范式，用归结或真值表判定可满足性。',
                '得到"可满足/不可满足"的结论，并可用于验证反证法推导是否闭合。',
              ],
            },
            {
              id: 'b1_l3_fol',
              name: '一阶逻辑',
              en: 'First-Order Logic',
              def: '引入个体、谓词与量词，可表达"所有""存在"等对象间关系，表达力强于命题逻辑。',
              desc: '一阶逻辑由项、谓词、量词（∀/∃）与函数符号构成，可形式化数学公理与知识库。推理依赖合一（unification）与归结原理，是 Prolog 与专家系统的语言基础。',
              diff: 3, imp: 82, cen: 70, min: 50, stage: 'core', pre: ['b1_l3_prop'],
              io: [
                '识别语句中的个体常元、变元、谓词与量词辖域。',
                '转换为前束范式并 Skolem 化，用合一算法匹配子句、执行归结。',
                '得到空子句即证明成立；否则给出反例模型或归结深度上限。',
              ],
            },
          ],
        },
        {
          id: 'b1_l2_repr',
          name: '知识表示方法',
          en: 'Knowledge Representation Methods',
          def: '面向具体领域建模的知识组织范式，包括语义网络、框架、脚本与本体。',
          l3: [
            {
              id: 'b1_l3_semnet',
              name: '语义网络',
              en: 'Semantic Network',
              def: '以节点表示概念、以带标签的边表示概念间关系的图式知识表示。',
              desc: '语义网络用 ISA、HAS-A、PART-OF 等关系边组织概念，支持继承与属性传播。优点是直观、可可视化；缺点是无形式语义、推理规则依赖人工约定。',
              diff: 2, imp: 74, cen: 58, min: 30, stage: 'basic',
            },
            {
              id: 'b1_l3_ontology',
              name: '本体论',
              en: 'Ontology',
              def: '对共享概念模型的显式、形式化规范，用类、属性、个体与公理描述领域知识。',
              desc: '本体以 OWL/RDF 描述类层次、对象属性、数据类型属性与约束，支持描述逻辑推理（子类判定、一致性检查）。是知识图谱与企业知识管理的语义底座。',
              diff: 3, imp: 86, cen: 76, min: 55, stage: 'adv', pre: ['b1_l3_semnet'],
              io: [
                '梳理领域术语表，区分类、实例、属性与关系，明确复用哪些上层本体。',
                '用 OWL 定义类层次与属性域值约束，导入推理机做一致性检查与分类推断。',
                '输出可查询的本体文件，验证子类推断结果与业务预期一致、无不可满足类。',
              ],
            },
          ],
        },
        {
          id: 'b1_l2_infer',
          name: '自动推理',
          en: 'Automated Reasoning',
          def: '让机器从已知知识自动导出新结论的机制，含归结、前向与后向链接。',
          l3: [
            {
              id: 'b1_l3_resolution',
              name: '归结原理',
              en: 'Resolution Principle',
              def: '通过消去互补文字对子句进行合并，反证式地判定一阶公式不可满足。',
              desc: '归结把公式化为子句集，反复选取含互补文字的两个子句生成归结式，直至导出空子句。完备但不完备于效率，需配合启发式选择与子句删减策略。',
              diff: 3, imp: 80, cen: 68, min: 45, stage: 'adv', pre: ['b1_l3_fol'],
            },
            {
              id: 'b1_l3_chain',
              name: '前向链接与后向链接',
              en: 'Forward / Backward Chaining',
              def: '前向链接从事实推结论（数据驱动），后向链接从目标找前提（目标驱动）。',
              desc: '前向链接适合事实多、需持续派生新事实的场景（如风控规则引擎）；后向链接适合目标明确、搜索空间大的场景（如 Prolog 查询）。二者可混合为双向推理。',
              diff: 2, imp: 76, cen: 64, min: 35, stage: 'core', pre: ['b1_l3_resolution'],
            },
          ],
        },
      ],
    },

    {
      id: 'b2',
      name: '机器学习',
      en: 'Machine Learning',
      color: '#F59E0B',
      def: '让系统从数据中自动归纳规律，并对未见样本做出预测或决策的方法论总称。',
      l2: [
        {
          id: 'b2_l2_sup',
          name: '监督学习',
          en: 'Supervised Learning',
          def: '在带标签样本上学习输入到输出的映射函数，分回归与分类两类任务。',
          l3: [
            {
              id: 'b2_l3_linreg',
              name: '线性回归',
              en: 'Linear Regression',
              def: '假设输出是输入的线性组合，用最小二乘或极大似然估计参数。',
              desc: '线性回归以 y = wᵀx + b 拟合数据，损失为均方误差，闭式解为正规方程。是理解偏差-方差、正则化与梯度优化的最小可用模型。',
              diff: 1, imp: 84, cen: 74, min: 30, stage: 'basic',
              io: [
                '确认目标变量连续、特征与目标近似线性、无严重多重共线性。',
                '标准化特征后求解正规方程或用梯度下降迭代，必要时加 L1/L2 正则。',
                '检查残差是否近似正态、R² 与 RMSE 是否达标，残差图无明显结构。',
              ],
            },
            {
              id: 'b2_l3_logreg',
              name: '逻辑回归',
              en: 'Logistic Regression',
              def: '用 Sigmoid 把线性组合映射到 (0,1) 概率，以交叉熵损失做二分类。',
              desc: '逻辑回归输出样本属于正类的概率，决策边界是线性的。可解释性强（系数即对数几率比），是风控评分卡与 CTR 预估的基线模型。',
              diff: 2, imp: 86, cen: 78, min: 35, stage: 'core', pre: ['b2_l3_linreg'],
              io: [
                '确认标签为 0/1、正负样本比例、特征是否需分箱与 WOE 编码。',
                '用极大似然/梯度下降拟合权重，配合类别加权或采样处理不平衡。',
                '输出 AUC、KS、PR 曲线与校准曲线，确认概率排序与绝对概率都可信。',
              ],
            },
            {
              id: 'b2_l3_svm',
              name: '支持向量机',
              en: 'Support Vector Machine',
              def: '寻找最大间隔分离超平面，并用核函数把线性不可分问题映射到高维。',
              desc: 'SVM 的优化目标是最大化间隔并最小化分类错误（软间隔），对偶形式只依赖样本内积，因此可用核技巧（RBF、多项式）处理非线性。小样本高维场景表现稳健。',
              diff: 3, imp: 78, cen: 66, min: 45, stage: 'adv', pre: ['b2_l3_logreg'],
            },
          ],
        },
        {
          id: 'b2_l2_unsup',
          name: '无监督学习',
          en: 'Unsupervised Learning',
          def: '在无标签数据上发现结构，包括聚类、降维与密度估计。',
          l3: [
            {
              id: 'b2_l3_kmeans',
              name: 'K-Means聚类',
              en: 'K-Means Clustering',
              def: '迭代地把样本分配给最近的簇中心并更新中心，最小化簇内平方和。',
              desc: 'K-Means 需预先指定 K，对初值与尺度敏感，只适合凸形、大小相近的簇。工程上用肘部法/轮廓系数选 K，用 K-Means++ 初始化，用 MiniBatch 版本处理大数据。',
              diff: 2, imp: 76, cen: 60, min: 30, stage: 'basic',
              io: [
                '确认样本为数值型、量纲已统一、簇数 K 的候选范围。',
                'K-Means++ 初始化后用 EM 式迭代，直到中心位移小于阈值或达到最大轮次。',
                '用轮廓系数与肘部图验证 K 的合理性，检查空簇与样本倾斜。',
              ],
            },
            {
              id: 'b2_l3_pca',
              name: '主成分分析',
              en: 'Principal Component Analysis',
              def: '通过正交变换把相关特征投影到方差最大的若干主成分上，实现降维与去噪。',
              desc: 'PCA 对协方差矩阵做特征分解，取前 k 个特征向量作为投影基。解释方差比决定保留维度；需先中心化（标准化），否则量纲大的特征会主导。',
              diff: 2, imp: 74, cen: 56, min: 30, stage: 'core', pre: ['b2_l3_kmeans'],
            },
          ],
        },
        {
          id: 'b2_l2_ens',
          name: '集成学习',
          en: 'Ensemble Learning',
          def: '组合多个弱学习器以获得更稳定、更准确的整体模型。',
          l3: [
            {
              id: 'b2_l3_bagging',
              name: 'Bagging',
              en: 'Bootstrap Aggregating',
              def: '对样本做有放回重采样训练多个同质模型，再投票或平均，主要降低方差。',
              desc: 'Bagging 通过样本扰动制造多样性，随机森林进一步加入特征扰动。适用于高方差模型（深树），对噪声稳健，可并行训练。',
              diff: 2, imp: 80, cen: 62, min: 30, stage: 'core', pre: ['b2_l3_svm'],
            },
            {
              id: 'b2_l3_boosting',
              name: 'Boosting',
              en: 'Gradient Boosting',
              def: '串行训练弱学习器，每轮拟合前一轮的残差（负梯度），主要降低偏差。',
              desc: 'GBDT/XGBoost/LightGBM 以加法模型逐步逼近目标函数，配合学习率、树的深度与行列采样控制过拟合。是结构化数据竞赛与工业建模的主力。',
              diff: 3, imp: 92, cen: 82, min: 50, stage: 'adv', pre: ['b2_l3_bagging'],
              io: [
                '确认任务为表格型数据、评估指标、是否需要单调性/可解释性约束。',
                '定义损失函数并求负梯度，逐轮训练回归树拟合梯度，按学习率累加。',
                '用早停与验证集监控，确认训练/验证损失不发散，特征重要性与业务常识一致。',
              ],
            },
          ],
        },
        {
          id: 'b2_l2_eval',
          name: '模型评估与选择',
          en: 'Model Evaluation',
          def: '用合理的划分与指标衡量模型泛化能力，并在候选中做出选择。',
          l3: [
            {
              id: 'b2_l3_cv',
              name: '交叉验证',
              en: 'Cross Validation',
              def: '把数据切分为 K 折轮流做验证集，取平均指标以降低评估方差。',
              desc: 'K 折交叉验证充分利用小样本；时间序列需用滚动窗口，分组数据需 GroupKFold 防止泄漏。与超参搜索结合即网格/贝叶斯调参。',
              diff: 2, imp: 82, cen: 66, min: 30, stage: 'core', pre: ['b2_l3_boosting'],
            },
          ],
        },
      ],
    },

    {
      id: 'b3',
      name: '计算机视觉',
      en: 'Computer Vision',
      color: '#22B573',
      def: '让机器从图像与视频中获取、处理和理解视觉信息，完成识别、定位与生成。',
      l2: [
        {
          id: 'b3_l2_img',
          name: '图像处理基础',
          en: 'Image Processing',
          def: '在像素层面做滤波、增强与特征提取，是视觉任务的前置工序。',
          l3: [
            {
              id: 'b3_l3_filter',
              name: '图像滤波与边缘检测',
              en: 'Filtering & Edge Detection',
              def: '用卷积核平滑噪声或增强梯度，Sobel/Canny 用于定位边缘。',
              desc: '均值/高斯滤波抑制噪声，中值滤波去椒盐噪声；Sobel 求一阶梯度，Canny 通过非极大值抑制与双阈值得到细边缘。是传统视觉管线的第一步。',
              diff: 1, imp: 72, cen: 54, min: 25, stage: 'basic',
            },
          ],
        },
        {
          id: 'b3_l2_recog',
          name: '视觉识别',
          en: 'Visual Recognition',
          def: '判断图像"是什么""在哪里"，含分类、检测与分割。',
          l3: [
            {
              id: 'b3_l3_cls',
              name: '图像分类',
              en: 'Image Classification',
              def: '把整张图像映射到预定义类别，是视觉任务的基础范式。',
              desc: '从手工特征 + SVM 到 CNN 端到端，再到 ViT，图像分类的演进主线是更强的表征学习。评估用 Top-1/Top-5 准确率与混淆矩阵。',
              diff: 2, imp: 88, cen: 78, min: 35, stage: 'core', pre: ['b3_l3_filter'],
              io: [
                '确认类别体系、每类样本量、图像分辨率与长尾分布。',
                '用预训练骨干做迁移学习，数据增强后微调分类头，必要时做类别重采样。',
                '看 Top-1/Top-5、混淆矩阵与每类召回，确认无系统性混淆对。',
              ],
            },
            {
              id: 'b3_l3_det',
              name: '目标检测',
              en: 'Object Detection',
              def: '同时输出目标的类别与边界框，分两阶段与单阶段两大流派。',
              desc: 'Faster R-CNN 用 RPN 生成候选框再分类回归；YOLO 系列把检测转为单次回归，速度快。评估用 mAP@IoU，需处理 NMS 与尺度变化。',
              diff: 3, imp: 86, cen: 74, min: 50, stage: 'adv', pre: ['b3_l3_cls'],
            },
          ],
        },
        {
          id: 'b3_l2_3d',
          name: '3D视觉与重建',
          en: '3D Vision',
          def: '从多视角或深度传感器恢复场景的三维结构与相机位姿。',
          l3: [
            {
              id: 'b3_l3_stereo',
              name: '立体视觉与深度估计',
              en: 'Stereo & Depth Estimation',
              def: '利用左右目视差或单目线索恢复每个像素的深度。',
              desc: '双目通过极线校正 + 块匹配得到视差图，深度与视差成反比；单目依赖透视、遮挡与学习先验。深度图是自动驾驶与三维重建的关键中间量。',
              diff: 3, imp: 76, cen: 64, min: 45, stage: 'adv',
            },
          ],
        },
        {
          id: 'b3_l2_gen',
          name: '生成与风格迁移',
          en: 'Generation & Style Transfer',
          def: '学习数据分布以合成新图像，或把一种风格迁移到另一张内容图上。',
          l3: [
            {
              id: 'b3_l3_gan',
              name: '生成对抗网络',
              en: 'Generative Adversarial Network',
              def: '生成器与判别器对抗博弈，使生成分布逼近真实分布。',
              desc: 'GAN 通过极小极大博弈训练：G 造假、D 辨真。难点是模式崩溃与训练不稳定，常用 WGAN-GP、谱归一化、渐进式增长缓解。',
              diff: 4, imp: 84, cen: 72, min: 55, stage: 'adv', pre: ['b3_l3_det'],
              io: [
                '确认数据域、分辨率、是否需要条件控制（类别/文本/姿态）。',
                '交替优化 D 与 G，D 每步多训几次，用梯度惩罚稳定 Lipschitz 约束。',
                '用 FID/IS 评估分布距离，人工检查是否有模式崩溃与棋盘伪影。',
              ],
            },
            {
              id: 'b3_l3_style',
              name: '风格迁移',
              en: 'Style Transfer',
              def: '保留内容图的结构、替换为风格图的纹理与色调。',
              desc: 'Gatys 方法用预训练 VGG 的内容损失与 Gram 矩阵风格损失做迭代优化；快速风格迁移用前馈网络一次前向出图，可实时。',
              diff: 3, imp: 70, cen: 52, min: 40, stage: 'adv', pre: ['b3_l3_gan'],
            },
          ],
        },
      ],
    },

    {
      id: 'b4',
      name: '自然语言处理',
      en: 'Natural Language Processing',
      color: '#14B8A6',
      def: '让机器理解、生成与操作人类语言，覆盖从词法分析到语义理解的全链路。',
      l2: [
        {
          id: 'b4_l2_prep',
          name: '文本预处理',
          en: 'Text Preprocessing',
          def: '把原始文本规范化为模型可用的 token 序列。',
          l3: [
            {
              id: 'b4_l3_token',
              name: '分词与词性标注',
              en: 'Tokenization & POS Tagging',
              def: '把连续文本切分为词单元并标注其语法类别。',
              desc: '中文分词有基于词典（最大匹配）、基于统计（HMM/CRF）与基于神经网络（BiLSTM-CRF）三代方法；英文用 BPE/WordPiece 子词切分以缓解未登录词。',
              diff: 1, imp: 76, cen: 58, min: 25, stage: 'basic',
            },
          ],
        },
        {
          id: 'b4_l2_lm',
          name: '词表示与语言模型',
          en: 'Word Representation & LM',
          def: '把词映射为稠密向量，并建模词序列出现的概率。',
          l3: [
            {
              id: 'b4_l3_embed',
              name: '词嵌入',
              en: 'Word Embedding',
              def: '把词映射到低维稠密空间，使语义相近的词距离更近。',
              desc: 'Word2Vec（CBOW/Skip-gram）用上下文预测学习向量，GloVe 用共现矩阵分解。静态词向量无法处理一词多义，后被上下文相关的 BERT 表示取代。',
              diff: 2, imp: 86, cen: 74, min: 35, stage: 'core', pre: ['b4_l3_token'],
              io: [
                '确认语料规模、是否需要领域词表、OOV 比例。',
                '构建词表后训练 Skip-gram（负采样）或用预训练向量微调。',
                '用相似词、类比任务与下游任务指标检验语义空间质量。',
              ],
            },
            {
              id: 'b4_l3_ngram',
              name: 'n-gram语言模型',
              en: 'n-gram Language Model',
              def: '用马尔可夫假设近似序列概率，仅依赖前 n-1 个词。',
              desc: 'n-gram 用极大似然估计条件概率，配合平滑（加一、Kneser-Ney）处理稀疏。困惑度（PPL）是标准评估。它是神经语言模型的对照基线。',
              diff: 2, imp: 72, cen: 56, min: 30, stage: 'basic', pre: ['b4_l3_embed'],
            },
          ],
        },
        {
          id: 'b4_l2_seq',
          name: '序列模型与注意力',
          en: 'Sequence Models',
          def: '建模变长序列的上下文依赖，是机器翻译与摘要的骨架。',
          l3: [
            {
              id: 'b4_l3_rnn',
              name: 'RNN与LSTM',
              en: 'RNN & LSTM',
              def: '用循环结构共享参数处理序列，LSTM 以门控缓解长程梯度消失。',
              desc: 'RNN 按时间步递归，理论上可记忆任意长历史，但实际受梯度消失限制。LSTM 引入输入/遗忘/输出门与细胞状态，GRU 进一步简化。',
              diff: 3, imp: 84, cen: 72, min: 45, stage: 'core',
              io: [
                '确认序列长度分布、是否需要双向、是否存在超长依赖。',
                '按时间步展开计算隐状态，用 BPTT 反传，梯度裁剪防止爆炸。',
                '检查梯度范数、验证集 PPL 与长距离依赖任务（如主谓一致）表现。',
              ],
            },
            {
              id: 'b4_l3_seq2seq',
              name: 'Seq2Seq与注意力',
              en: 'Seq2Seq with Attention',
              def: '编码器压缩源序列，解码器逐步生成目标序列，注意力动态对齐。',
              desc: '基础 Seq2Seq 把整句压成单一向量，长句信息损失严重；加注意力后解码每一步都回看编码器全部状态，显著提升长句翻译质量，并成为 Transformer 的前身。',
              diff: 3, imp: 88, cen: 78, min: 50, stage: 'adv', pre: ['b4_l3_rnn'],
            },
          ],
        },
        {
          id: 'b4_l2_task',
          name: '高级任务',
          en: 'Advanced NLP Tasks',
          def: '在语言理解之上完成翻译、问答、摘要等端到端任务。',
          l3: [
            {
              id: 'b4_l3_mt',
              name: '机器翻译',
              en: 'Machine Translation',
              def: '把源语言句子自动转换为目标语言，主流为神经机器翻译。',
              desc: 'NMT 采用编码器-解码器 + 注意力，训练用 teacher forcing，解码用束搜索。评估用 BLEU/chrF，需关注术语一致性与低资源语言。',
              diff: 3, imp: 82, cen: 68, min: 45, stage: 'adv', pre: ['b4_l3_seq2seq'],
            },
            {
              id: 'b4_l3_qa',
              name: '问答系统',
              en: 'Question Answering',
              def: '根据给定上下文或知识库回答自然语言问题。',
              desc: '抽取式问答在段落中定位答案片段（SQuAD 范式）；生成式问答用大模型直接产出答案；检索增强（RAG）把外部知识库接入生成流程以降低幻觉。',
              diff: 3, imp: 90, cen: 80, min: 50, stage: 'adv', pre: ['b4_l3_mt'],
            },
          ],
        },
      ],
    },

    {
      id: 'b5',
      name: '深度学习',
      en: 'Deep Learning',
      color: '#E11D63',
      def: '用多层神经网络自动学习层次化表征，是当代 AI 的主流技术底座。',
      l2: [
        {
          id: 'b5_l2_base',
          name: '神经网络基础',
          en: 'Neural Network Basics',
          def: '由线性变换与非线性激活堆叠而成的可微函数逼近器。',
          l3: [
            {
              id: 'b5_l3_mlp',
              name: '多层感知机',
              en: 'Multilayer Perceptron',
              def: '全连接层 + 非线性激活堆叠，理论上可逼近任意连续函数。',
              desc: 'MLP 的每个神经元计算 wᵀx+b 后过激活函数（ReLU/GELU）。万能逼近定理保证表达力，但深度比宽度更高效。是理解所有深度模型的起点。',
              diff: 2, imp: 90, cen: 82, min: 35, stage: 'basic', pre: ['b2_l3_logreg'],
              io: [
                '确认输入维度、任务类型（回归/分类）、是否需要嵌入层处理离散特征。',
                '按"线性层→激活→归一化"堆叠若干层，定义损失并用小批量梯度下降训练。',
                '检查训练/验证损失曲线、梯度范数与过拟合迹象，确认收敛稳定。',
              ],
            },
            {
              id: 'b5_l3_bp',
              name: '反向传播',
              en: 'Backpropagation',
              def: '用链式法则从输出层逐层回传误差梯度，是训练一切神经网络的核心算法。',
              desc: '前向计算损失，反向按计算图求每个参数的偏导，再用优化器更新。自动微分（autograd）把这一过程工程化，使任意可微结构都能训练。',
              diff: 3, imp: 94, cen: 88, min: 45, stage: 'core', pre: ['b5_l3_mlp'],
            },
          ],
        },
        {
          id: 'b5_l2_arch',
          name: '典型网络结构',
          en: 'Network Architectures',
          def: '针对图像、序列等不同数据结构设计的专用网络。',
          l3: [
            {
              id: 'b5_l3_cnn',
              name: '卷积神经网络',
              en: 'Convolutional Neural Network',
              def: '用卷积核共享权重提取局部特征，通过池化逐级扩大感受野。',
              desc: 'CNN 的核心归纳偏置是平移不变与局部连接，因此参数效率远高于全连接。ResNet 的残差连接解决了深层退化，是现代视觉骨干的标准结构。',
              diff: 3, imp: 92, cen: 86, min: 50, stage: 'core', pre: ['b5_l3_bp'],
              io: [
                '确认输入分辨率、通道数、感受野需求与算力预算。',
                '堆叠"卷积→BN→激活"与下采样，用残差连接保证梯度通畅。',
                '看 Top-1 准确率、FLOPs 与推理延迟，确认在目标硬件上满足时延要求。',
              ],
            },
            {
              id: 'b5_l3_rnn2',
              name: '循环神经网络',
              en: 'Recurrent Neural Network',
              def: '沿时间轴共享参数的网络，用于建模序列的前后依赖。',
              desc: 'RNN 的隐状态携带历史信息，但串行计算无法并行、长程依赖易丢失。LSTM/GRU 用门控缓解，最终在多数任务上被 Transformer 取代。',
              diff: 3, imp: 78, cen: 66, min: 40, stage: 'core', pre: ['b5_l3_cnn'],
            },
          ],
        },
        {
          id: 'b5_l2_attn',
          name: '注意力与Transformer',
          en: 'Attention & Transformer',
          def: '以自注意力替代循环，实现全局依赖建模与高度并行。',
          l3: [
            {
              id: 'b5_l3_transformer',
              name: 'Transformer标准架构',
              en: 'Transformer Architecture',
              def: '由 6 层编码器与 6 层解码器堆叠，使用多头自注意力、位置编码与残差连接。',
              desc: '原始 Transformer（Vaswani et al., 2017）以自注意力取代 RNN，可并行训练且能直接建模任意距离依赖。编码器含多头自注意力与前馈网络，解码器额外引入交叉注意力；位置编码注入序列顺序。是 BERT/GPT/LLM 的共同祖先。',
              diff: 4, imp: 100, cen: 95, min: 50, stage: 'adv', pre: ['b5_l3_rnn2'],
              io: [
                '确认序列长度、词表规模、算力与显存预算，判断是否需要稀疏/线性注意力。',
                '按"多头自注意力→残差+LN→前馈→残差+LN"堆叠 N 层，加入位置编码与掩码。',
                '检查注意力熵是否塌缩、梯度是否稳定、长序列 PPL 是否随位置衰减。',
              ],
            },
          ],
        },
        {
          id: 'b5_l2_train',
          name: '训练策略',
          en: 'Training Strategies',
          def: '让深层网络稳定收敛并具备泛化能力的工程手段。',
          l3: [
            {
              id: 'b5_l3_reg',
              name: '正则化与Dropout',
              en: 'Regularization & Dropout',
              def: '通过约束参数或随机失活神经元抑制过拟合。',
              desc: 'L2 权重衰减限制参数幅度，Dropout 训练时随机置零神经元形成隐式集成，BatchNorm/LayerNorm 稳定分布。数据增强是最有效的正则化之一。',
              diff: 2, imp: 80, cen: 58, min: 30, stage: 'core', pre: ['b5_l3_transformer'],
            },
            {
              id: 'b5_l3_opt',
              name: '优化器与学习率调度',
              en: 'Optimizers & LR Schedule',
              def: '自适应调整参数更新步长，含动量、Adam 与 warmup+衰减策略。',
              desc: 'SGD+Momentum 泛化常更好，Adam/AdamW 收敛更快；大模型训练普遍用 AdamW + 线性 warmup + 余弦衰减。学习率是最敏感的超参。',
              diff: 3, imp: 86, cen: 70, min: 40, stage: 'adv', pre: ['b5_l3_reg'],
            },
          ],
        },
      ],
    },

    {
      id: 'b6',
      name: '语音识别与合成',
      en: 'Speech Recognition & Synthesis',
      color: '#9333EA',
      def: '让机器听懂人说话（ASR）并说出人话（TTS），是语音交互的两端。',
      l2: [
        {
          id: 'b6_l2_sig',
          name: '语音信号处理',
          en: 'Speech Signal Processing',
          def: '把时域波形转换为适合建模的声学特征。',
          l3: [
            {
              id: 'b6_l3_feat',
              name: '声学特征提取',
              en: 'Acoustic Feature Extraction',
              def: '分帧加窗后做 STFT，取梅尔滤波器组与倒谱得到 MFCC/FBank。',
              desc: '语音短时平稳，按 25ms 帧长、10ms 帧移分帧；梅尔刻度模拟人耳非线性感知。FBank 保留更多信息，是神经 ASR 的默认输入。',
              diff: 2, imp: 78, cen: 60, min: 30, stage: 'basic',
              io: [
                '确认采样率、声道数、信噪比与是否需要降噪/VAD 预处理。',
                '预加重→分帧→加窗→FFT→梅尔滤波→取对数，得到 FBank 特征序列。',
                '检查特征维度、时间对齐与静音段占比，确认与声学模型输入规格一致。',
              ],
            },
          ],
        },
        {
          id: 'b6_l2_asr',
          name: '语音识别',
          en: 'Automatic Speech Recognition',
          def: '把语音波形转写为文字，主流为端到端声学建模 + 解码。',
          l3: [
            {
              id: 'b6_l3_am',
              name: '声学模型',
              en: 'Acoustic Model',
              def: '建模声学特征到音素/字符的后验概率，是 ASR 的核心。',
              desc: '从 GMM-HMM 到 DNN-HMM，再到 CTC/RNN-T/Attention 端到端模型，声学模型的演进主线是去掉强制对齐与发音词典。评估用字错率 CER/WER。',
              diff: 3, imp: 84, cen: 72, min: 50, stage: 'adv', pre: ['b6_l3_feat'],
            },
          ],
        },
        {
          id: 'b6_l2_tts',
          name: '语音合成',
          en: 'Text-to-Speech',
          def: '把文本转换为自然语音，需处理文本前端、声学模型与声码器。',
          l3: [
            {
              id: 'b6_l3_ntts',
              name: '神经语音合成',
              en: 'Neural TTS',
              def: '用神经网络直接从文本预测梅尔谱，再由声码器还原波形。',
              desc: 'Tacotron/FastSpeech 负责文本→梅尔谱，WaveNet/HiFi-GAN 负责梅尔谱→波形。当前主流是端到端 + 扩散/流匹配声码器，追求自然度与零样本音色克隆。',
              diff: 4, imp: 80, cen: 66, min: 55, stage: 'adv', pre: ['b6_l3_am'],
            },
          ],
        },
      ],
    },

    {
      id: 'b7',
      name: '多智能体系统',
      en: 'Multi-Agent Systems',
      color: '#92400E',
      def: '多个自主智能体在同一环境中感知、决策与协作，涌现出群体智能。',
      l2: [
        {
          id: 'b7_l2_arch',
          name: '智能体架构',
          en: 'Agent Architecture',
          def: '刻画单个智能体的感知-决策-行动循环与内部状态。',
          l3: [
            {
              id: 'b7_l3_bdi',
              name: 'BDI智能体',
              en: 'Belief-Desire-Intention Agent',
              def: '以信念、愿望、意图三层心智状态驱动决策的经典智能体模型。',
              desc: 'BDI 把"世界是什么样（Belief）""想要什么（Desire）""承诺做什么（Intention）"分离，用意图栈保证行为连贯。是 AgentSpeak/Jason 等平台的理论基础。',
              diff: 3, imp: 74, cen: 60, min: 40, stage: 'core',
            },
          ],
        },
        {
          id: 'b7_l2_coop',
          name: '协作与通信',
          en: 'Cooperation & Communication',
          def: '智能体之间如何协商任务、共享信息并达成一致。',
          l3: [
            {
              id: 'b7_l3_cn',
              name: '合同网协议',
              en: 'Contract Net Protocol',
              def: '管理者广播任务、承包者投标、管理者授标的三阶段协商协议。',
              desc: '合同网用市场机制分配任务：Announcement → Bidding → Award。适合分布式、无中心调度的场景，需处理投标评估、通信开销与违约。',
              diff: 2, imp: 70, cen: 52, min: 30, stage: 'core', pre: ['b7_l3_bdi'],
            },
          ],
        },
        {
          id: 'b7_l2_game',
          name: '博弈与机制设计',
          en: 'Game Theory & Mechanism Design',
          def: '用数学工具分析理性主体的策略互动，并设计规则引导其行为。',
          l3: [
            {
              id: 'b7_l3_ne',
              name: '纳什均衡',
              en: 'Nash Equilibrium',
              def: '任何一方单方面改变策略都无法获益的策略组合。',
              desc: '纳什均衡是博弈的稳定性概念，纯策略未必存在，混合策略下必存在（Nash 定理）。求解可用划线法、支持枚举或迭代最佳响应。',
              diff: 3, imp: 76, cen: 58, min: 40, stage: 'adv', pre: ['b7_l3_cn'],
            },
          ],
        },
        {
          id: 'b7_l2_marl',
          name: '多智能体学习',
          en: 'Multi-Agent Learning',
          def: '多个学习体在共享环境中同时学习，面临非平稳与信用分配问题。',
          l3: [
            {
              id: 'b7_l3_marl',
              name: '多智能体强化学习',
              en: 'MARL',
              def: '用强化学习训练多个智能体协同或竞争，典型算法有 QMIX、MAPPO。',
              desc: 'MARL 的核心难题是环境的非平稳性（他人也在学）与信用分配（团队奖励如何归因）。CTDE（集中训练分散执行）是主流范式。',
              diff: 4, imp: 82, cen: 68, min: 55, stage: 'adv', pre: ['b7_l3_ne'],
              io: [
                '确认智能体数量、动作空间（离散/连续）、奖励是团队共享还是个体独立。',
                '采用 CTDE：训练时用全局 critic，执行时各 agent 仅依赖局部观测。',
                '看团队回报曲线、个体贡献归因与对手策略变化下的鲁棒性。',
              ],
            },
          ],
        },
      ],
    },

    {
      id: 'b8',
      name: '机器人学',
      en: 'Robotics',
      color: '#F97316',
      def: '研究机器人的感知、规划、控制与操作，把 AI 落到物理世界。',
      l2: [
        {
          id: 'b8_l2_perc',
          name: '感知与定位',
          en: 'Perception & Localization',
          def: '融合多传感器估计机器人自身位姿与周围环境结构。',
          l3: [
            {
              id: 'b8_l3_slam',
              name: '视觉SLAM',
              en: 'Visual SLAM',
              def: '在未知环境中边定位边建图，同时估计相机轨迹与场景结构。',
              desc: '视觉 SLAM 分前端（特征跟踪/直接法）与后端（BA 优化、回环检测）。ORB-SLAM 系列是经典工程实现；激光 SLAM（Cartographer）在室内更稳。',
              diff: 4, imp: 84, cen: 74, min: 60, stage: 'adv', pre: ['b3_l3_stereo'],
              io: [
                '确认传感器（单目/双目/RGBD/激光）、场景尺度与实时光照条件。',
                '前端提特征并做帧间匹配，后端用滑动窗口 BA 优化位姿与地图点，回环时全局校正。',
                '看轨迹 ATE/RPE 误差、重定位成功率与长时间运行的漂移量。',
              ],
            },
          ],
        },
        {
          id: 'b8_l2_plan',
          name: '运动规划',
          en: 'Motion Planning',
          def: '在构型空间中寻找从起点到目标的无碰撞路径与可行轨迹。',
          l3: [
            {
              id: 'b8_l3_path',
              name: '路径规划',
              en: 'Path Planning',
              def: '在栅格或图上求最短/最优无碰撞路径，代表算法 A*、RRT、PRM。',
              desc: 'A* 适合已知静态栅格；RRT/RRT* 适合高维构型空间并具备概率完备性；PRM 用采样图做多次查询。动态环境需 D* Lite 等增量算法。',
              diff: 3, imp: 82, cen: 70, min: 45, stage: 'core', pre: ['b9_l3_astar'],
            },
          ],
        },
        {
          id: 'b8_l2_ctrl',
          name: '运动控制',
          en: 'Motion Control',
          def: '让机器人按期望轨迹运动，抑制扰动与模型误差。',
          l3: [
            {
              id: 'b8_l3_pid',
              name: 'PID控制',
              en: 'PID Control',
              def: '按误差的比例、积分、微分三项加权生成控制量，是最通用的反馈控制器。',
              desc: 'P 决定响应速度，I 消除稳态误差，D 抑制超调。整定方法有 Ziegler-Nichols、临界比例度法；工程上常加前馈与抗积分饱和。',
              diff: 2, imp: 80, cen: 64, min: 35, stage: 'core', pre: ['b8_l3_path'],
              io: [
                '确认被控对象的阶次、时滞、执行器饱和限幅与采样周期。',
                '先整定 P 到临界振荡，再降增益加 I 消差，最后加 D 抑制超调。',
                '看阶跃响应的上升时间、超调量、稳态误差与抗扰恢复时间。',
              ],
            },
          ],
        },
        {
          id: 'b8_l2_grasp',
          name: '抓取与操作',
          en: 'Grasping & Manipulation',
          def: '决定在哪里抓、怎么抓、抓起来后如何移动与装配。',
          l3: [
            {
              id: 'b8_l3_grasp',
              name: '抓取规划',
              en: 'Grasp Planning',
              def: '在物体表面寻找满足力封闭/形封闭的稳定抓取位姿。',
              desc: '解析法用摩擦锥与力封闭判据评估抓取质量；数据驱动法（GraspNet）直接从点云回归抓取位姿。灵巧手还需考虑手指运动学与碰撞。',
              diff: 4, imp: 78, cen: 62, min: 55, stage: 'adv', pre: ['b8_l3_pid'],
            },
          ],
        },
      ],
    },

    {
      id: 'b9',
      name: '搜索与优化',
      en: 'Search & Optimization',
      color: '#64748B',
      def: '在状态空间中寻找解，或在可行域内寻找最优参数，是经典 AI 的问题求解内核。',
      l2: [
        {
          id: 'b9_l2_uninf',
          name: '无信息搜索',
          en: 'Uninformed Search',
          def: '除问题定义外不借助任何领域知识的盲目搜索策略。',
          l3: [
            {
              id: 'b9_l3_bfs',
              name: '广度优先搜索',
              en: 'Breadth-First Search',
              def: '按层扩展节点，用队列实现，保证在无权图中找到最短路径。',
              desc: 'BFS 时间与空间复杂度均为 O(b^d)，空间是指数级的，是其主要瓶颈。双向 BFS 可把复杂度降到 O(b^(d/2))。',
              diff: 1, imp: 82, cen: 68, min: 25, stage: 'basic',
              io: [
                '确认状态空间可枚举、边权是否相同、目标是否可达。',
                '用 FIFO 队列逐层扩展，访问即标记，记录 parent 指针以便回溯路径。',
                '检查路径长度是否最短、是否因未去重导致内存爆炸。',
              ],
            },
            {
              id: 'b9_l3_dfs',
              name: '深度优先搜索',
              en: 'Depth-First Search',
              def: '沿一个分支尽可能深地探索，用栈（或递归）实现，空间开销小。',
              desc: 'DFS 空间只需 O(bm)，但不保证最优，且可能陷入无限分支。树搜索中不会重复，但在图搜索中必须避免重复状态。',
              diff: 1, imp: 78, cen: 62, min: 25, stage: 'basic', pre: ['b9_l3_bfs'],
              io: [
                '确认分支因子、最大深度、是否存在环或无限分支。',
                '用显式栈或递归深入，维护 visited 集合防止重复访问。',
                '检查是否找到解、解的质量（非最优）与递归深度是否超限。',
              ],
            },
          ],
        },
        {
          id: 'b9_l2_heur',
          name: '启发式搜索',
          en: 'Heuristic Search',
          def: '用估计函数引导搜索方向，在效率与最优性之间取得平衡。',
          l3: [
            {
              id: 'b9_l3_astar',
              name: 'A*算法',
              en: 'A* Search',
              def: '以 f(n)=g(n)+h(n) 排序扩展节点，h 可采纳时保证最优解。',
              desc: 'A* 的核心是启发函数：h 必须可采纳（不高估）且最好一致（单调）。h=0 退化为 Dijkstra，h 越准扩展节点越少。工程上常用网格距离、欧氏距离或学习得到的启发。',
              diff: 3, imp: 92, cen: 84, min: 40, stage: 'core', pre: ['b9_l3_dfs'],
              io: [
                '确认代价函数、启发函数 h 是否可采纳（不高估真实代价）。',
                '维护 open 表（优先队列按 f 排序）与 closed 表，弹出最小 f 节点扩展并松弛邻居。',
                '验证解的代价等于最优解，统计扩展节点数评估启发式质量。',
              ],
            },
          ],
        },
        {
          id: 'b9_l2_adv',
          name: '对抗搜索',
          en: 'Adversarial Search',
          def: '在存在对手的博弈环境中寻找最优策略的搜索方法。',
          l3: [
            {
              id: 'b9_l3_minimax',
              name: '极小极大算法',
              en: 'Minimax Algorithm',
              def: '博弈树搜索的基础算法，假设双方最优决策，MAX 节点取子节点最大值，MIN 节点取最小值，自底向上传播。',
              desc: '极小极大构建完整的博弈树递归评估，返回根节点的最优得分及对应行动。其复杂度为 O(b^m)，需要剪枝才能在深度较大时使用。',
              diff: 2, imp: 90, cen: 65, min: 35, stage: 'core', pre: ['b9_l3_astar'],
              io: [
                '识别局面状态、合法走子集合、终局判定与估值函数。',
                '递归展开博弈树，MAX 层取子节点最大值、MIN 层取最小值，自底向上回传。',
                '输出根节点最优走子与分值；用已知残局校验估值与胜负判定正确。',
              ],
            },
            {
              id: 'b9_l3_alphabeta',
              name: 'Alpha-Beta剪枝',
              en: 'Alpha-Beta Pruning',
              def: '在极小极大搜索中维护 α/β 边界，剪掉不可能影响决策的分支。',
              desc: 'α 是 MAX 已知下界，β 是 MIN 已知上界，当 α≥β 时剪枝。最优走子排序下可把复杂度从 O(b^m) 降到 O(b^(m/2))，等效于深度翻倍，且结果与完整搜索完全一致。',
              diff: 3, imp: 88, cen: 72, min: 40, stage: 'adv', pre: ['b9_l3_minimax'],
              io: [
                '确认已实现极小极大框架、走子生成顺序是否可按启发式排序。',
                '在递归中传递 α/β，MAX 更新 α、MIN 更新 β，α≥β 时立即返回。',
                '验证剪枝前后根节点得分与最优走子完全一致，统计剪枝率。',
              ],
            },
          ],
        },
        {
          id: 'b9_l2_csp',
          name: '约束满足问题',
          en: 'Constraint Satisfaction',
          def: '在变量取值满足全部约束的条件下寻找可行解或最优解。',
          l3: [
            {
              id: 'b9_l3_backtrack',
              name: '回溯搜索',
              en: 'Backtracking Search',
              def: '按变量逐个赋值，违反约束即回退，是 CSP 的骨架算法。',
              desc: '回溯 + 前向检查可大幅剪枝；变量排序用 MRV（最少剩余值），值排序用 LCV（最少约束值）。数独、排课、图着色都是典型 CSP。',
              diff: 2, imp: 80, cen: 64, min: 35, stage: 'core', pre: ['b9_l3_alphabeta'],
            },
          ],
        },
        {
          id: 'b9_l2_opt',
          name: '优化算法',
          en: 'Optimization Algorithms',
          def: '在连续或离散空间中寻找目标函数极值的方法族。',
          l3: [
            {
              id: 'b9_l3_gd',
              name: '梯度下降',
              en: 'Gradient Descent',
              def: '沿负梯度方向迭代更新参数，逐步逼近局部极小。',
              desc: '批量梯度下降稳定但慢，随机/小批量版本快但抖动；学习率过大会发散、过小收敛慢。带动量与自适应学习率（Adam）是深度学习默认配置。',
              diff: 2, imp: 90, cen: 76, min: 35, stage: 'basic', pre: ['b2_l3_linreg'],
              io: [
                '确认目标函数可微、参数初值、学习率与批量大小。',
                '计算小批量梯度，按 θ ← θ − η∇L 更新，可叠加动量或自适应二阶矩。',
                '观察损失是否单调下降、梯度范数是否爆炸/消失，验证收敛到合理局部极小。',
              ],
            },
          ],
        },
      ],
    },
  ],

  routes: [
    {
      id: 'route_ai_overview',
      name: '人工智能系统全览路线',
      level: 'advanced',
      description: '从基础理论到前沿实战的全景路线，覆盖符号主义与连接主义两条主线。',
      branchIds: ['b1', 'b2', 'b5', 'b9', 'b3', 'b4'],
    },
    {
      id: 'route_ai_basic',
      name: 'AI 基础理论入门路线',
      level: 'beginner',
      description: '面向零基础，先建立搜索、逻辑与统计学习的基本直觉。',
      branchIds: ['b9', 'b1', 'b2'],
    },
    {
      id: 'route_ai_cv',
      name: '计算机视觉专精路线',
      level: 'expert',
      description: '从图像处理到检测、3D 与生成，构建完整视觉技术栈。',
      branchIds: ['b3', 'b5'],
    },
  ],
};

export const AI_PROJECT = buildProject(AI_SPEC);
