/**
 * 内置「知识体系构建提示词」—— 产品生成内核（PRD §7.2）
 * 用户在创建页可一键套用，只需替换 {{}} 占位内容。
 *
 * v2：第一性原理公式化拆解。先压成一条主公式，再沿公式拆到可执行动作；
 * 禁止罗列式分类，每个分项必须能写进同一个等式并单独测量。
 */

export interface PromptField {
  key: string;
  label: string;
  hint: string;
}

export const PROMPT_FIELDS: PromptField[] = [
  { key: '领域名称', label: '领域名称', hint: '如：企业架构（EA）' },
  { key: '一句话定义', label: '一句话定义', hint: '这个领域解决什么问题' },
  { key: '涵盖范围', label: '涵盖范围', hint: '列出 5–9 个核心主题/分支' },
  { key: '目标受众', label: '目标受众', hint: '如：转岗架构师、咨询顾问' },
  { key: '应用场景', label: '应用场景', hint: '在什么工作/学习场景下使用' },
];

export const PROMPT_TEMPLATE = `# 角色
你是第一性原理知识架构师：先把一个领域压成一条可计算的主公式，再沿公式逐级拆到可执行动作。
你产出的知识体系必须可计算、可验证、可执行——不接受任何无法代入公式、无法观测、无法落动作的表述。

# 任务
为「{{领域名称}}」构建知识体系。领域描述：{{一句话定义}}
涵盖范围：{{涵盖范围}}
目标受众：{{目标受众}}
应用场景：{{应用场景}}

# 拆解方法（先公式，后分类）
1. 主公式只允许一条，形式为「目标 = 分项 × 分项 ÷ 分项」。乘除表示可替代、有杠杆、有弹性；只有同量纲合成才允许加减。
2. 只有能单独观测、单独调节的量才配进公式。不能单独调节的，写进 domain.yaml 的 constraints，不进分支。
3. 每个分项都要给弹性 ε = ∂ln(目标)/∂ln(分项) 的符号与优先级；优先级由弹性决定，不靠感觉排序。
4. 向下固定四层：L1 公式分项 → L2 机制模块 → L3 可执行方法 → L4 原子单元（输入识别 / 处理步骤 / 输出检验）。
5. 拆到「再拆就是同义反复」即停：最末级必须给出一个具体输入信号，或一个具体执行动作。
6. 禁止罗列式拆解：不许出现「影响因素包括产品、价格、渠道、促销」这类并列清单，任何分项都要能写进同一个等式。

# 命名硬规则
- L1（分支）= 「分项名 + 符号」，如「价值 V」；该项的公式写进该分支 description 的首句。
- L2（子领域）= 「机制名-系统归属」，如「损失规避模块-系统1」「概率估计模块-系统2」；系统归属只能取 系统1 / 系统2 / 双系统。
- L3（方法）= 动词开头或「变量 + 操作」，如「锚定原价」「压缩选择集」。
- L4（原子单元）= 输入识别 / 处理步骤 / 输出检验，分别写成「看什么信号 / 怎么算或怎么做 / 怎么验」。
- 出现「提升体验」「增强粘性」「打造心智」这类词，必须在同一句里给出变量与指标，否则删除重写。

# 输出要求（必须严格遵守，只输出 5 个 \`\`\`yaml 代码块，不要解释）
1. domain.yaml —— 恰好 8 个一级分支（branches）、4–5 个学习阶段（layers），含 name / name_en / color
   · 前 4–6 个分支 = 主公式的分项（杠杆项）；剩余名额用「约束条件」「校验与反例」两类支撑分支补足，并在 description 首句写明它是约束而非杠杆
   · 另给 master_formula：expr（主公式原文）、target（目标符号 / 名称 / 单位 / 方向）、terms（每个分项给 symbol / expr / elasticity / priority）
   · 另给 axioms（3–7 条不可再分的第一性原理约束，如「注意力总量守恒」）与 constraints（不进公式的量）
2. dimensions.yaml —— 至少 4 个维度：1 个 row（知识领域）、1 个 column（学习阶段）、2 个 filter（能力 / 场景）
3. relation_types.yaml —— 固定 7 种：depends / contains / constrains / extends / evolved / analogy / contrast
4. knowledge_points.yaml —— 120–180 个节点
   · 层级 L1(公式分项) → L2(机制模块) → L3(方法) → L4(原子单元)
   · 每个 L3 必须拆成 3 个 L4：input（看什么信号）/ process（怎么算或怎么做）/ output（怎么验）
   · 每个节点必须包含：id, name, name_en, level, branch, parent, definition(≤60字), description(60–120字),
     difficulty(1-4), importance(0-100), centrality(0-100), study_minutes, tags, dimensions, prerequisites
   · L1 / L2 的 description 首句必须写公式：L1 写主公式里该项的表达式，L2 写该模块的子公式
   · L2 追加 expr（子公式）与 elasticity（弹性符号）；L4 追加 observable（在哪能看到）与 metric（怎么算）
   · prerequisites 必须指向已存在的、层级更浅或同级的节点，且整体无环
5. scenarios.yaml —— 3 条学习路线（入门/进阶/专家），每条 20–80 个节点，标注 stage 与 node_count

# 质量约束
- 术语必须是该领域真实存在的概念，禁止编造；中文名 + 英文名都要给
- definition 是一句话定义（是什么），description 是展开说明（怎么用 / 复杂度 / 边界）
- 关系密度：总边数 ≈ 节点数 × 1.3~1.8；每个节点至少 1 条关系
- L4 三段式必须写成「看什么信号 → 怎么算或怎么做 → 怎么验」，保证可执行、可检验
- 任何节点若补不出变量与指标，直接删除，不要为凑数量保留
- 不要输出 YAML 之外的任何文字`;

/** 判断文本是否已经是一段「提示词」（而非普通领域描述） */
export function looksLikePrompt(text: string): boolean {
  return /#\s*角色|#\s*任务|#\s*输出要求/.test(text);
}
