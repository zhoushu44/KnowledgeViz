/**
 * 「学习内容」生成器 v2
 *
 * 目标：产出「读完能多做一件事」的材料，而不是把标题扩写成三段话。
 *
 * 针对旧版三个失败模式的设计约束：
 *  1. 内置模板不再假装是学习内容 —— 它只做「节点体检」：引用真实定义、列出真实结构位置、
 *     点名缺口。模板永远不会生成「它是把上游结论推进到可执行结果的关键一环」这类放之四海皆准的句子。
 *  2. AI 生成前后都过质检（lintLearning）：空话、复述定义、没有具体物的小节会被判低分，
 *     低于阈值自动回炉一次（把 issues 原样丢回给模型修）。
 *  3. 源头定义退化的节点（详细描述 = 定义）会被点名，并让模型回填一版可用的定义建议，
 *     用户可一键采纳 —— 否则再好的文案也只是在空定义上打转。
 */
import type { KnowledgePoint, LearningContent, LearningSection } from './types';
import { chat, loadLlmConfig } from './llm';
import { searchMany, extractMany, netAvailable } from './net';

const UNIT_LABEL: Record<string, string> = { input: '输入识别', process: '处理步骤', output: '输出检验' };

/* ------------------------------------------------------------------ *
 * 结构上下文
 * ------------------------------------------------------------------ */

export interface NodeContext {
  /** 祖先（不含自身），从根到直接上级 */
  ancestors: KnowledgePoint[];
  parent?: KnowledgePoint;
  children: KnowledgePoint[];
  siblings: KnowledgePoint[];
  prereqs: KnowledgePoint[];
  /** 以本节点为前置的下游节点 */
  downstream: KnowledgePoint[];
}

export function pathOf(node: KnowledgePoint, all: Map<string, KnowledgePoint>): KnowledgePoint[] {
  const out: KnowledgePoint[] = [];
  let cur = node.parent ? all.get(node.parent) : undefined;
  let guard = 0;
  while (cur && guard++ < 12) {
    out.unshift(cur);
    cur = cur.parent ? all.get(cur.parent) : undefined;
  }
  return out;
}

export function nodeContext(node: KnowledgePoint, all: Map<string, KnowledgePoint>): NodeContext {
  const children = [...all.values()].filter((n) => n.parent === node.id);
  const siblings = [...all.values()].filter((n) => n.parent && n.parent === node.parent && n.id !== node.id);
  const prereqs = node.prerequisites.map((id) => all.get(id)).filter(Boolean) as KnowledgePoint[];
  const downstream = [...all.values()].filter((n) => n.id !== node.id && n.prerequisites.includes(node.id));
  return {
    ancestors: pathOf(node, all),
    parent: node.parent ? all.get(node.parent) : undefined,
    children,
    siblings,
    prereqs,
    downstream,
  };
}

/* ------------------------------------------------------------------ *
 * 退化检测与空话检测
 * ------------------------------------------------------------------ */

const norm = (s: string) =>
  String(s ?? '')
    .replace(/[\s\u3000，。、；：""''（）()【】\[\]·—\-~!?！？,.:;]/g, '')
    .toLowerCase();

/**
 * 判断节点的原始定义是否「没说任何东西」。
 * 返回 null 表示定义可用；否则返回一句人话的原因。
 */
export function degenerateReason(
  node: Pick<KnowledgePoint, 'name' | 'definition' | 'description'>
): string | null {
  const def = norm(node.definition);
  const desc = norm(node.description);
  const name = norm(node.name);
  if (!def) return '定义为空';
  if (name && def === name) return '定义只有节点名本身，没有解释';
  if (desc && def === desc) return '「详细描述」与「定义」完全相同，等于只写了一遍';
  const rest = name ? def.split(name).join('') : def;
  if (rest.length < 6 && def.length < 20) return '定义几乎是标题的改写，没有可学的信息';
  return null;
}

const FILLER_RE =
  /关键一环|承上启下|重要组成部分|无法落地|提供支撑|发挥重要作用|扮演重要角色|提升体验|增强粘性|打造心智|众所周知|综上所述|不可或缺|赋能|抓手|随着.{0,6}的发展|在.{0,10}中(具有|起)重要(意义|作用)/g;

