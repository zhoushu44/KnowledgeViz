/**
 * Obsidian 导出：把一个 KSB 项目导出成「可直接打开的知识库文件夹」
 *
 * 产物：
 *   README.md                 总览（MOC，入口）
 *   知识索引.md               全量层级索引
 *   知识全景.canvas           思维导图 → 白板（全部 L1–L4，左右分叉）
 *   学习路线.canvas           学习路线白板（按阶段分列）
 *   笔记/01-xxx/*.md          每个知识点一篇
 *   学习路线/*.md             每条路线一篇
 *   _样式/ksb-vault.css       排版美化片段（字号 / 行距 / 表格 / 标注块）
 *   .obsidian/*               独立库配置（已启用 canvas 与 CSS 片段）
 *
 * 双链：文章 → 白板、白板 → 文章（file 节点）、文章 ↔ 上下级 / 前导 / 后继 / 路线。
 */
import type { KnowledgePoint, Project, ProjectIndex, Route } from './types';
import { indexProject } from './types';

export interface VaultFile {
  path: string; // 相对库根，统一用 /
  content: string;
}

export interface ObsidianCounts {
  notes: number;
  canvas: number;
  links: number;
  bytes: number;
}

export interface ObsidianBundle {
  /** 导出后的文件夹名（= Obsidian 库名） */
  folder: string;
  files: VaultFile[];
  counts: ObsidianCounts;
}

export interface ObsidianOptions {
  /** 是否导出 L4 原子单元（默认 true） */
  includeL4?: boolean;
  /** 是否生成白板（默认 true） */
  withCanvas?: boolean;
  /** 是否附带排版美化片段与库配置（默认 true） */
  withStyle?: boolean;
}

const CANVAS_MAIN = '知识全景.canvas';
const CANVAS_ROUTE = '学习路线.canvas';
const INDEX = '知识索引';

/* ------------------------------------------------------------------ *
 * 基础工具
 * ------------------------------------------------------------------ */

