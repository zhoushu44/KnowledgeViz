import type { Project, Level } from '../lib/types';

/* ------------------------------------------------------------------
 * 其余项目的骨架数据集
 * 为避免重复样板，这里用「分支 × 主题」的两层声明式配置生成
 * ------------------------------------------------------------------ */

export interface MiniSpec {
  id: string;
  name: string;
  nameEn: string;
  category: Project['category'];
  description: string;
  createdAt: string;
  updatedAt: string;
  branches: { id: string; name: string; en: string; color: string; topics: [string, string][] }[];
}

const LAYERS = [
  { id: 'L0', name: '基础认知' },
  { id: 'L1', name: '核心理论' },
  { id: 'L2', name: '方法工具' },
  { id: 'L3', name: '工程实践' },
  { id: 'L4', name: '前沿与治理' },
];

function slug(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h.toString(36).padStart(6, '0').slice(0, 6);
}

export function buildMini(spec: MiniSpec): Project {
  const nodes: Project['nodes'] = [];
  const edges: Project['edges'] = [];
  const branches = spec.branches.map((b) => ({ id: b.id, name: b.name, nameEn: b.en, color: b.color }));

  nodes.push({
    id: 'root',
    name: spec.name,
    nameEn: spec.nameEn,
    level: 'root' as Level,
    branch: spec.branches[0].id,
    definition: spec.description.slice(0, 50),
    description: spec.description,
    difficulty: 1, importance: 100, centrality: 100, studyMinutes: 0,
    tags: [], dimensions: { stage: 'basic' }, prerequisites: [],
  });

  let k = 0;
  for (const b of spec.branches) {
    const bid = `${spec.id}_${b.id}`;
    nodes.push({
      id: bid, name: b.name, nameEn: b.en, level: 'L1', branch: b.id, parent: 'root',
      definition: `${b.name}：${spec.name.replace('知识体系', '')}领域的核心分支之一。`,
      description: `${b.name}（${b.en}）是「${spec.name.replace('知识体系', '')}」体系的组成部分，覆盖${b.topics.slice(0, 3).map((t) => t[0]).join('、')}等关键内容。`,
      difficulty: 1, importance: 95, centrality: 85, studyMinutes: 0,
      tags: [], dimensions: { stage: 'basic' }, prerequisites: [],
    });

    let prev = '';
    for (const [tname, tdesc] of b.topics) {
      const tid = `${bid}_${slug(tname)}`;
      k++;
      nodes.push({
        id: tid, name: tname, nameEn: tname, level: k % 3 === 0 ? 'L3' : 'L2', branch: b.id,
        parent: bid,
        definition: tdesc.slice(0, 58),
        description: `${tdesc}。在${b.name}分支下，${tname}是承上启下的关键知识点，既是${b.topics[0][0]}的延伸，也为后续${b.topics[b.topics.length - 1][0]}提供支撑。`,
        difficulty: 1 + (k % 4),
        importance: 60 + ((k * 13) % 38),
        centrality: 35 + ((k * 17) % 55),
        studyMinutes: 20 + (k % 4) * 15,
        tags: [b.name, k % 3 === 0 ? '核心进阶' : '基础入门'],
        dimensions: { stage: k % 3 === 0 ? 'adv' : k % 2 === 0 ? 'core' : 'basic' },
        prerequisites: prev ? [prev] : [],
      });
      if (prev) edges.push({ from: prev, to: tid, type: 'depends' });
      prev = tid;
    }
  }

  const routes = [
    {
      id: `${spec.id}_route_1`,
      name: `${spec.name.replace('知识体系', '')}快速入门路线`,
      level: 'beginner' as const,
      description: '面向新人的最小可行学习路径，约 4 周打通主干。',
      nodeCount: Math.round(nodes.length * 0.4),
      stages: LAYERS.slice(0, 3).map((l, i) => ({
        name: l.name,
        layer: l.id,
        nodes: nodes.filter((n, idx) => n.level !== 'root' && Math.floor(idx % 3) === i).slice(0, 8).map((n) => n.id),
      })),
    },
    {
      id: `${spec.id}_route_2`,
      name: `${spec.name.replace('知识体系', '')}系统学习路线`,
      level: 'advanced' as const,
      description: '按知识依赖顺序逐层递进，覆盖全部主干与关键方法。',
      nodeCount: nodes.length,
      stages: LAYERS.map((l, i) => ({
        name: l.name,
        layer: l.id,
        nodes: nodes.filter((n, idx) => n.level !== 'root' && Math.floor(idx % 5) === i).map((n) => n.id),
      })),
    },
  ];

  return {
    id: spec.id,
    name: spec.name,
    nameEn: spec.nameEn,
    category: spec.category,
    description: spec.description,
    createdAt: spec.createdAt,
    updatedAt: spec.updatedAt,
    stats: { nodes: nodes.length, edges: edges.length, branches: branches.length },
    branches,
    layers: LAYERS,
    dimensions: [
      {
        id: 'dim_stage', name: '学习阶段', role: 'column',
        values: [
          { id: 'basic', name: '基础入门', color: '#EBF5FF' },
          { id: 'core', name: '核心进阶', color: '#E9F7EF' },
          { id: 'adv', name: '高级前沿', color: '#FDF2E9' },
        ],
      },
      {
        id: 'dim_field', name: '知识领域', role: 'row',
        values: spec.branches.map((b) => ({ id: b.id, name: b.name })),
      },
      {
        id: 'dim_difficulty', name: '学习难度', role: 'filter',
        values: [
          { id: 'd1', name: '基础' }, { id: 'd2', name: '入门' }, { id: 'd3', name: '进阶' }, { id: 'd4', name: '专家' },
        ],
      },
    ],
    nodes,
    edges,
    routes,
  };
}