/** 文本里命中的空话（去重） */
export function findFiller(text: string): string[] {
  const hits = String(text ?? '').match(FILLER_RE) ?? [];
  return [...new Set(hits)];
}

/** 是否含「可核验的具体物」：数字、书名、英文术语、实验/步骤/案例等 */
const CONCRETE_RE =
  /[0-9０-９]|《[^》]{1,40}》|[A-Za-z]{3,}|实验|研究|定理|公式|案例|反例|步骤|第[一二三四五六七八九十0-9]+|例如|比如/;

export function hasConcrete(text: string): boolean {
  return CONCRETE_RE.test(String(text ?? ''));
}

/* ------------------------------------------------------------------ *
 * 质检
 * ------------------------------------------------------------------ */

export interface LintIssue {
  level: 'error' | 'warn';
  /** 出问题的字段：node / goals / sections[2] / practice … */
  field: string;
  text: string;
}

export type LintGrade = 'real' | 'thin' | 'filler';

export interface LintResult {
  score: number;
  grade: LintGrade;
  issues: LintIssue[];
  summary: string;
}

/**
 * 给学习内容打分。分数只做一件事：让「占位/空话」和「真材料」在界面上立即可分。
 * 不是学术评测，是产品门禁 —— 低于 75 分默认要求模型回炉一次。
 */
export function lintLearning(node: KnowledgePoint, content: LearningContent | null): LintResult {
  const issues: LintIssue[] = [];

  if (!content) {
    return {
      score: 0,
      grade: 'filler',
      issues: [{ level: 'error', field: 'content', text: '还没有学习内容' }],
      summary: '空',
    };
  }

  const deg = degenerateReason(node);
  if (deg) issues.push({ level: 'error', field: 'node', text: `源头定义有问题：${deg}` });

  if (content.source === 'template') {
    issues.push({
      level: 'error',
      field: 'source',
      text: '当前是内置占位模板：只复述定义与结构位置，不含该领域的真实知识',
    });
  }

  const goals = content.goals ?? [];
  if (goals.length < 2) issues.push({ level: 'warn', field: 'goals', text: `目标只有 ${goals.length} 条` });
  const tplGoal = goals.find((g) => /能说出它和上下游节点|能一句话向同事解释/.test(g));
  if (tplGoal) issues.push({ level: 'error', field: 'goals', text: `目标还是模板句式：${tplGoal.slice(0, 24)}…` });

  const sections = content.sections ?? [];
  if (sections.length < 2) {
    issues.push({ level: 'error', field: 'sections', text: `只有 ${sections.length} 个小节，不足以讲清一个知识点` });
  }
  sections.forEach((s, i) => {
    const body = String(s.body ?? '');
    if (body.trim().length < 60) {
      issues.push({ level: 'error', field: `sections[${i}]`, text: `小节「${s.title}」只有 ${body.trim().length} 字` });
    }
    if (!hasConcrete(body)) {
      issues.push({
        level: 'warn',
        field: `sections[${i}]`,
        text: `小节「${s.title}」没有任何具体物（数字/术语/实验/步骤）`,
      });
    }
    const filler = findFiller(body);
    if (filler.length) {
      issues.push({ level: 'warn', field: `sections[${i}]`, text: `小节「${s.title}」有空话：${filler.join('、')}` });
    }
    // 直接把定义原样抄一遍，算复述
    if (body.trim() && norm(body).includes(norm(node.definition)) && norm(node.definition).length > 12) {
      issues.push({ level: 'warn', field: `sections[${i}]`, text: `小节「${s.title}」只是把定义抄了一遍` });
    }
  });

  if (!content.practice || content.practice.trim().length < 15) {
    issues.push({ level: 'warn', field: 'practice', text: '没有可执行的练习' });
  }
  if ((content.pitfalls?.length ?? 0) < 2) {
    issues.push({ level: 'warn', field: 'pitfalls', text: '常见误区不足 2 条' });
  }

  const errors = issues.filter((i) => i.level === 'error').length;
  const warns = issues.filter((i) => i.level === 'warn').length;
  // 计分权重：节点源头问题不该压垮「内容质量」分（它另有独立提示卡），所以单独计 8 分
  const penalty = issues.reduce((s, i) => s + (i.field === 'node' ? 8 : i.level === 'error' ? 16 : 5), 0);
  let score = Math.max(0, Math.min(100, 100 - penalty));
  // 模板是「体检单」不是内容：分数只反映节点结构完整度，恒定落在不及格带
  if (content.source === 'template') {
    score = Math.max(12, Math.min(35, 35 - errors * 4 - warns * 2));
  }
  void errors;
  void warns;

  const grade: LintGrade = score >= 75 ? 'real' : score >= 45 ? 'thin' : 'filler';
  const summary = grade === 'real' ? '可学' : grade === 'thin' ? '偏薄' : '占位/空话';
  return { score, grade, issues, summary };
}

