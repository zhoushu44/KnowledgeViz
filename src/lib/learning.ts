/**
 * 「学习内容」生成器
 *  - templateLearning：本地即时生成的结构化讲解（0 依赖、0 等待，任何节点都能看）
 *  - aiLearning：调用内置大模型，按节点上下文生成更具体的学习内容（JSON）
 */
import type { KnowledgePoint, LearningContent } from './types';
import { chat, loadLlmConfig } from './llm';
import { searchMany, netAvailable } from './net';

const UNIT_LABEL: Record<string, string> = { input: '输入识别', process: '处理步骤', output: '输出检验' };

function parentsOf(node: KnowledgePoint, all: Map<string, KnowledgePoint>): string[] {
  const out: string[] = [];
  let cur = node.parent ? all.get(node.parent) : undefined;
  let guard = 0;
  while (cur && guard++ < 8) {
    out.unshift(cur.name);
    cur = cur.parent ? all.get(cur.parent) : undefined;
  }
  return out;
}

/** 本地模板：保证「一打开就有可读的学习内容」 */
export function templateLearning(node: KnowledgePoint, all: Map<string, KnowledgePoint>): LearningContent {
  const path = parentsOf(node, all);
  const unit = node.unit ? UNIT_LABEL[node.unit] : '';
  const isL4 = node.level === 'L4';
  const branchName = path[0] ?? node.branch;

  const goals = isL4
    ? [
        `能说清「${node.name.replace(new RegExp(`^${node.name.split('·')[0]}·`), '')}」在「${node.name.split('·')[0]}」里承担什么角色`,
        `能在真实任务里按步骤执行这一步，并检查产出是否符合标准`,
        `能识别这一步常见的失败信号，知道什么时候要回退`,
      ]
    : [
        `能用一句话向同事解释「${node.name}」是什么、解决什么问题`,
        `能说出它和上下游节点（${path.slice(-2).join(' → ') || branchName}）的关系`,
        `能在给定场景里判断是否该用它，以及用它的大致步骤`,
      ];

  const sections = [
    {
      title: '它是什么',
      body:
        `${node.definition || node.name}。` +
        (path.length ? `它位于「${path.join(' › ')}」这条路径上，属于${node.level}层级的知识点。` : ''),
    },
    {
      title: '为什么需要它',
      body:
        `${node.description || node.definition || ''}` +
        `\n\n在${branchName}这条线里，它是把「${path.slice(-2)[0] ?? branchName}」推进到可执行结果的关键一环：` +
        `没有它，上游的结论无法落地；有了它，下游节点才有可用的输入。`,
    },
    {
      title: isL4 && node.unit ? `怎么做（${unit}）` : '怎么做',
      body: isL4
        ? node.unit === 'input'
          ? `先确认输入：\n1) 明确这一步要处理的原始对象与边界；\n2) 检查前置条件是否齐备（上游产出、必要数据、约束条件）；\n3) 把输入整理成可复用的清单，标注缺失项。\n\n输入不清楚就开始做，是这类任务最常见的返工原因。`
          : node.unit === 'process'
            ? `按步骤执行：\n1) 先做一遍最小可用的分解，把大任务拆成 3–5 个可检查的小步；\n2) 每完成一小步就记录中间产物（结论、数据、图示），便于回看与交接；\n3) 遇到与预期不符的地方先停下来定位原因，不要带病推进。`
            : `检验产出：\n1) 对照目标逐项打勾，确认每一条都可验证；\n2) 用反例或边界情况试一遍，看结论是否仍然成立；\n3) 把验收标准写下来，作为下一步的输入。`
        : `建议按「先看例子 → 再拆步骤 → 最后自己复述」的节奏学习：\n1) 找一个真实案例，看它在这里是怎么被使用的；\n2) 把过程拆成输入、处理、输出三段，对照本节点的子节点；\n3) 合上页面，用自己的话把步骤讲一遍，讲不顺的地方就是没掌握的地方。`,
    },
    {
      title: '边界与易错点',
      body:
        `适合同层级的常规问题；当问题跨越多个分支、或约束条件互相冲突时，需要回到上一级（${path.slice(-2)[0] ?? branchName}）重新界定范围。` +
        `\n常见的错法：把它当成一个孤立名词去背，而不是当成一条可执行的步骤去练。`,
    },
  ];

  return {
    goals,
    sections,
    practice: isL4
      ? `找一件手上正在做的事，只做「${node.name}」这一步，把输入清单 / 中间产物 / 验收结果各写一行，然后请人挑错。`
      : `挑一个你熟悉的场景，用「${node.name}」走一遍：写下它的输入、你会做的 3 个步骤、以及判断做对了的标准。`,
    pitfalls: [
      '只记住名词，说不出输入和输出',
      '跳过前置条件直接上手，导致返工',
      `把「${node.name}」和相邻概念混为一谈`,
    ],
    further: [
      `回到上级节点「${path.slice(-2)[0] ?? branchName}」看它在整体中的位置`,
      '在「关联」标签里找一条前导知识补齐，再回来看这一节',
    ],
    source: 'template',
    updatedAt: new Date().toISOString(),
  };
}