const C = {
  blue: '#2E4A9E', amber: '#F59E0B', green: '#22B573', teal: '#14B8A6',
  pink: '#E11D63', purple: '#9333EA', brown: '#92400E', orange: '#F97316', slate: '#64748B',
};

export const MINI_SPECS: MiniSpec[] = [
  {
    id: 'civil',
    name: '土木工程知识体系',
    nameEn: 'Civil Engineering',
    category: '学科知识',
    description: '结合主流大学的土木工程专业课程体系，从结构力学、材料、岩土到施工组织与工程管理，构建完整的土木工程知识框架。',
    createdAt: '2026-07-22T09:20:00+08:00',
    updatedAt: '2026-07-22T09:20:00+08:00',
    branches: [
      { id: 'b1', name: '结构工程', en: 'Structural Engineering', color: C.blue, topics: [['结构力学', '研究杆件与杆系结构在内力、变形与稳定性方面的基本规律'], ['静定结构内力分析', '通过平衡方程求解静定结构各截面内力'], ['超静定结构力法', '以多余约束力为未知量建立变形协调方程'], ['钢结构设计', '按极限状态法验算钢构件的强度、稳定与连接'], ['混凝土结构设计', '钢筋混凝土构件的正截面、斜截面承载力计算']] },
      { id: 'b2', name: '岩土工程', en: 'Geotechnical Engineering', color: C.amber, topics: [['土的物理性质指标', '表征土的基本物理状态和组成关系的指标，包括三相比例指标（含水量、孔隙比、饱和度等）和土的物理状态指标（液限、塑限、相对密实度等）'], ['土的抗剪强度', '摩尔-库仑强度准则与直剪、三轴试验测定方法'], ['地基沉降计算', '分层总和法与规范推荐的沉降计算方法'], ['边坡稳定性分析', '用极限平衡法评估边坡安全系数与滑裂面'], ['基础工程', '浅基础与桩基础的承载力与变形验算']] },
      { id: 'b3', name: '交通工程', en: 'Transportation Engineering', color: C.green, topics: [['道路勘测设计', '路线平面、纵断面与横断面设计的技术标准'], ['路基路面工程', '路面结构组合设计与沥青/水泥混凝土路面计算'], ['交通规划', '四阶段法：生成、分布、方式划分与分配'], ['桥梁工程', '桥跨结构选型、荷载组合与施工方法']] },
      { id: 'b4', name: '水利水电', en: 'Hydraulic Engineering', color: C.teal, topics: [['水力学', '管道流、明渠流与堰流的能量方程与阻力计算'], ['水文计算', '设计洪水与径流还原的水文统计方法'], ['水工建筑物', '重力坝、拱坝与溢洪道的稳定与应力分析']] },
      { id: 'b5', name: '市政工程', en: 'Municipal Engineering', color: C.pink, topics: [['给排水管网', '供水与排水管网的水力计算与优化布置'], ['污水处理技术', '活性污泥法与生物膜法的工艺设计'], ['城市防洪', '防洪标准、堤防与排涝系统设计']] },
      { id: 'b6', name: '建筑施工', en: 'Construction', color: C.purple, topics: [['施工组织设计', '流水施工、网络计划与资源均衡'], ['基坑工程', '支护形式选型、降水与监测方案'], ['工程质量与安全', '质量验收规范与危大工程安全管理']] },
      { id: 'b7', name: '工程管理', en: 'Engineering Management', color: C.slate, topics: [['工程造价', '工程量清单计价与全过程造价控制'], ['招投标与合同', '招标文件编制、评标办法与合同风险分配'], ['BIM与数字化', '建筑信息模型在协同设计与施工模拟中的应用']] },
    ],
  },
  {
    id: 'pm',
    name: '互联网产品经理知识体系',
    nameEn: 'Internet Product Manager',
    category: '行业工作',
    description: '构建互联网产品经理知识体系，覆盖业务、技术、管理、运营、软技能多方面知识。覆盖传统软件工程、产品规划、产品管理、运营多方面内容。',
    createdAt: '2026-07-22T10:05:00+08:00',
    updatedAt: '2026-07-22T10:05:00+08:00',
    branches: [
      { id: 'b1', name: '用户与需求', en: 'User & Requirement', color: C.blue, topics: [['用户研究', '通过访谈、问卷与可用性测试洞察真实需求'], ['需求分析', '用 KANO、四象限与用户故事拆解需求优先级'], ['用户画像', '基于行为与属性聚类构建典型用户模型'], ['体验设计', '信息架构、交互流程与界面设计原则']] },
      { id: 'b2', name: '产品规划', en: 'Product Planning', color: C.amber, topics: [['商业画布', '九要素拆解产品的价值主张与盈利模式'], ['MVP设计', '用最小可行产品验证核心假设'], ['路线图管理', '按季度规划版本节奏与里程碑'], ['竞品分析', '功能矩阵、定位图与差异化策略']] },
      { id: 'b3', name: '项目管理', en: 'Project Management', color: C.green, topics: [['敏捷开发', 'Scrum 角色、事件与工件'], ['需求评审', 'PRD 撰写规范与评审要点'], ['进度与风险', '甘特图、关键路径与风险登记册']] },
      { id: 'b4', name: '数据分析', en: 'Data Analysis', color: C.teal, topics: [['指标体系', '北极星指标与 OSM 模型'], ['A/B测试', '假设设计、分流与显著性检验'], ['漏斗与留存', '转化漏斗拆解与 cohort 留存分析']] },
      { id: 'b5', name: '技术理解', en: 'Technology Literacy', color: C.pink, topics: [['前后端架构', '客户端、服务端与接口的基本协作方式'], ['数据库与缓存', '关系型/非关系型选型与缓存策略'], ['AI能力集成', '大模型 API、RAG 与 Agent 的产品化路径']] },
      { id: 'b6', name: '运营增长', en: 'Growth', color: C.purple, topics: [['拉新与转化', '渠道投放、裂变与首单转化'], ['用户运营', '分层运营、生命周期与召回策略'], ['内容运营', '内容供给、分发与社区氛围治理']] },
      { id: 'b7', name: '软技能', en: 'Soft Skills', color: C.slate, topics: [['跨部门协作', '与研发、设计、运营的高效协同'], ['汇报与表达', '结构化表达与向上管理'], ['商业思维', '成本收益、单位经济模型与 ROI 评估']] },
    ],
  },
  {
    id: 'philosophy',
    name: '西方哲学知识体系',
    nameEn: 'Western Philosophy',
    category: '学科知识',
    description: '输出西方哲学知识体系，从古希腊到现代哲学，包括核心的哲学思想、哲学家、哲学著作，按时期作为一级分类。',
    createdAt: '2026-07-22T11:30:00+08:00',
    updatedAt: '2026-07-22T11:30:00+08:00',
    branches: [
      { id: 'b1', name: '古希腊哲学', en: 'Ancient Greek', color: C.blue, topics: [['前苏格拉底学派', '米利都学派的本原论与赫拉克利特的流变说'], ['柏拉图理念论', '理念世界与现象世界的二分及洞穴喻'], ['亚里士多德四因说', '质料因、形式因、动力因与目的因'], ['斯多葛与伊壁鸠鲁', '德性伦理与快乐主义的两种路径']] },
      { id: 'b2', name: '中世纪哲学', en: 'Medieval', color: C.amber, topics: [['教父哲学', '奥古斯丁的上帝之城与内在经验'], ['经院哲学', '共相之争：唯实论与唯名论'], ['托马斯·阿奎那', '五路证明与自然神学的综合']] },
      { id: 'b3', name: '近代哲学', en: 'Modern', color: C.green, topics: [['唯理论', '笛卡尔我思、斯宾诺莎实体与莱布尼茨单子'], ['经验论', '洛克白板说、贝克莱存在即被感知、休谟怀疑论'], ['德国古典哲学', '康德三大批判、黑格尔辩证法']] },
      { id: 'b4', name: '现代哲学', en: 'Contemporary', color: C.teal, topics: [['现象学', '胡塞尔意向性与海德格尔此在分析'], ['存在主义', '萨特存在先于本质与加缪荒诞'], ['分析哲学', '维特根斯坦语言游戏与罗素逻辑原子论'], ['法兰克福学派', '阿多诺否定的辩证法与哈贝马斯交往理性']] },
      { id: 'b5', name: '哲学分支', en: 'Branches', color: C.pink, topics: [['形而上学', '存在、因果、时间与同一性'], ['认识论', '知识的辩护、确证与怀疑论回应'], ['伦理学', '义务论、后果论与德性伦理'], ['美学与政治哲学', '审美判断、正义理论与自由概念']] },
    ],
  },
  {
    id: 'accounting',
    name: '会计知识体系',
    nameEn: 'Accounting',
    category: '行业工作',
    description: '构建完整的财务领域会计知识体系，涵盖基础核算、财务报表、税务、审计与管理会计。',
    createdAt: '2026-07-22T14:10:00+08:00',
    updatedAt: '2026-07-22T14:10:00+08:00',
    branches: [
      { id: 'b1', name: '基础会计', en: 'Fundamentals', color: C.blue, topics: [['会计要素与等式', '资产=负债+所有者权益'], ['借贷记账法', '有借必有贷、借贷必相等的记账规则'], ['会计循环', '从凭证到报表的完整结转流程']] },
      { id: 'b2', name: '财务会计', en: 'Financial Accounting', color: C.amber, topics: [['收入确认', '五步法模型与合同履约义务识别'], ['金融资产', '三分类计量与减值模型'], ['合并报表', '控制判断与合并抵销分录']] },
      { id: 'b3', name: '管理会计', en: 'Management Accounting', color: C.green, topics: [['成本核算', '品种法、分批法与作业成本法'], ['本量利分析', '盈亏平衡点与边际贡献'], ['全面预算', '经营预算、资本预算与滚动预测']] },
      { id: 'b4', name: '税务', en: 'Taxation', color: C.teal, topics: [['增值税', '进项销项抵扣与税率适用'], ['企业所得税', '税前扣除、纳税调整与递延所得税'], ['税务筹划', '合法边界内的业务结构优化']] },
      { id: 'b5', name: '审计', en: 'Auditing', color: C.pink, topics: [['审计准则', '风险导向审计的基本流程'], ['内部控制', 'COSO 五要素与控制测试'], ['审计报告', '意见类型与关键审计事项']] },
    ],
  },
  {
    id: 'thinking',
    name: '思维知识体系',
    nameEn: 'Thinking',
    category: '通用知识',
    description: '本知识体系由 wiki1 思维元数据转换而来，将原有"场景层、概念层、实体层"的组装式知识库重构为 KSB-YAML 五文件架构。体系按 8 个一级分支展开，并把每个三级方法继续拆成输入识别、处理步骤、输出检验三个四级原子单元。',
    createdAt: '2026-07-21T16:40:00+08:00',
    updatedAt: '2026-07-21T16:40:00+08:00',
    branches: [
      { id: 'b1', name: '逻辑推理基础', en: 'Logical Reasoning', color: C.blue, topics: [['演绎推理', '从一般前提到个别结论的必然性推理'], ['归纳推理', '从个别事实概括出一般性结论'], ['溯因推理', '从结果反推最可能的解释']] },
      { id: 'b2', name: '结构化思维', en: 'Structured Thinking', color: C.amber, topics: [['MECE原则', '相互独立、完全穷尽的分类原则'], ['金字塔原理', '结论先行、以上统下的表达结构'], ['逻辑树', '把问题逐层分解为可验证的子问题']] },
      { id: 'b3', name: '系统思维', en: 'Systems Thinking', color: C.green, topics: [['因果回路图', '用增强/调节回路刻画系统动态'], ['系统基模', '增长上限、转移负担等经典结构'], ['涌现与反馈', '整体大于部分之和的机制']] },
      { id: 'b4', name: '批判性思维', en: 'Critical Thinking', color: C.teal, topics: [['论证分析', '识别前提、结论与隐含假设'], ['认知偏误', '确认偏误、锚定效应与可得性启发'], ['证据评估', '信息源可靠性与相关性判断']] },
      { id: 'b5', name: '创造性思维', en: 'Creative Thinking', color: C.pink, topics: [['发散与收敛', '先扩宽再筛选的双阶段方法'], ['类比迁移', '把其他领域的结构映射到当前问题'], ['第一性原理', '回到基本事实重新推导']] },
      { id: 'b6', name: '决策方法', en: 'Decision Making', color: C.purple, topics: [['决策矩阵', '多准则加权评分与敏感性分析'], ['期望值分析', '概率加权下的方案比较'], ['博弈思维', '考虑对手反应后的策略选择']] },
      { id: 'b7', name: '学习方法', en: 'Learning', color: C.brown, topics: [['费曼技巧', '用教别人的方式检验理解'], ['间隔重复', '按遗忘曲线安排复习节奏'], ['刻意练习', '在最近发展区做高反馈训练']] },
      { id: 'b8', name: '表达与沟通', en: 'Communication', color: C.slate, topics: [['结构化表达', 'SCQA 与总分总框架'], ['故事化叙述', '冲突-行动-结局的叙事弧'], ['视觉化呈现', '用图表与图示降低理解成本']] },
    ],
  },
  {
    id: 'itconsult',
    name: 'IT咨询顾问知识体系',
    nameEn: 'IT Consultant',
    category: '行业工作',
    description: '生成 IT 咨询顾问知识体系，涵盖信息化、数字化、AI 和智能化。覆盖业务、技术、管理。同时还需要报告沟通写作演讲等软技能。',
    createdAt: '2026-07-21T15:20:00+08:00',
    updatedAt: '2026-07-21T15:20:00+08:00',
    branches: [
      { id: 'b1', name: '行业与业务', en: 'Industry & Business', color: C.blue, topics: [['行业价值链', '从研发到交付的价值创造环节拆解'], ['业务流程建模', 'BPMN 与端到端流程梳理'], ['商业模式分析', '收入结构、成本结构与护城河']] },
      { id: 'b2', name: '企业架构', en: 'Enterprise Architecture', color: C.amber, topics: [['TOGAF', 'ADM 架构开发方法与四大架构域'], ['业务架构', '能力地图与价值流建模'], ['应用与数据架构', '系统集成模式与主数据管理']] },
      { id: 'b3', name: '数字化转型', en: 'Digital Transformation', color: C.green, topics: [['数字化成熟度', '评估模型与差距分析'], ['转型路线图', '速赢、攻坚与规模化三阶段'], ['变革管理', '干系人分析与推动策略']] },
      { id: 'b4', name: '技术方案', en: 'Technology Solution', color: C.teal, topics: [['云与基础设施', 'IaaS/PaaS/SaaS 选型与迁移策略'], ['数据平台', '数据湖仓、治理与指标体系'], ['AI 与智能化', '大模型落地场景与工程化路径']] },
      { id: 'b5', name: '咨询方法论', en: 'Consulting Methodology', color: C.pink, topics: [['问题树', '假设驱动的诊断框架'], ['标杆分析', '行业最佳实践对标'], ['价值论证', 'ROI 测算与商业案例']] },
      { id: 'b6', name: '交付与沟通', en: 'Delivery & Communication', color: C.purple, topics: [['方案文档', '咨询报告的结构与论证逻辑'], ['高层汇报', '一页纸结论与电梯演讲'], ['项目治理', '里程碑、风险与变更管理']] },
    ],
  },
  {
    id: 'cio',
    name: 'CIO知识体系',
    nameEn: 'CIO',
    category: '通用知识',
    description: '该知识体系覆盖 CIO 从信息化建设负责人到数字化经营伙伴，再到 AI 赋能与智能化转型推动者的角色演进。它以企业核心价值链和支撑业务域为业务基础，以治理、企业架构、流程、数据、平台、交付、运营、安全、组织和创新为能力主轴。',
    createdAt: '2026-07-21T11:15:00+08:00',
    updatedAt: '2026-07-21T11:15:00+08:00',
    branches: [
      { id: 'b1', name: '战略与业务价值', en: 'Strategy & Value', color: C.blue, topics: [['IT战略规划', '业务战略到 IT 举措的映射'], ['价值度量', 'IT 投入产出与业务贡献评估'], ['产品研发与项目管理', '从需求到交付的组合管理']] },
      { id: 'b2', name: '企业架构与流程', en: 'EA & Process', color: C.amber, topics: [['架构治理', '架构评审、原则与例外管理'], ['流程体系', 'L1-L5 流程分级与责任矩阵'], ['业务能力地图', '能力热力图与投资优先级']] },
      { id: 'b3', name: '数据与AI治理', en: 'Data & AI Governance', color: C.green, topics: [['数据治理', '主数据、元数据与质量体系'], ['指标体系', '经营分析指标树与口径管理'], ['AI 治理', '模型风险、合规与伦理审查']] },
      { id: 'b4', name: '数字平台与应用', en: 'Platform', color: C.teal, topics: [['中台与平台化', '共享服务能力沉淀'], ['云原生架构', '容器、微服务与可观测性'], ['应用组合管理', '系统生命周期与退役策略']] },
      { id: 'b5', name: '交付与运营', en: 'Delivery & Ops', color: C.pink, topics: [['敏捷与DevOps', '持续交付流水线与质量门禁'], ['IT服务管理', 'ITIL 事件、问题与变更流程'], ['供应商管理', '外包治理与服务水平协议']] },
      { id: 'b6', name: '安全与风险', en: 'Security & Risk', color: C.purple, topics: [['网络安全', '等保、零信任与边界防护'], ['业务连续性', '容灾等级与演练机制'], ['合规审计', '数据安全法与行业监管要求']] },
      { id: 'b7', name: '组织与领导力', en: 'Organization & Leadership', color: C.brown, topics: [['IT组织设计', '职能型/产品型组织与人才梯队'], ['变革领导', '数字化文化与非职权影响力'], ['创新管理', '创新机制、试点与规模化']] },
    ],
  },
  {
    id: 'fde',
    name: 'FDE知识体系',
    nameEn: 'Forward Deployed Engineer',
    category: '行业工作',
    description: 'FDE 前线实施工程师是 Palantir 首创并实践的创新型技术角色。其核心定位是"部署到前线的工程师"——不是在办公室里做方案，而是深入客户现场面对真实数据、真实流程、真实痛点。FDE 同时具备传统售前解决方案顾问的业务理解力与全栈工程师的交付能力。',
    createdAt: '2026-07-21T09:40:00+08:00',
    updatedAt: '2026-07-21T09:40:00+08:00',
    branches: [
      { id: 'b1', name: '业务洞察力', en: 'Business Insight', color: C.blue, topics: [['行业Know-how', '客户所在行业的流程、术语与关键指标'], ['业务价值建模', '把痛点翻译成可量化的业务收益'], ['干系人地图', '决策链、影响者与阻力来源识别']] },
      { id: 'b2', name: '技术工程力', en: 'Technical Engineering', color: C.green, topics: [['Foundry平台核心架构', '本体、管道与应用三层结构'], ['Ontology设计最佳实践', '对象类型、关系与动作建模'], ['数据管道工程', '接入、清洗、转换与调度'], ['全栈开发', '前端交互与后端服务快速搭建']] },
      { id: 'b3', name: '解决方案力', en: 'Solution', color: C.amber, topics: [['架构设计思维', '系统架构、数据架构与集成架构'], ['解决方案故事线', '从痛点到价值的叙事结构'], ['Demo场景设计', '15 分钟打动客户的演示脚本'], ['从PoC到规模化', '验证、定价与推广路径']] },
      { id: 'b4', name: 'AI增能', en: 'AI Enablement', color: C.purple, topics: [['Prompt Engineering', '结构化提示与评测闭环'], ['AI工具链应用', '模型选型、RAG 与 Agent 编排'], ['AI驱动的交付加速', '用 AI 生成原型、文档与测试']] },
      { id: 'b5', name: '交付与变革力', en: 'Delivery & Change', color: C.pink, topics: [['敏捷交付管理', '迭代节奏、增量交付与风险升级'], ['用户采纳与变革推动', '培训体系、反馈闭环与标杆案例'], ['一线问题解决', '现场故障排查与临时方案权衡']] },
      { id: 'b6', name: '沟通与领导力', en: 'Communication & Leadership', color: C.slate, topics: [['跨层级沟通', '对高管讲价值、对工程师讲细节'], ['写作与文档能力', '方案书、周报与复盘的结构化写作'], ['演讲与汇报', '控场、答疑与异议处理']] },
    ],
  },
  {
    id: 'finance',
    name: '金融知识体系',
    nameEn: 'Finance',
    category: '行业工作',
    description: '本知识体系整合了金融学的主要分支，包括货币市场、投资学、公司金融、风险管理、资产定价、衍生品和国际金融，为学习者提供从基础概念到高级应用的完整认知框架。通过结构化的知识点组织，帮助使用者建立金融思维，掌握分析方法与实务工具。',
    createdAt: '2026-07-21T10:30:00+08:00',
    updatedAt: '2026-07-21T10:30:00+08:00',
    branches: [
      { id: 'b1', name: '货币与金融市场', en: 'Money & Markets', color: C.blue, topics: [['货币供给与货币政策', '基础货币、货币乘数与三大政策工具'], ['利率与收益率曲线', '期限结构理论与利率风险管理'], ['金融市场结构', '一级/二级市场与做市机制']] },
      { id: 'b2', name: '投资学', en: 'Investments', color: C.green, topics: [['资产配置', '均值方差优化与风险平价'], ['组合理论', 'CAPM、APT 与因子模型'], ['行为金融', '有限理性与市场异象']] },
      { id: 'b3', name: '公司金融', en: 'Corporate Finance', color: C.amber, topics: [['资本预算', 'NPV、IRR 与实物期权'], ['资本结构', 'MM 定理、税盾与破产成本'], ['股利政策', '信号理论与代理成本']] },
      { id: 'b4', name: '资产定价', en: 'Asset Pricing', color: C.teal, topics: [['债券定价', '久期、凸性与信用利差'], ['股票估值', 'DCF、相对估值与剩余收益模型'], ['有效市场假说', '弱式/半强式/强式三种形式']] },
      { id: 'b5', name: '金融衍生品', en: 'Derivatives', color: C.pink, topics: [['远期与期货', '套期保值与基差风险'], ['期权定价', 'Black-Scholes 与二叉树模型'], ['互换与结构化产品', '利率互换、CDS 与收益凭证']] },
      { id: 'b6', name: '风险管理', en: 'Risk Management', color: C.purple, topics: [['VaR与压力测试', '历史模拟、参数法与极值理论'], ['信用风险', 'PD/LGD/EAD 与信用评级模型'], ['操作风险', '损失分布法与内控体系']] },
      { id: 'b7', name: '国际金融', en: 'International Finance', color: C.brown, topics: [['汇率决定理论', '购买力平价与利率平价'], ['国际收支', '经常账户与资本账户的平衡'], ['跨境资本流动', '套息交易与金融危机传染']] },
    ],
  },
  {
    id: 'highschool',
    name: '高中理科知识体系',
    nameEn: 'High School Science',
    category: '通用知识',
    description: '中国高中理科教育是培养科学素养和理性思维的基础阶段，涵盖数学（理性思维的语法与工具）、物理（物质世界的运动规律）、化学（物质的组成、结构与变化）和生物（生命现象与规律）四大核心学科。本知识体系严格参照教育部课程标准组织。',
    createdAt: '2026-07-21T08:50:00+08:00',
    updatedAt: '2026-07-21T08:50:00+08:00',
    branches: [
      { id: 'b1', name: '数学', en: 'Mathematics', color: C.blue, topics: [['函数与导数', '函数性质、导数运算与单调性极值'], ['数列与不等式', '等差等比数列与放缩法'], ['立体几何', '空间向量与线面角、二面角计算'], ['概率统计', '古典概型、条件概率与正态分布'], ['解析几何', '圆锥曲线方程与直线联立']] },
      { id: 'b2', name: '物理', en: 'Physics', color: C.amber, topics: [['运动学与动力学', '匀变速运动、牛顿三定律与受力分析'], ['功与能', '动能定理、机械能守恒'], ['电磁学', '电场、磁场、电磁感应与楞次定律'], ['热学与光学', '理想气体状态方程与几何光学'], ['近代物理', '光电效应、原子结构与核反应']] },
      { id: 'b3', name: '化学', en: 'Chemistry', color: C.green, topics: [['物质结构与元素周期律', '原子结构、化学键与周期性递变'], ['化学反应原理', '反应速率、化学平衡与电化学'], ['有机化学基础', '官能团性质与有机合成路线'], ['实验化学', '常见仪器、分离提纯与定量分析']] },
      { id: 'b4', name: '生物', en: 'Biology', color: C.teal, topics: [['细胞与代谢', '细胞结构、酶与光合呼吸'], ['遗传与进化', '孟德尔定律、基因表达与自然选择'], ['稳态与调节', '神经-体液-免疫调节网络'], ['生态系统', '种群、群落与能量流动']] },
    ],
  },
];