/* ------------------------------------------------------------------ *
 * 内置模板 → 节点体检单
 * ------------------------------------------------------------------ */

/**
 * 本地模板：0 等待，但它只做「体检」，不做「讲解」。
 * 它保证两件事：① 引用的是节点真实内容，不是套话；② 明确告诉你还缺什么、下一步做什么。
 */
export function templateLearning(node: KnowledgePoint, all: Map<string, KnowledgePoint>): LearningContent {
  const ctx = nodeContext(node, all);
  const path = ctx.ancestors.map((a) => a.name);
  const deg = degenerateReason(node);
  const unit = node.unit ? UNIT_LABEL[node.unit] : '';
  const isL4 = node.level === 'L4';

  const goals = isL4
    ? [
        `能说清「${node.name}」这一步在「${ctx.parent?.name ?? node.branch}」里承担什么角色`,
        `能按${unit || '本单元'}的要求写出这一步的输入、动作、验收标准`,
      ]
    : [
        `能用一句话说清「${node.name}」是什么、解决什么问题`,
        ctx.children.length
          ? `能说出它下面 ${ctx.children.length} 个子节点各自的分工`
          : `能说出它的前置（${ctx.prereqs.map((p) => p.name).join('、') || '无'}）和下游分别是什么`,
      ];

  const defLine = node.definition?.trim();
  const descLine = node.description?.trim();
  const gapRows: string[] = [];
  if (!defLine) gapRows.push('定义是空的');
  else if (deg) gapRows.push(deg);
  if (!descLine || (descLine && defLine && norm(descLine) === norm(defLine))) gapRows.push('没有独立的详细描述');
  if (!node.examples?.length) gapRows.push('没有示例');
  if (!node.resources?.length) gapRows.push('没有资源（书 / 文章 / 课程）');
  if (!ctx.children.length && node.level !== 'L4') gapRows.push('没有下级节点，拆解还没做到可执行粒度');
  if (!ctx.prereqs.length) gapRows.push('没有前置依赖，学习顺序无从判断');

  const sections: LearningSection[] = [
    {
      title: '原文（这个节点当前写了什么）',
      body:
        `定义：${defLine || '（空）'}` +
        (descLine && norm(descLine) !== norm(defLine) ? `\n\n详细描述：${descLine}` : '\n\n详细描述：与定义相同，没有补充。'),
    },
    {
      title: '它在体系里的位置',
      body:
        (path.length ? `上级路径：${path.join(' › ')} › ${node.name}。\n` : `本节点是根节点。\n`) +
        `层级：${node.level}${unit ? `（${unit}）` : ''}；难度 ${node.difficulty}/4；建议 ${node.studyMinutes} 分钟。\n` +
        (ctx.children.length
          ? `下级 ${ctx.children.length} 个：${ctx.children.slice(0, 6).map((c) => c.name).join('、')}${ctx.children.length > 6 ? '…' : ''}。\n`
          : '') +
        (ctx.prereqs.length ? `前置：${ctx.prereqs.map((p) => p.name).join('、')}。\n` : '') +
        (ctx.downstream.length ? `下游：${ctx.downstream.slice(0, 6).map((p) => p.name).join('、')}。` : ''),
    },
    {
      title: '缺口清单（模板只能查到这里）',
      body: gapRows.length
        ? gapRows.map((g, i) => `${i + 1}) ${g}`).join('\n') +
          '\n\n这些缺口不补，任何生成出来的「学习内容」都只是把标题换个说法。'
        : '结构完整（有定义、描述、示例与资源）。可以直接点「AI 重写」联网取证，生成可学的正文。',
    },
    {
      title: '下一步怎么补',
      body:
        '1) 点上方「AI 重写」：会联网检索该主题的真实资料（3 个角度并发，取正文片段），再按硬约束生成 3 节正文；\n' +
        '2) 如果定义本身有问题，采纳 AI 给出的「建议定义」，或点右上「编辑」自己改；\n' +
        '3) 想长期有效，回到 YAML 的 examples / resources 字段补一条真实案例和一个来源 —— 这两项是后续所有生成的底料。',
    },
  ];

  return {
    goals,
    sections,
    practice:
      `10 分钟：合上页面，把「${node.name}」讲给一个完全不懂的人听，让对方复述「它是干什么的、什么时候用」。` +
      `对方复述不出来，说明你还停在背名词。把你的讲解压成 3 行写下来，保存进这个节点。`,
    pitfalls: [
      `只记住「${node.name}」这个名字，说不出它解决什么问题`,
      ...(deg ? [`照抄定义当理解 —— 本节点现在的定义与描述是同一句话（${deg}）`] : []),
      ...(ctx.prereqs.length ? [`把它和前置「${ctx.prereqs[0].name}」混为一谈`] : []),
    ],
    further: [
      ...(ctx.prereqs.length ? [`先补齐前置：${ctx.prereqs.map((p) => p.name).join('、')}`] : []),
      '点「AI 重写」联网取证，生成带机制、边界和失败案例的正文',
    ],
    source: 'template',
    updatedAt: new Date().toISOString(),
  };
}