/** 把学习内容压成 Markdown（便于导出/复制） */
export function learningToMarkdown(node: KnowledgePoint, l: LearningContent): string {
  const lines: string[] = [`# ${node.name}${node.nameEn ? `（${node.nameEn}）` : ''}`, ''];
  if (l.goals?.length) {
    lines.push('## 学完能做到', ...l.goals.map((g) => `- ${g}`), '');
  }
  for (const s of l.sections ?? []) {
    lines.push(`## ${s.title}`, '', s.body, '');
  }
  if (l.practice) lines.push('## 动手练习', '', l.practice, '');
  if (l.pitfalls?.length) lines.push('## 常见误区', ...l.pitfalls.map((p) => `- ${p}`), '');
  if (l.further?.length) lines.push('## 延伸', ...l.further.map((f) => `- ${f}`), '');
  return lines.join('\n');
}

const AI_SYSTEM = `你是资深课程设计师。请为一个知识节点写「可以直接照着学」的学习材料，而不是名词解释。
只输出一个 JSON 对象，不要 markdown 代码围栏，不要解释。`;

/** 调用模型生成更具体的学习内容 */
export async function aiLearning(
  node: KnowledgePoint,
  projectName: string,
  all: Map<string, KnowledgePoint>,
  signal?: AbortSignal
): Promise<LearningContent> {
  const path = parentsOf(node, all);

  // ---------- 联网取证：给模型真实的领域表述，避免「名词解释 + 空话」 ----------
  let webBrief = '';
  let webSources: string[] = [];
  if (netAvailable()) {
    try {
      const bundles = await searchMany(
        [`${node.name} 教程 实操步骤`, `${node.name} 常见错误 注意事项`, `${node.name} 最佳实践`],
        { maxResults: 4, depth: 'advanced' }
      );
      const lines: string[] = [];
      const seen = new Set<string>();
      for (const b of bundles) {
        for (const h of b.results ?? []) {
          if (!h.url || seen.has(h.url)) continue;
          seen.add(h.url);
          webSources.push(h.url);
          const snip = String(h.content ?? '').replace(/\s+/g, ' ').slice(0, 110);
          if (snip.length > 30) lines.push(`- ${h.title}：${snip}`);
          if (lines.length >= 8) break;
        }
        if (lines.length >= 8) break;
      }
      webBrief = lines.join('\n');
    } catch {
      /* 联网失败退化为纯模型生成 */
    }
  }

  const prompt = `知识体系：${projectName}
节点：${node.name}（${node.nameEn ?? ''}）
层级：${node.level}${node.unit ? ` · ${UNIT_LABEL[node.unit]}` : ''}
路径：${path.join(' › ') || node.branch}
现有定义：${node.definition}
现有描述：${node.description}
${webBrief ? `\n以下是联网检索到的该主题真实资料片段，术语与步骤请据此对齐（不要编造）：\n${webBrief}\n` : ''}
请输出 JSON（内容要短，总字数控制在 900 字内）：
{
  "goals": ["学完能做到的 2-3 条，动词开头，可验证"],
  "sections": [{"title": "小节标题", "body": "80-150 字，含具体步骤"}],
  "practice": "一个 20 分钟内能做完的练习",
  "pitfalls": ["2 条常见误区"],
  "further": ["2 条延伸学习建议"]
}
要求：只写 3 个小节（是什么 / 怎么做 / 怎么判断做对了）；术语必须真实；body 里要有「先做什么、再做什么」；不要空话、不要重复定义。`;

  const text = await chat(
    [
      { role: 'system', content: AI_SYSTEM },
      { role: 'user', content: prompt },
    ],
    {
      signal,
      stream: false,
      // 学习材料是小 Json，限制 token 预算能明显降低超时概率
      timeoutMs: 200_000,
      cfg: { ...loadLlmConfig(), maxTokens: Math.min(loadLlmConfig().maxTokens, 2000) },
    }
  );

  const json = extractJson(text);
  if (!json) throw new Error('模型未返回合法 JSON');
  const tpl = templateLearning(node, all);
  const sections = Array.isArray(json.sections)
    ? json.sections
        .filter((s: any) => s && typeof s.title === 'string')
        .slice(0, 8)
        .map((s: any) => ({ title: String(s.title), body: String(s.body ?? '') }))
    : [];
  const nonEmpty = (arr: unknown) => Array.isArray(arr) && arr.length > 0;
  const goals = nonEmpty(json.goals) ? json.goals.map(String).slice(0, 6) : tpl.goals;
  const goodSections = sections.filter((x: { title: string; body: string }) => x.title && x.body.trim().length >= 20);
  lastSources = webSources.slice(0, 4);
  return {
    // 模型偶发返回空字段：逐项回退到模板，保证面板永远有内容
    goals,
    sections: goodSections.length ? goodSections : tpl.sections,
    practice: typeof json.practice === 'string' && json.practice.trim().length > 10 ? json.practice : tpl.practice,
    pitfalls: nonEmpty(json.pitfalls) ? json.pitfalls.map(String).slice(0, 6) : tpl.pitfalls,
    further: nonEmpty(json.further) ? json.further.map(String).slice(0, 6) : tpl.further,
    source: 'ai',
    updatedAt: new Date().toISOString(),
  };
}

/** 学习材料里用到过的联网来源（供 UI 展示「依据」） */
export function lastWebSources(): string[] {
  return lastSources;
}

let lastSources: string[] = [];

function extractJson(text: string): any | null {
  const fenced = /```(?:json)?\s*\n([\s\S]*?)```/i.exec(text)?.[1];
  const candidate = fenced ?? text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
}