/** 文件名清洗：去掉 Obsidian / Windows 非法字符，压缩空白 */
export function safeName(raw: string, max = 58): string {
  const s = String(raw ?? '')
    .replace(/[\\/:*?"<>|#^[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return (s || '未命名').slice(0, max).trim();
}

function yamlStr(v: string): string {
  if (/^[\w\u4e00-\u9fa5.\-+/ ]+$/.test(v) && !/^(true|false|null|yes|no|\d+(\.\d+)?)$/i.test(v)) return v;
  return JSON.stringify(v);
}

const stars = (n: number) => '★'.repeat(Math.max(0, Math.min(4, n))) + '☆'.repeat(Math.max(0, 4 - Math.min(4, n)));

function trimText(s: string, n: number): string {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
}

const cell = (s: string) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ').trim();

const LEVEL_LABEL: Record<string, string> = {
  root: '总纲',
  L1: '一级分支',
  L2: '二级子领域',
  L3: '三级方法',
  L4: '四级原子单元',
};

const UNIT_LABEL: Record<string, string> = { input: '输入识别', process: '处理步骤', output: '输出检验' };

const REL_LABEL: Record<string, string> = {
  analogy: '类比参照',
  contrast: '对比区分',
  extends: '扩展外延',
  evolved: '演进发展',
  constrains: '约束关系',
  depends: '前导依赖',
  contains: '组成包含',
};

/* ------------------------------------------------------------------ *
 * 路径规划
 * ------------------------------------------------------------------ */

interface Layout {
  path: Map<string, string>;
  base: Map<string, string>;
  branchDir: Map<string, string>;
}

function planLayout(project: Project, includeL4: boolean): Layout {
  const path = new Map<string, string>();
  const base = new Map<string, string>();
  const branchDir = new Map<string, string>();
  const used = new Set<string>();

  const root = project.nodes.find((n) => !n.parent) ?? project.nodes[0];
  const rootName = safeName(root?.name || project.name);
  if (root) {
    base.set(root.id, rootName);
    path.set(root.id, `笔记/00-总纲/${rootName}.md`);
    used.add(`笔记/00-总纲/${rootName}.md`);
  }

  project.branches.forEach((b, i) => {
    branchDir.set(b.id, `笔记/${String(i + 1).padStart(2, '0')}-${safeName(b.name, 24)}`);
  });

  const pick = (n: KnowledgePoint): string => {
    const dir = branchDir.get(n.branch) ?? '笔记/99-其他';
    let name = safeName(n.name);
    let p = `${dir}/${name}.md`;
    let k = 2;
    while (used.has(p)) {
      name = `${safeName(n.name, 46)}-${k++}`;
      p = `${dir}/${name}.md`;
    }
    used.add(p);
    return name;
  };

  for (const b of project.branches) {
    const l1 = project.nodes.find((n) => n.branch === b.id && n.level === 'L1');
    if (!l1) continue;
    const name = pick(l1);
    base.set(l1.id, name);
    path.set(l1.id, `${branchDir.get(b.id)}/${name}.md`);
  }

  for (const n of project.nodes) {
    if (n.level === 'root' || n.level === 'L1') continue;
    if (!includeL4 && n.level === 'L4') continue;
    const name = pick(n);
    base.set(n.id, name);
    path.set(n.id, `${branchDir.get(n.branch) ?? '笔记/99-其他'}/${name}.md`);
  }
  return { path, base, branchDir };
}

/* ------------------------------------------------------------------ *
 * 生成器
 * ------------------------------------------------------------------ */

export function buildObsidianBundle(project: Project, opts: ObsidianOptions = {}): ObsidianBundle {
  const includeL4 = opts.includeL4 !== false;
  const withCanvas = opts.withCanvas !== false;
  const withStyle = opts.withStyle !== false;

  const idx = indexProject(project);
  const lay = planLayout(project, includeL4);
  const root = project.nodes.find((n) => !n.parent) ?? project.nodes[0];
  const branchOf = (n: KnowledgePoint) => project.branches.find((b) => b.id === n.branch);

  const files: VaultFile[] = [];
  const linkCount = { n: 0 };

  /** 路线文件基名（避免重名） */
  const routeBase = new Map<string, string>();
  const usedRoute = new Set<string>();
  for (const r of project.routes) {
    let name = safeName(r.name);
    let k = 2;
    while (usedRoute.has(name)) name = `${safeName(r.name, 46)}-${k++}`;
    usedRoute.add(name);
    routeBase.set(r.id, name);
  }

  /** wikilink：路径式 + 别名，避免重名歧义 */
  const link = (id: string, alias?: string): string => {
    linkCount.n++;
    if (id === '__readme__') return `[[README|${alias ?? '总览'}]]`;
    if (id.endsWith('.canvas')) return `[[${id}|${alias ?? id.replace(/\.canvas$/, '')}]]`;
    if (id.startsWith('route:')) {
      const rid = id.slice(6);
      const b = routeBase.get(rid) ?? rid;
      return `[[学习路线/${b}|${alias ?? b}]]`;
    }
    const p = lay.path.get(id);
    const name = alias ?? idx.byId.get(id)?.name ?? id;
    if (!p) return name;
    return `[[${p.replace(/\.md$/, '')}|${name}]]`;
  };

  const nodesOfBranch = (bid: string) =>
    project.nodes.filter((n) => n.branch === bid && n.level !== 'root' && (includeL4 || n.level !== 'L4'));

  /* ---------------- 单篇笔记 ---------------- */
  const renderNote = (n: KnowledgePoint): string => {
    const branch = branchOf(n);
    const parents = idx.pathOf(n.id).filter((p) => p.id !== n.id);
    const kids = (idx.children.get(n.id) ?? []).filter((k) => includeL4 || k.level !== 'L4');
    const pre = n.prerequisites.map((id) => idx.byId.get(id)).filter(Boolean) as KnowledgePoint[];
    const next = (idx.outgoing.get(n.id) ?? [])
      .filter((e) => e.type === 'depends')
      .map((e) => idx.byId.get(e.to))
      .filter(Boolean) as KnowledgePoint[];
    const otherRels = (idx.outgoing.get(n.id) ?? []).filter(
      (e) => e.type !== 'depends' && e.type !== 'contains'
    );
    const routes = project.routes.filter((r) => r.stages.some((s) => s.nodes.includes(n.id)));
    const lv = n.level.toLowerCase();

    const out: string[] = [
      '---',
      `title: ${yamlStr(n.name)}`,
      n.nameEn && n.nameEn !== n.name ? `aliases:\n  - ${yamlStr(n.nameEn)}` : 'aliases: []',
      `level: ${n.level}`,
      `branch: ${yamlStr(branch?.name ?? '')}`,
      `difficulty: ${n.difficulty}`,
      `importance: ${n.importance}`,
      'tags:',
      `  - KSB/${branch?.name ?? '未分类'}`,
      `  - KSB/${n.level}`,
      'cssclasses:',
      '  - ksb-doc',
      `  - ksb-${lv}`,
      '---',
      '',
      `# ${n.name}`,
      '',
    ];

    const meta: string[] = [];
    if (n.nameEn && n.nameEn !== n.name) meta.push(`<em>${n.nameEn}</em>`);
    meta.push(`${LEVEL_LABEL[n.level] ?? n.level}${n.unit ? ` · ${UNIT_LABEL[n.unit]}` : ''}`);
    meta.push(`难度 ${stars(n.difficulty)}`);
    if (n.studyMinutes) meta.push(`建议 ${n.studyMinutes} 分钟`);
    out.push(`<p class="ksb-sub">${meta.join(' · ')}</p>`, '');

    // 面包屑：保持为 Markdown 段落（wikilink 才能被解析），用 span 做样式钩子
    if (parents.length) {
      const crumb = parents
        .map((p) => (p.id === root?.id ? link(p.id, project.name) : link(p.id)))
        .join(' <span class="ksb-crumb-sep">›</span> ');
      out.push(crumb, '');
    }

    if (n.definition) out.push('> [!abstract] 一句话定义', `> ${n.definition.replace(/\n+/g, ' ')}`, '');
    if (n.description && n.description !== n.definition) out.push('## 详细说明', '', n.description.replace(/\n{2,}/g, '\n\n'), '');

    const l = n.learning;
    if (l && ((l.goals?.length ?? 0) || (l.sections?.length ?? 0))) {
      out.push('## 学习路径', '');
      if (l.goals?.length) out.push('**学完能做到**', '', ...l.goals.map((g) => `- ${g}`), '');
      for (const s of l.sections ?? []) {
        if (!s.title) continue;
        out.push(`### ${s.title}`, '', s.body, '');
      }
      if (l.practice) out.push('> [!example] 动手练习', `> ${l.practice.replace(/\n+/g, '\n> ')}`, '');
      if (l.pitfalls?.length) out.push('> [!warning] 常见误区', ...l.pitfalls.map((p) => `> - ${p}`), '');
      if (l.further?.length) out.push('**延伸**', '', ...l.further.map((f) => `- ${f}`), '');
    }

    if (kids.length) {
      out.push('## 下级知识点', '', '| 知识点 | 说明 | 难度 |', '| --- | --- | :---: |');
      for (const k of kids) {
        out.push(`| ${link(k.id)} | ${cell(trimText(k.definition || k.description, 46))} | ${'★'.repeat(k.difficulty)} |`);
      }
      out.push('');
    }

    const relRows: string[] = [];
    if (pre.length) relRows.push(`- **前导知识**：${pre.map((p) => link(p.id)).join('、')}`);
    if (next.length) relRows.push(`- **后续知识**：${next.map((p) => link(p.id)).join('、')}`);
    for (const e of otherRels) {
      const t = idx.byId.get(e.to);
      if (!t) continue;
      relRows.push(`- **${REL_LABEL[e.type] ?? e.type}**：${link(t.id)}`);
    }
    if (n.composeTo?.length) {
      const targets = n.composeTo.filter((id) => idx.byId.has(id)).map((id) => link(id));
      if (targets.length) relRows.push(`- **可组装为**：${targets.join('、')}`);
    }
    if (relRows.length) out.push('## 知识关联', '', ...relRows, '');

    if (routes.length) out.push('## 所属学习路线', '', ...routes.map((r) => `- ${link(`route:${r.id}`, r.name)}`), '');

    out.push(
      '## 指标',
      '',
      '| 层级 | 难度 | 重要度 | 枢纽度 | 建议时长 |',
      '| :--- | :---: | :---: | :---: | :---: |',
      `| ${n.level}${n.unit ? ` · ${UNIT_LABEL[n.unit]}` : ''} | ${stars(n.difficulty)} | ${n.importance}% | ${n.centrality}% | ${n.studyMinutes || '—'} 分钟 |`,
      ''
    );

    if (n.tags?.length) out.push(`**标签**：${n.tags.map((t) => `#${String(t).replace(/\s+/g, '-')}`).join(' ')}`, '');

    const up = parents[parents.length - 1];
    out.push(
      '---',
      '',
      `🧭 **返回白板**：${link(CANVAS_MAIN, '知识全景')}${branch ? ` · ${link(`白板/${safeName(branch.name, 26)}.canvas`, `${branch.name}白板`)}` : ''} · 📚 ${link(INDEX, '知识索引')}${up ? ` · ⬆ 上级：${link(up.id)}` : ''}`,
      ''
    );
    return out.join('\n');
  };

  /* ---------------- README ---------------- */
  const renderReadme = (): string => {
    const countOfBranch = (bid: string) =>
      project.nodes.filter((n) => n.branch === bid && n.level !== 'root' && (includeL4 || n.level !== 'L4')).length;
    const branchRows = project.branches.map((b, i) => {
      const l1 = project.nodes.find((n) => n.branch === b.id && n.level === 'L1');
      return `| ${i + 1} | ${l1 ? link(l1.id) : b.name} | ${b.nameEn || '—'} | ${countOfBranch(b.id)} |`;
    });
    const routeRows = project.routes.map((r) => `| ${link(`route:${r.id}`, r.name)} | ${r.level} | ${r.nodeCount} |`);
    const out: string[] = [
      '---',
      `title: ${yamlStr(project.name)}`,
      'aliases:',
      '  - 知识体系总览',
      'tags:',
      '  - KSB/总览',
      'cssclasses:',
      '  - ksb-doc',
      '  - ksb-home',
      '---',
      '',
      `# ${project.name}`,
      '',
      `<p class="ksb-sub">${project.nameEn ? `${project.nameEn} · ` : ''}${project.category} · KSB-YAML v1.0</p>`,
      '',
      project.description,
      '',
      '> [!tip] 从哪里开始',
      `> 1. 先打开 ${link(CANVAS_MAIN, '知识全景白板')}，用「思维导图」的视角看整体结构；`,
      '> 2. 双击任意卡片进入对应文章，文末可一键回到白板；',
      `> 3. 想系统学习，按 ${link(CANVAS_ROUTE, '学习路线白板')} 从左到右推进。`,
      '',
      '## 数据概览',
      '',
      '| 知识点 | 关系 | 一级分支 | 学习路线 |',
      '| :---: | :---: | :---: | :---: |',
      `| ${project.stats.nodes} | ${project.stats.edges} | ${project.stats.branches} | ${project.routes.length} |`,
      '',
      '## 入口',
      '',
      `- ${link(CANVAS_MAIN, '知识全景白板')} —— 全部知识点的树状白板（左右分叉）`,
      `- ${link(CANVAS_ROUTE, '学习路线白板')} —— 按阶段分列的学习路径`,
      `- ${link(INDEX, '知识索引')} —— 全量层级目录`,
      '',
      '### 分分支白板（放大看细节）',
      '',
      ...project.branches.map((b) => `- ${link(`白板/${safeName(b.name, 26)}.canvas`, `${b.name} 白板`)} —— ${nodesOfBranch(b.id).length} 个知识点`),
      '',
      '## 一级分支',
      '',
      '| # | 分支 | 英文 | 知识点 |',
      '| :---: | --- | --- | :---: |',
      ...branchRows,
      '',
    ];
    if (project.routes.length) out.push('## 学习路线', '', '| 路线 | 级别 | 节点 |', '| --- | :---: | :---: |', ...routeRows, '');
    out.push(
      '## 使用说明',
      '',
      '- **双链**：文章顶部是面包屑，底部有「返回白板 / 索引 / 上级」；白板里的卡片直接指向文章。左侧「反向链接」面板能看到哪些文章引用了本篇。',
      '- **白板**：`.canvas` 是 Obsidian 原生白板，双击卡片打开笔记，滚轮缩放、拖拽摆放都可用。',
      '- **样式**：本库自带 `.obsidian/snippets/ksb-vault.css`（字号 16.5px / 行高 1.9 / 表格与标注块重绘）。直接「打开文件夹作为库」即生效；若拖进已有库，请把该 CSS 复制到目标库的 `snippets/` 并启用。',
      ''
    );
    return out.join('\n');
  };

  /* ---------------- 知识索引 ---------------- */
  const renderIndex = (): string => {
    const out: string[] = [
      '---',
      'title: 知识索引',
      'tags:',
      '  - KSB/索引',
      'cssclasses:',
      '  - ksb-doc',
      '  - ksb-index',
      '---',
      '',
      '# 知识索引',
      '',
      `共 ${project.stats.nodes} 个知识点 · ${project.branches.length} 条分支`,
      '',
      `← 返回 ${link('__readme__', '总览')} · ${link(CANVAS_MAIN, '知识全景白板')}`,
      '',
    ];
    const walk = (n: KnowledgePoint, depth: number) => {
      const kids = (idx.children.get(n.id) ?? []).filter((k) => includeL4 || k.level !== 'L4');
      const pad = '  '.repeat(depth);
      const count = kids.length ? ` <span class="ksb-count">${kids.length}</span>` : '';
      out.push(`${pad}- ${link(n.id)}${count}`);
      for (const k of kids) walk(k, depth + 1);
    };
    for (const b of project.branches) {
      const l1 = project.nodes.find((n) => n.branch === b.id && n.level === 'L1');
      if (l1) walk(l1, 0);
    }
    out.push('');
    return out.join('\n');
  };

  /* ---------------- 路线笔记 ---------------- */
  const renderRoute = (r: Route): string => {
    const out: string[] = [
      '---',
      `title: ${yamlStr(r.name)}`,
      'tags:',
      '  - KSB/路线',
      'cssclasses:',
      '  - ksb-doc',
      '  - ksb-route',
      '---',
      '',
      `# ${r.name}`,
      '',
      `<p class="ksb-sub">${r.level} · ${r.nodeCount} 个节点</p>`,
      '',
      r.description,
      '',
      `🗺 **学习路线白板**：${link(CANVAS_ROUTE, '打开白板')} · 📚 ${link(INDEX, '知识索引')}`,
      '',
      '## 阶段',
      '',
    ];
    r.stages.forEach((s, i) => {
      const list = s.nodes.map((id) => idx.byId.get(id)).filter((x): x is KnowledgePoint => Boolean(x)).filter((n) => includeL4 || n.level !== 'L4');
      out.push(`### ${i + 1}. ${s.name}`, '');
      if (!list.length) {
        out.push('_（空）_', '');
        return;
      }
      out.push('| 知识点 | 说明 |', '| --- | --- |');
      for (const n of list) out.push(`| ${link(n.id)} | ${cell(trimText(n.definition, 52))} |`);
      out.push('');
    });
    return out.join('\n');
  };

  /* ---------------- 写文件 ---------------- */
  for (const n of project.nodes) {
    const p = lay.path.get(n.id);
    if (p) files.push({ path: p, content: renderNote(n) });
  }
  for (const r of project.routes) files.push({ path: `学习路线/${routeBase.get(r.id)}.md`, content: renderRoute(r) });
  files.push({ path: 'README.md', content: renderReadme() });
  files.push({ path: `${INDEX}.md`, content: renderIndex() });

  if (withCanvas) files.push(...buildCanvases(project, idx, lay, includeL4));

  if (withStyle) files.push(...styleFiles(project));

  const notes = files.filter((f) => f.path.endsWith('.md')).length;
  const canvas = files.filter((f) => f.path.endsWith('.canvas')).length;
  return {
    folder: safeName(project.name, 48),
    files,
    counts: { notes, canvas, links: linkCount.n, bytes: files.reduce((s, f) => s + f.content.length, 0) },
  };
}

/* ------------------------------------------------------------------ *
 * 图谱配色（按分支给 tag 上色）
 * ------------------------------------------------------------------ */
function buildGraph(project: Project) {
  return {
    collapse: { force: false },
    'collapse-filter': false,
    search: '',
    showTags: true,
    showAttachments: false,
    hideUnresolved: false,
    showOrphans: true,
    colorGroups: project.branches.map((b) => ({
      query: `tag:#KSB/${b.name}`,
      color: { a: 1, rgb: hexToInt(b.color) },
    })),
    colorGroupsEnabled: true,
  };
}

function hexToInt(hex: string): number {
  const h = String(hex).replace('#', '').trim();
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const v = parseInt(full, 16);
  return Number.isFinite(v) ? v : 0x3b82f6;
}

function styleFiles(project: Project): VaultFile[] {
  return [
    { path: '_样式/ksb-vault.css', content: VAULT_CSS },
    { path: '_样式/使用说明.md', content: STYLE_GUIDE },
    {
      path: '.obsidian/snippets/ksb-vault.css',
      content: VAULT_CSS,
    },
    {
      path: '.obsidian/app.json',
      content: JSON.stringify(
        { alwaysUpdateLinks: true, newLinkFormat: 'shortest', useMarkdownLinks: false, showUnsupportedFiles: true, defaultViewMode: 'preview', propertiesInDocument: 'hidden' },
        null,
        2
      ),
    },
    {
      path: '.obsidian/appearance.json',
      content: JSON.stringify({ theme: 'obsidian', baseFontSize: 16, enabledCssSnippets: ['ksb-vault'], showViewHeader: true }, null, 2),
    },
    {
      path: '.obsidian/core-plugins.json',
      content: JSON.stringify(
        {
          'file-explorer': true,
          'global-search': true,
          switcher: true,
          graph: true,
          backlink: true,
          canvas: true,
          'outgoing-link': true,
          'tag-pane': true,
          'page-preview': true,
          'note-composer': false,
          'command-palette': true,
          editor: { status: true },
          'file-recovery': true,
          outline: true,
          properties: true,
          bookmarks: true,
          'word-count': true,
        },
        null,
        2
      ),
    },
    { path: '.obsidian/graph.json', content: JSON.stringify(buildGraph(project), null, 2) },
  ];
}

/* ------------------------------------------------------------------ *
 * Canvas 白板
 * ------------------------------------------------------------------ */

type CanvasNode =
  | { id: string; type: 'file'; file: string; x: number; y: number; width: number; height: number; color?: string }
  | { id: string; type: 'text'; text: string; x: number; y: number; width: number; height: number; color?: string }
  | { id: string; type: 'group'; label: string; x: number; y: number; width: number; height: number; color?: string };

interface CanvasEdge {
  id: string;
  fromNode: string;
  fromSide: 'right' | 'left' | 'top' | 'bottom';
  toNode: string;
  toSide: 'right' | 'left' | 'top' | 'bottom';
  label?: string;
  color?: string;
}

const CARD_W = 300;
const CARD_H = 116;
const L4_H = 96;
const COL_STEP = 372;
const V_GAP = 24;
const PANEL_GAP = 130;

/** 卡片 id：由知识点 id 稳定推导，保证 edge 的 from/to 一定能对上 */
const cardId = (nodeId: string) => `card-${nodeId.replace(/[^\w-]/g, '_')}`;

function cardHeight(level: string) {
  return level === 'L4' ? L4_H : CARD_H;
}

function buildCanvases(project: Project, idx: ProjectIndex, lay: Layout, includeL4: boolean): VaultFile[] {
  const out: VaultFile[] = [];
  const root = project.nodes.find((n) => !n.parent) ?? project.nodes[0];
  if (!root) return out;

  const nodesOfBranch = (bid: string) =>
    project.nodes.filter((n) => n.branch === bid && n.level !== 'root' && (includeL4 || n.level !== 'L4'));

  const kidsOf = (id: string) => (idx.children.get(id) ?? []).filter((k) => includeL4 || k.level !== 'L4');

  const heightOf = (n: KnowledgePoint): number => {
    const kids = kidsOf(n.id);
    if (!kids.length) return cardHeight(n.level);
    const sum = kids.reduce((s, k) => s + heightOf(k), 0) + (kids.length - 1) * V_GAP;
    return Math.max(cardHeight(n.level), sum);
  };

  const colCount = (n: KnowledgePoint): number => {
    const kids = kidsOf(n.id);
    if (!kids.length) return 1;
    return 1 + Math.max(...kids.map((k) => colCount(k)));
  };

  /* ---------- 1) 知识全景 ---------- */
  const nodes: CanvasNode[] = [];
  const edges: CanvasEdge[] = [];
  const branches = project.branches;
  const leftBranches = branches.filter((_, i) => i % 2 === 0);
  const rightBranches = branches.filter((_, i) => i % 2 === 1);

  const panels = new Map<string, { h: number; cols: number }>();
  for (const b of branches) {
    const l1 = project.nodes.find((n) => n.branch === b.id && n.level === 'L1');
    if (!l1) continue;
    panels.set(b.id, { h: heightOf(l1), cols: colCount(l1) });
  }

  const totalH = (list: typeof branches) =>
    list.reduce((s, b) => s + (panels.get(b.id)?.h ?? 0), 0) + Math.max(0, list.length - 1) * PANEL_GAP;

  const placePanel = (b: (typeof branches)[number], side: -1 | 1, yTop: number) => {
    const l1 = project.nodes.find((n) => n.branch === b.id && n.level === 'L1');
    if (!l1) return;
    const panel = panels.get(b.id)!;
    const originX = side === 1 ? 340 : -340;
    const placed: { x: number; y: number; w: number; h: number }[] = [];

    const place = (n: KnowledgePoint, col: number, top: number) => {
      const h = heightOf(n);
      const own = cardHeight(n.level);
      const y = Math.round(top + (h - own) / 2);
      const x = Math.round(side === 1 ? originX + col * COL_STEP : originX - col * COL_STEP - CARD_W);
      placed.push({ x, y, w: CARD_W, h: own });

      {
        const p = lay.path.get(n.id);
        if (p) {
          nodes.push({
            id: cardId(n.id),
            type: 'file',
            file: p,
            x,
            y,
            width: CARD_W,
            height: cardHeight(n.level),
            ...(n.level === 'L1' ? { color: String((branches.indexOf(b) % 6) + 1) } : {}),
          });
        }
      }

      let cy = top;
      for (const k of kidsOf(n.id)) {
        const kh = heightOf(k);
        edges.push({
          id: `e-${n.id}--${k.id}`,
          fromNode: cardId(n.id),
          fromSide: side === 1 ? 'right' : 'left',
          toNode: cardId(k.id),
          toSide: side === 1 ? 'left' : 'right',
          color: b.color,
        });
        place(k, col + 1, cy);
        cy += kh + V_GAP;
      }
    };
    place(l1, 0, yTop);

    if (!placed.length) return;
    const minX = Math.min(...placed.map((p) => p.x));
    const maxX = Math.max(...placed.map((p) => p.x + p.w));
    const minY = Math.min(...placed.map((p) => p.y));
    const maxY = Math.max(...placed.map((p) => p.y + p.h));
    nodes.push({
      id: `group-${b.id}`,
      type: 'group',
      label: `　${b.name}　`,
      x: minX - 30,
      y: minY - 52,
      width: maxX - minX + 60,
      height: maxY - minY + 82,
      color: String((branches.indexOf(b) % 6) + 1),
    });
    void panel;
  };

  let ly = -totalH(leftBranches) / 2;
  for (const b of leftBranches) {
    placePanel(b, -1, ly);
    ly += (panels.get(b.id)?.h ?? 0) + PANEL_GAP;
  }
  let ry = -totalH(rightBranches) / 2;
  for (const b of rightBranches) {
    placePanel(b, 1, ry);
    ry += (panels.get(b.id)?.h ?? 0) + PANEL_GAP;
  }

  // 中心枢纽（连接到每个一级分支）
  const rootPath = lay.path.get(root.id);
  if (rootPath) {
    nodes.push({ id: 'hub', type: 'file', file: rootPath, x: -160, y: -66, width: 320, height: 132, color: '6' });
  }
  for (const b of branches) {
    const l1 = project.nodes.find((n) => n.branch === b.id && n.level === 'L1');
    if (!l1) continue;
    const side = leftBranches.includes(b) ? 'left' : 'right';
    edges.push({
      id: `e-root-${b.id}`,
      fromNode: 'hub',
      fromSide: side === 'left' ? 'left' : 'right',
      toNode: cardId(l1.id),
      toSide: side === 'left' ? 'right' : 'left',
      color: b.color,
    });
  }

  const topY = -Math.max(totalH(leftBranches), totalH(rightBranches)) / 2 - 300;
  nodes.unshift({
    id: 'banner',
    type: 'text',
    text: `# ${project.name}\n\n${project.description}\n\n**${project.stats.nodes} 个知识点 · ${project.stats.branches} 条分支**　　双击卡片打开文章，文章底部可回到本白板\n\n[[知识索引]] ｜ [[学习路线.canvas|学习路线白板]]`,
    x: -520,
    y: Math.round(topY),
    width: 1040,
    height: 230,
    color: '5',
  });

  out.push({ path: CANVAS_MAIN, content: JSON.stringify({ nodes, edges }, null, '\t') });

  /* ---------- 1b) 每个分支一块独立白板（可读性最好，缩放接近 100%） ---------- */
  const branchCanvasNames: { name: string; label: string; count: number }[] = [];
  for (const b of branches) {
    const l1 = project.nodes.find((n) => n.branch === b.id && n.level === 'L1');
    if (!l1) continue;
    const bn: CanvasNode[] = [];
    const be: CanvasEdge[] = [];
    const placed: { x: number; y: number; w: number; h: number }[] = [];
    const originX = 380;

    const walk = (n: KnowledgePoint, col: number, top: number) => {
      const h = heightOf(n);
      const own = cardHeight(n.level);
      const y = Math.round(top + (h - own) / 2);
      const x = Math.round(originX + col * COL_STEP);
      placed.push({ x, y, w: CARD_W, h: own });

      const p = lay.path.get(n.id);
      if (p) {
        bn.push({
          id: cardId(n.id),
          type: 'file',
          file: p,
          x,
          y,
          width: CARD_W,
          height: cardHeight(n.level),
          ...(n.level === 'L1' ? { color: String((branches.indexOf(b) % 6) + 1) } : {}),
        });
      }

      let cy = top;
      for (const k of kidsOf(n.id)) {
        const kh = heightOf(k);
        be.push({
          id: `e-${n.id}--${k.id}`,
          fromNode: cardId(n.id),
          fromSide: 'right',
          toNode: cardId(k.id),
          toSide: 'left',
          color: b.color,
        });
        walk(k, col + 1, cy);
        cy += kh + V_GAP;
      }
    };
    walk(l1, 0, 0);

    if (!placed.length) continue;
    const minX = Math.min(...placed.map((p) => p.x));
    const maxX = Math.max(...placed.map((p) => p.x + p.w));
    const minY = Math.min(...placed.map((p) => p.y));
    const maxY = Math.max(...placed.map((p) => p.y + p.h));
    bn.unshift({
      id: 'branch-banner',
      type: 'text',
      text: `# ${b.name}\n${b.nameEn || ''} · ${nodesOfBranch(b.id).length} 个知识点\n\n← 返回 [[知识全景.canvas|知识全景白板]] ｜ [[${INDEX}]]`,
      x: minX,
      y: minY - 220,
      width: Math.max(560, Math.min(900, maxX - minX)),
      height: 150,
      color: String((branches.indexOf(b) % 6) + 1),
    });
    bn.push({
      id: 'branch-frame',
      type: 'group',
      label: `　${b.name}　`,
      x: minX - 34,
      y: minY - 56,
      width: maxX - minX + 68,
      height: maxY - minY + 88,
      color: String((branches.indexOf(b) % 6) + 1),
    });

    const fileName = `白板/${safeName(b.name, 26)}.canvas`;
    out.push({ path: fileName, content: JSON.stringify({ nodes: bn, edges: be }, null, '\t') });
    branchCanvasNames.push({ name: fileName, label: b.name, count: nodesOfBranch(b.id).length });
  }

  // 全景横幅里补上分支白板快链
  const banner = nodes.find((n) => n.id === 'banner');
  if (banner && banner.type === 'text' && branchCanvasNames.length) {
    const links = branchCanvasNames.map((c) => `[[${c.name.replace(/\.canvas$/, '')}|${c.label}]]`).join(' ｜ ');
    banner.text += `\n\n**分分支细看**：${links}`;
  }

  /* ---------- 2) 学习路线 ---------- */
  if (project.routes.length) {
    const route = [...project.routes].sort((a, b) => b.nodeCount - a.nodeCount)[0];
    const rn: CanvasNode[] = [];
    const re: CanvasEdge[] = [];
    const COL = 320;
    const ROW = 78;
    const stageHeads: string[] = [];
    let stageX = 0;

    route.stages.forEach((s, si) => {
      const list = s.nodes
        .map((id) => idx.byId.get(id))
        .filter((x): x is KnowledgePoint => Boolean(x))
        .filter((n) => includeL4 || n.level !== 'L4');
      const h = Math.max(260, list.length * ROW + 130);
      rn.push({
        id: `rgroup-${si}`,
        type: 'group',
        label: `${si + 1}. ${s.name}`,
        x: stageX,
        y: 0,
        width: COL - 40,
        height: h,
        color: String((si % 6) + 1),
      });
      rn.push({
        id: `rhead-${si}`,
        type: 'text',
        text: `**${s.name}**\n<span class="ksb-canvas-meta">${list.length} 个节点</span>`,
        x: stageX + 18,
        y: 22,
        width: COL - 76,
        height: 56,
      });
      stageHeads.push(`rhead-${si}`);
      list.forEach((n, ni) => {
        const p = lay.path.get(n.id);
        if (!p) return;
        rn.push({
          id: `rnode-${si}-${ni}`,
          type: 'file',
          file: p,
          x: stageX + 18,
          y: 96 + ni * ROW,
          width: COL - 76,
          height: 62,
        });
      });
      stageX += COL;
    });

    for (let i = 0; i < stageHeads.length - 1; i++) {
      re.push({
        id: `rflow-${i}`,
        fromNode: stageHeads[i],
        fromSide: 'right',
        toNode: stageHeads[i + 1],
        toSide: 'left',
        label: '推进',
        color: '#3B82F6',
      });
    }

    rn.unshift({
      id: 'rbanner',
      type: 'text',
      text: `# ${route.name}\n\n${route.description}\n\n${route.level} · ${route.nodeCount} 个节点 · 从左到右逐阶段推进　← 返回 [[知识全景.canvas|知识全景白板]]`,
      x: 0,
      y: -240,
      width: Math.max(700, stageX - 40),
      height: 170,
      color: '4',
    });
    out.push({ path: CANVAS_ROUTE, content: JSON.stringify({ nodes: rn, edges: re }, null, '\t') });
  }

  return out;
}

/* ------------------------------------------------------------------ *
 * 样式片段（美化重点：字号体系 / 行距 / 表格 / 标注块）
 * ------------------------------------------------------------------ */
export const VAULT_CSS = `/* ==========================================================
   KSB 知识体系 · Obsidian 阅读版式
   仅作用于 frontmatter 带 cssclasses: ksb-doc 的笔记
   ========================================================== */

body {
  --ksb-accent: #3B5BDB;
  --ksb-accent-soft: #EEF2FF;
  --ksb-ink: #1F2430;
  --ksb-body: #333A47;
  --ksb-muted: #7A8291;
  --ksb-line: #E6E9F0;
  --ksb-radius: 12px;
}

body.theme-dark, body.theme-dark .workspace-leaf, .theme-dark body {
  --ksb-accent: #8FA6FF;
  --ksb-accent-soft: #1E2740;
  --ksb-ink: #E8ECF5;
  --ksb-body: #D3D9E6;
  --ksb-muted: #939BAA;
  --ksb-line: #2A3140;
}

/* ---------- 版心 ---------- */
.ksb-doc {
  --file-line-width: 47rem;
}

.ksb-doc .markdown-preview-section,
.ksb-doc .markdown-preview-sizer {
  padding-bottom: 4rem;
}

/* ---------- 正文排版 ---------- */
.ksb-doc.markdown-rendered,
.ksb-doc .markdown-rendered,
.ksb-doc.markdown-preview-view {
  font-size: 16.5px;
  line-height: 1.9;
  letter-spacing: 0.012em;
  color: var(--ksb-body);
}

.ksb-doc.markdown-rendered p,
.ksb-doc .markdown-rendered p {
  margin: 0.85em 0;
  font-size: 16.5px;
  line-height: 1.9;
}

/* ---------- 标题层级 ---------- */
.ksb-doc h1 {
  font-size: 2.05em !important;
  font-weight: 750;
  line-height: 1.35;
  letter-spacing: -0.01em;
  color: var(--ksb-ink);
  margin: 0 0 0.35em;
  padding-bottom: 0.4em;
  border-bottom: 2px solid var(--ksb-line);
  position: relative;
}

.ksb-doc h1::after {
  content: "";
  position: absolute;
  left: 0;
  bottom: -2px;
  width: 72px;
  height: 2px;
  background: linear-gradient(90deg, var(--ksb-accent), transparent);
}

.ksb-doc h2 {
  font-size: 1.32em !important;
  font-weight: 700;
  line-height: 1.5;
  color: var(--ksb-ink);
  margin: 2.1em 0 0.7em;
  padding: 0.18em 0.6em;
  border-left: 4px solid var(--ksb-accent);
  background: linear-gradient(90deg, var(--ksb-accent-soft), transparent 62%);
  border-radius: 0 6px 6px 0;
}

.ksb-doc h3 {
  font-size: 1.1em !important;
  font-weight: 650;
  color: var(--ksb-ink);
  margin: 1.6em 0 0.55em;
  padding-left: 0.9em;
  position: relative;
}

.ksb-doc h3::before {
  content: "";
  position: absolute;
  left: 0;
  top: 0.62em;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--ksb-accent);
  opacity: 0.75;
}

.ksb-doc h4 {
  font-size: 1em !important;
  font-weight: 650;
  color: var(--ksb-muted);
  margin: 1.2em 0 0.4em;
}

/* ---------- 列表 ---------- */
.ksb-doc ul,
.ksb-doc ol {
  padding-left: 1.45em;
  margin: 0.7em 0;
}

.ksb-doc li {
  margin: 0.32em 0;
  line-height: 1.85;
}

.ksb-doc li::marker {
  color: var(--ksb-accent);
}

/* ---------- 链接 ---------- */
.ksb-doc a.internal-link,
.ksb-doc a.external-link {
  color: var(--ksb-accent);
  text-decoration: none;
  border-bottom: 1px solid color-mix(in srgb, var(--ksb-accent) 35%, transparent);
  padding-bottom: 0.5px;
}

.ksb-doc a.internal-link:hover,
.ksb-doc a.external-link:hover {
  background: var(--ksb-accent-soft);
  border-bottom-color: var(--ksb-accent);
}

/* ---------- 标注块 ---------- */
.ksb-doc .callout {
  margin: 1.2em 0;
  border-radius: var(--ksb-radius);
  border: 1px solid var(--ksb-line);
  border-left-width: 4px;
  padding: 0.3em 0.4em;
  background: color-mix(in srgb, var(--ksb-accent) 4%, transparent);
}

.ksb-doc .callout-title {
  font-size: 0.95em;
  font-weight: 650;
  letter-spacing: 0.02em;
}

.ksb-doc .callout-content {
  font-size: 0.96em;
  line-height: 1.85;
}

.ksb-doc .callout-content p {
  margin: 0.35em 0;
}

/* ---------- 引用 ---------- */
.ksb-doc blockquote {
  margin: 1.1em 0;
  padding: 0.6em 1.1em;
  border-left: 3px solid var(--ksb-accent);
  background: var(--ksb-accent-soft);
  border-radius: 0 10px 10px 0;
  color: var(--ksb-ink);
  font-size: 0.98em;
}

/* ---------- 表格 ---------- */
.ksb-doc table {
  margin: 1.2em 0;
  border-collapse: separate;
  border-spacing: 0;
  width: 100%;
  font-size: 14.5px;
  line-height: 1.7;
  border: 1px solid var(--ksb-line);
  border-radius: 10px;
  overflow: hidden;
}

.ksb-doc thead th {
  background: color-mix(in srgb, var(--ksb-accent) 9%, transparent);
  color: var(--ksb-ink);
  font-weight: 650;
  font-size: 13.5px;
  letter-spacing: 0.03em;
  padding: 0.6em 0.85em;
  border-bottom: 1px solid var(--ksb-line);
}

.ksb-doc tbody td {
  padding: 0.55em 0.85em;
  border-bottom: 1px solid var(--ksb-line);
  vertical-align: top;
}

.ksb-doc tbody tr:last-child td {
  border-bottom: none;
}

.ksb-doc tbody tr:nth-child(even) {
  background: color-mix(in srgb, var(--ksb-muted) 4%, transparent);
}

.ksb-doc tbody tr:hover {
  background: var(--ksb-accent-soft);
}

/* ---------- 行内代码 / 分隔线 ---------- */
.ksb-doc code {
  font-size: 0.88em;
  padding: 0.12em 0.4em;
  border-radius: 5px;
  background: color-mix(in srgb, var(--ksb-muted) 12%, transparent);
}

.ksb-doc pre {
  border-radius: 10px;
  border: 1px solid var(--ksb-line);
  font-size: 13.5px;
  line-height: 1.7;
}

.ksb-doc hr {
  border: none;
  height: 1px;
  margin: 2.4em 0 1.4em;
  background: linear-gradient(90deg, transparent, var(--ksb-line) 20%, var(--ksb-line) 80%, transparent);
}

/* ---------- 标签 ---------- */
.ksb-doc a.tag {
  display: inline-block;
  padding: 0.1em 0.55em;
  border-radius: 999px;
  background: var(--ksb-accent-soft);
  color: var(--ksb-accent);
  font-size: 0.78em;
  font-weight: 500;
  text-decoration: none;
  border: none;
}

/* ---------- 自定义信息块 ---------- */
.ksb-doc p.ksb-sub,
.ksb-doc .ksb-sub {
  font-size: 13.5px;
  color: var(--ksb-muted);
  letter-spacing: 0.02em;
  margin: -0.2em 0 1.1em;
  line-height: 1.7;
}

/* 面包屑：正文第一段之后那行「A › B › C」 */
.ksb-doc p.ksb-crumb,
.ksb-doc .ksb-crumb {
  font-size: 12.5px;
  color: var(--ksb-muted);
  margin: 0 0 1.5em;
  padding-bottom: 0.85em;
  border-bottom: 1px dashed var(--ksb-line);
  line-height: 1.8;
}

/* 用 :has 精准命中「只包含链接 + 分隔符」的段落，避免误伤正文 */
.ksb-doc.markdown-rendered p:has(> a.internal-link + span.ksb-crumb-sep),
.ksb-doc .markdown-rendered p:has(> a.internal-link + span.ksb-crumb-sep) {
  font-size: 12.5px;
  color: var(--ksb-muted);
  margin: 0 0 1.5em;
  padding-bottom: 0.85em;
  border-bottom: 1px dashed var(--ksb-line);
  line-height: 1.8;
}

.ksb-crumb a,
.ksb-doc p:has(> a.internal-link + span.ksb-crumb-sep) a.internal-link {
  color: var(--ksb-muted) !important;
  border-bottom: none !important;
}

.ksb-crumb a:hover,
.ksb-doc p:has(> a.internal-link + span.ksb-crumb-sep) a.internal-link:hover {
  color: var(--ksb-accent) !important;
  background: transparent;
}

.ksb-crumb-sep {
  margin: 0 0.4em;
  opacity: 0.5;
}

.ksb-count {
  font-size: 11px;
  color: var(--ksb-muted);
  background: color-mix(in srgb, var(--ksb-muted) 10%, transparent);
  border-radius: 999px;
  padding: 0 6px;
  margin-left: 4px;
}

/* 索引页：更大行距，方便当目录读 */
.ksb-index.markdown-rendered ul,
.ksb-index .markdown-rendered ul {
  line-height: 2.05;
}

.ksb-index.markdown-rendered li,
.ksb-index .markdown-rendered li {
  margin: 0.18em 0;
}

/* 首页标题更醒目 */
.ksb-home h1 {
  font-size: 2.3em !important;
}

/* 层级微调 */
.ksb-l1 h1 { font-size: 2.2em !important; }
.ksb-l4.markdown-rendered p { font-size: 16px; }

/* ---------- 源码模式（Live Preview）---------- */
.ksb-doc .cm-content {
  font-size: 16.5px;
  line-height: 1.95;
}

/* ---------- 属性区弱化 ---------- */
.ksb-doc .metadata-container {
  font-size: 12.5px;
  opacity: 0.62;
  margin-bottom: 0.6em;
}

.ksb-doc .metadata-container:hover {
  opacity: 1;
}

/* ---------- 打印 / 导出 PDF ---------- */
@media print {
  .ksb-doc {
    --file-line-width: 100%;
    font-size: 12pt;
  }
  .ksb-doc h2 { break-after: avoid; }
  .ksb-doc table { break-inside: avoid; }
}
`;

const STYLE_GUIDE = `# 样式说明

本文件夹的排版由 \`ksb-vault.css\` 提供，重点调了三件事：

| 项目 | 取值 | 说明 |
| --- | --- | --- |
| 正文字号 | 16.5px / 行高 1.9 | 中文长文舒服的阅读密度 |
| 标题层级 | H1 2.05em · H2 1.32em · H3 1.1em | 一眼分出三级层次 |
| 表格字号 | 表头 13.5px / 正文 14.5px | 信息密度与可读性平衡 |

## 用在本库（已自动生效）

本文件夹是独立库，直接「打开文件夹作为库」即可，样式已启用。

## 用在你自己的库

1. 把 \`_样式/ksb-vault.css\` 复制到你的库：\`.obsidian/snippets/ksb-vault.css\`
2. Obsidian → 设置 → 外观 → CSS 片段 → 刷新 → 打开 \`ksb-vault\`
3. 笔记开头的 \`cssclasses:\` 里带 \`ksb-doc\` 时样式才生效，不会影响其他笔记
`;

/* ------------------------------------------------------------------ *
 * 浏览器兜底：打包成 ZIP（store 模式，无第三方依赖）
 * ------------------------------------------------------------------ */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** 生成 zip 二进制（store，不压缩），供浏览器环境下载 */
export function zipFiles(files: VaultFile[], rootFolder: string): Blob {
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  const push = (u: Uint8Array) => {
    chunks.push(u);
    offset += u.length;
  };

  for (const f of files) {
    const name = enc.encode(`${rootFolder}/${f.path}`);
    const data = enc.encode(f.content);
    const crc = crc32(data);

    const local = new Uint8Array(30 + name.length);
    const dv = new DataView(local.buffer);
    dv.setUint32(0, 0x04034b50, true);
    dv.setUint16(4, 20, true);
    dv.setUint16(6, 0x0800, true);
    dv.setUint16(8, 0, true);
    dv.setUint16(10, 0, true);
    dv.setUint16(12, 0, true);
    dv.setUint32(14, crc, true);
    dv.setUint32(18, data.length, true);
    dv.setUint32(22, data.length, true);
    dv.setUint16(26, name.length, true);
    dv.setUint16(28, 0, true);
    local.set(name, 30);
    const localOffset = offset;
    push(local);
    push(data);

    const cen = new Uint8Array(46 + name.length);
    const cv = new DataView(cen.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, 0, true);
    cv.setUint16(14, 0, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint16(30, 0, true);
    cv.setUint16(32, 0, true);
    cv.setUint16(34, 0, true);
    cv.setUint16(36, 0, true);
    cv.setUint32(38, 0, true);
    cv.setUint32(42, localOffset, true);
    cen.set(name, 46);
    central.push(cen);
  }

  const centralOffset = offset;
  let centralSize = 0;
  for (const c of central) {
    push(c);
    centralSize += c.length;
  }

  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, centralOffset, true);
  push(end);

  return new Blob(chunks as BlobPart[], { type: 'application/zip' });
}