/* ------------------------------------------------------------------ *
 * 导出 Markdown
 * ------------------------------------------------------------------ */

export function learningToMarkdown(node: KnowledgePoint, l: LearningContent, lint?: LintResult): string {
  const lines: string[] = [`# ${node.name}${node.nameEn ? `（${node.nameEn}）` : ''}`, ''];
  if (lint) lines.push(`> 质检：${lint.score}/100（${lint.summary}）`, '');
  if (l.goals?.length) {
    lines.push('## 学完能做到', ...l.goals.map((g) => `- ${g}`), '');
  }
  for (const s of l.sections ?? []) {
    lines.push(`## ${s.title}`, '', s.body, '');
  }
  if (l.practice) lines.push('## 动手练习', '', l.practice, '');
  if (l.pitfalls?.length) lines.push('## 常见误区', ...l.pitfalls.map((p) => `- ${p}`), '');
  if (l.further?.length) lines.push('## 延伸', ...l.further.map((f) => `- ${f}`), '');
  if (l.sources?.length) lines.push('## 依据', ...l.sources.map((u) => `- ${u}`), '');
  return lines.join('\n');
}

/* ------------------------------------------------------------------ *
 * AI 生成
 * ------------------------------------------------------------------ */

const AI_SYSTEM = `你是某个领域的资深讲师，负责把知识点写成「可以直接照着学、学完能多做一件事」的材料。
你痛恨把标题扩写成三段话的写法：凡是读完不能改变任何行为的句子，一律不许写。
只输出一个 JSON 对象，不要 markdown 围栏，不要解释。`;

export interface AiLearningResult {
  content: LearningContent;
  /** 当原定义退化时，模型回填的一版可用定义 */
  suggested?: { definition?: string; description?: string };
  lint: LintResult;
  /** 回炉轮数：0 = 一次过，1 = 修过一次 */
  rounds: number;
  sources: string[];
  elapsedMs: number;
}

/** 联网取证：3 个角度搜索 + 抓前 2 篇正文片段，给模型真实表述 */
async function gatherWebBrief(node: KnowledgePoint, ctx: NodeContext) {
  const sources: string[] = [];
  const snippets: string[] = [];
  if (!netAvailable()) return { sources, brief: '' };

  try {
    const hint = ctx.ancestors.slice(-1)[0]?.name ?? '';
    const bundles = await searchMany(
      [
        `${node.name} 原理 机制 出处`,
        `${node.name} 教程 实操步骤 案例`,
        `${node.name} 常见错误 边界 反例`,
      ].map((q) => (hint ? `${hint} ${q}` : q)),
      { maxResults: 4, depth: 'advanced' }
    );

    const seen = new Set<string>();
    const picked: { url: string; title: string; content: string }[] = [];
    for (const b of bundles) {
      for (const h of b.results ?? []) {
        if (!h.url || seen.has(h.url)) continue;
        seen.add(h.url);
        picked.push({ url: h.url, title: h.title, content: String(h.content ?? '') });
      }
    }

    // 抓正文：只取前 2 篇，控制等待时间；失败不影响整体
    const top = picked.slice(0, 2);
    if (top.length) {
      try {
        const rows = await extractMany(top.map((p) => p.url), { batch: 2, maxChars: 1800 });
        for (const r of rows) {
          if (!r?.content || (r.chars ?? 0) < 300) continue;
          snippets.push(`【${r.title || r.url}】\n${r.content.replace(/\s+/g, ' ').slice(0, 1400)}`);
        }
      } catch {
        /* 抓正文失败就只用搜索摘要 */
      }
    }

    for (const p of picked) {
      if (sources.length >= 5) break;
      sources.push(p.url);
      if (snippets.length >= 3) break;
      const snip = p.content.replace(/\s+/g, ' ').slice(0, 150);
      if (snip.length > 40) snippets.push(`- ${p.title}：${snip}`);
    }
  } catch {
    /* 联网不可用：退化为纯模型生成 */
  }

  return { sources, brief: snippets.slice(0, 5).join('\n\n') };
}

function buildPrompt(node: KnowledgePoint, projectName: string, ctx: NodeContext, brief: string, deg: string | null): string {
  const unit = node.unit ? UNIT_LABEL[node.unit] : '';
  return `知识体系：${projectName}
节点：${node.name}${node.nameEn ? `（${node.nameEn}）` : ''}
层级：${node.level}${unit ? ` · ${unit}` : ''}
上级路径：${ctx.ancestors.map((a) => a.name).join(' › ') || '（根节点）'}
${ctx.children.length ? `下级节点（${ctx.children.length}）：${ctx.children.slice(0, 8).map((c) => c.name).join('、')}` : ''}
${ctx.prereqs.length ? `前置节点：${ctx.prereqs.map((p) => p.name).join('、')}` : ''}
${ctx.downstream.length ? `下游节点：${ctx.downstream.slice(0, 8).map((p) => p.name).join('、')}` : ''}
现有定义：${node.definition?.trim() || '（空）'}
现有描述：${node.description?.trim() || '（空）'}
${node.examples?.length ? `现有示例：${node.examples.slice(0, 2).join(' / ')}` : ''}
${deg ? `\n注意：该节点现有定义不达标（${deg}）。请在 JSON 里额外给出 suggested_definition 与 suggested_description。\n` : ''}
${brief ? `\n以下是联网检索到的该主题真实资料片段。术语、机制名、数字必须与此对齐，不许编造：\n\n${brief}\n` : ''}
请写一份能让人读完就多做一件事的学习材料，输出 JSON：

{
  "goals": ["动词开头、可验证，2-3 条"],
  "sections": [
    {"title": "它到底是什么", "body": "120-200 字：给出机制/定义，指名道姓（作者、年份、术语），不要复述标题"},
    {"title": "怎么用 / 怎么运作", "body": "120-200 字：分步骤，每步可执行，含数字或判断阈值"},
    {"title": "什么时候不适用", "body": "120-200 字：边界条件 + 一个真实的失败/误用案例"}
  ],
  "practice": "20-30 分钟能做完，产出是一个可检查的物件（清单/对照表/一句话结论）",
  "pitfalls": ["2-3 条真实易错点，不要写「只背名词」这类通用废话"],
  "further": ["2 条下一步：该读什么、该做什么"],
  ${deg ? '"suggested_definition": "≤60 字，一句话说清它是什么",\n  "suggested_description": "60-120 字，写清怎么用、边界在哪",' : ''}
}

硬性要求（不满足会被质检打回重写）：
A. 每个小节必须至少含 1 个可核验的具体物：真实机制名/术语、实验或研究（作者+年份）、数字、公式、书名、工具名或命令。写不出就删掉这一节。
B. 禁止这些词：关键一环、承上启下、重要组成部分、无法落地、提供支撑、发挥重要作用、提升体验、增强粘性、打造心智、众所周知、综上所述、不可或缺、赋能、抓手。
C. 字数预算（超了会被截断，务必遵守）：goals 共 ≤70 字；每节 body 必须是 120–200 字；practice ≤80 字；pitfalls 每条 ≤40 字；further 每条 ≤30 字；**全文总字数 ≤900 字**。
D. 至少一条明确的「在什么条件下这个结论不成立」。
E. practice 不许写「思考一下」「结合自身情况」—— 必须产出可检查的物件。
F. 术语真实，不确定就不写；禁止编造论文名、作者、年份、数字。
G. 只写 3 个小节，不要 4 个以上；不要 markdown 加粗、不要编号列表套列表。
${node.level === 'L4' ? 'H. 这是 L4 原子单元，按「输入识别 / 处理步骤 / 输出检验」的口径写，不要泛化成方法论。' : ''}`;
}

function asStrings(v: unknown, max = 8): string[] {
  return Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean).slice(0, max) : [];
}

function toContent(node: KnowledgePoint, json: any): LearningContent {
  const sections: LearningSection[] = Array.isArray(json?.sections)
    ? json.sections
        .filter((s: any) => s && typeof s.title === 'string')
        .slice(0, 8)
        .map((s: any) => ({ title: String(s.title).trim(), body: String(s.body ?? '').trim() }))
        .filter((s: LearningSection) => s.title && s.body)
    : [];
  // 小节正文都没写全（截断残留只有一个 title）：整批丢弃，交给上层报错或回炉
  const solid = sections.filter((s) => s.body.length >= 40);
  if (solid.length < 2) throw new Error('模型返回的小节不完整（可能被截断），请重试');
  return {
    goals: asStrings(json.goals, 5),
    sections: solid.slice(0, 4),
    practice: typeof json.practice === 'string' ? json.practice.trim() : '',
    pitfalls: asStrings(json.pitfalls, 5),
    further: asStrings(json.further, 5),
    source: 'ai',
    updatedAt: new Date().toISOString(),
  };
}

/** 调用模型生成学习内容：联网取证 → 生成 → 质检 → 不达标回炉一次 */
export async function aiLearning(
  node: KnowledgePoint,
  projectName: string,
  all: Map<string, KnowledgePoint>,
  signal?: AbortSignal
): Promise<AiLearningResult> {
  const t0 = Date.now();
  const ctx = nodeContext(node, all);
  const deg = degenerateReason(node);
  const { sources, brief } = await gatherWebBrief(node, ctx);

  const cfg = loadLlmConfig();
  const call = (messages: { role: 'system' | 'user' | 'assistant'; content: string }[]) =>
    chat(messages, {
      signal,
      stream: false,
      timeoutMs: 200_000,
      // 学习材料要能一次写完：预算给小了会被 max_tokens 截断，JSON 就废了
      cfg: { ...cfg, maxTokens: Math.max(3000, Math.min(cfg.maxTokens, 6000)) },
    });

  let text = await call([
    { role: 'system', content: AI_SYSTEM },
    { role: 'user', content: buildPrompt(node, projectName, ctx, brief, deg) },
  ]);
  let json = extractJson(text);
  if (!json) throw new Error('模型未返回合法 JSON');

  let content = toContent(node, json);
  let lint = lintLearning(node, content);
  let rounds = 0;

  // 回炉一次：把质检问题原样丢回去，只要求修不改风格
  if (lint.score < 75) {
    const issues = lint.issues.map((i) => `- [${i.level}] ${i.field}: ${i.text}`).join('\n');
    try {
      const repairPrompt = `下面是一版学习材料，没有通过质检。请逐条修复后重新输出完整 JSON（schema 不变，不要解释，不要 markdown）。
质检问题：
${issues}

上一版：
${JSON.stringify({ goals: content.goals, sections: content.sections, practice: content.practice, pitfalls: content.pitfalls, further: content.further }, null, 2)}

补充要求：修复后每节 body 仍需 120-220 字；不许为了消词而删掉具体机制、数字与案例。`;
      const fixed = await call([
        { role: 'system', content: AI_SYSTEM },
        { role: 'user', content: repairPrompt },
      ]);
      const fixedJson = extractJson(fixed);
      if (fixedJson) {
        const next = toContent(node, fixedJson);
        const nextLint = lintLearning(node, next);
        rounds = 1;
        if (nextLint.score >= lint.score) {
          content = next;
          lint = nextLint;
          if (fixedJson.suggested_definition || fixedJson.suggested_description) json = fixedJson;
        }
      }
    } catch {
      /* 回炉失败就用第一版，质检分如实展示 */
    }
  }

  content.sources = sources.slice(0, 5);

  const suggested =
    deg && (json.suggested_definition || json.suggested_description)
      ? {
          definition: typeof json.suggested_definition === 'string' ? json.suggested_definition.trim() : undefined,
          description: typeof json.suggested_description === 'string' ? json.suggested_description.trim() : undefined,
        }
      : undefined;

  return { content, suggested, lint, rounds, sources, elapsedMs: Date.now() - t0 };
}

function extractJson(text: string): any | null {
  const fenced = /```(?:json)?\s*\n([\s\S]*?)```/i.exec(text)?.[1];
  const candidate = fenced ?? text;
  const start = candidate.indexOf('{');
  if (start < 0) return null;

  // 1) 先按「最后一个右括号」截取（正常返回）
  const end = candidate.lastIndexOf('}');
  if (end > start) {
    try {
      return JSON.parse(candidate.slice(start, end + 1));
    } catch {
      /* 落到下面的截断修复 */
    }
  }

  // 2) 被 max_tokens 截断：按括号/字符串状态补齐后重试
  const repaired = closeTruncatedJson(candidate.slice(start));
  if (!repaired) return null;
  try {
    return JSON.parse(repaired);
  } catch {
    return null;
  }
}

/**
 * 把被截断的 JSON 补成合法 JSON。
 * 常见于模型写着写着撞上 max_tokens：末尾停在半个字符串、或半个对象里。
 * 策略：从后往前按「字符串外的逗号」逐级丢弃不完整的尾项，每丢一次尝试补齐括号再解析，
 * 第一次解析成功即返回 —— 保证丢掉的是尾部残项，不会伤到已经完整的前文。
 */
export function closeTruncatedJson(raw: string): string | null {
  const parse = (s: string) => {
    try {
      return JSON.parse(s);
    } catch {
      return undefined;
    }
  };

  const trimmed = raw.trim();
  const direct = parse(trimmed);
  if (direct !== undefined) return trimmed;

  let source = trimmed;
  for (let guard = 0; guard < 60; guard++) {
    const cut = lastCommaOutsideString(source);
    if (cut < 0) break;
    source = source.slice(0, cut);
    const balanced = balanceBrackets(source);
    if (!balanced) break;
    if (parse(balanced) !== undefined) return balanced;
  }

  const fallback = balanceBrackets(trimmed);
  return fallback && parse(fallback) !== undefined ? fallback : null;
}

/** 找最后一个位于字符串之外的逗号 */
function lastCommaOutsideString(s: string): number {
  let inStr = false;
  let esc = false;
  let last = -1;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === ',') last = i;
  }
  return last;
}

/** 去掉悬空逗号，并按未闭合的 { [ 补齐 } ] */
function balanceBrackets(s: string): string | null {
  let inStr = false;
  let esc = false;
  const stack: string[] = [];
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{') stack.push('}');
    else if (c === '[') stack.push(']');
    else if (c === '}' || c === ']') {
      if (stack.pop() !== c) return null;
    }
  }
  if (inStr) return null; // 还停在字符串里：调用方应继续往前裁
  let head = s.replace(/[,\s]+$/, '');
  for (let i = stack.length - 1; i >= 0; i--) head += stack[i];
  return head;
}
