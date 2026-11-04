/**
 * Obsidian 导出校验：直接引用 src/lib/obsidian.ts 与 ksb.ts 的类型逻辑，
 * 但运行在 Node 里（用 esbuild 由 vite 打包，避免手工转译）
 * 用法：node scripts/verify-obsidian.mjs [projectDir] [outDir]
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const require = createRequire(import.meta.url);
const esbuildPath = join(root, 'node_modules', '.pnpm', 'esbuild@0.21.5', 'node_modules', 'esbuild', 'lib', 'main.js');
const { build } = require(esbuildPath);

const projectDir = process.argv[2] ?? join(process.env.APPDATA, 'knowledge-viz', 'projects', '企业架构知识体系');
const outDir = process.argv[3] ?? join(process.env.TEMP, 'obsidian-export-check');

// 打包 obsidian.ts 为 ESM（不包含 DOM 依赖）
const bundlePath = join(process.env.TEMP, 'obsidian-bundle.mjs');
await build({
  entryPoints: [join(root, 'src', 'lib', 'obsidian.ts')],
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  target: 'es2020',
  outfile: bundlePath,
  logLevel: 'warning',
});

const { buildObsidianBundle } = await import(pathToFileURL(bundlePath).href);

// 用 js-yaml 解析五文件（与 ksb.ts 的 parseBundle 等价，但这里直接读原始结构）
const yaml = require(join(root, 'node_modules', 'js-yaml', 'index.js'));

const read = (f) => {
  try {
    return readFileSync(join(projectDir, f), 'utf8');
  } catch {
    return '';
  }
};

const dom = yaml.load(read('domain.yaml'))?.domain ?? {};
const kps = yaml.load(read('knowledge_points.yaml'))?.knowledge_points ?? [];
const scenarios = yaml.load(read('scenarios.yaml'))?.scenarios ?? [];
const dims = yaml.load(read('dimensions.yaml'))?.dimensions ?? [];

const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const str = (v, d = '') => (typeof v === 'string' ? v : d);

const project = {
  id: projectDir.split(/[\\/]/).pop(),
  name: str(dom.name, projectDir.split(/[\\/]/).pop()),
  nameEn: str(dom.name_en, ''),
  category: str(dom.category, '通用知识'),
  description: str(dom.description, ''),
  createdAt: str(dom.created_at, new Date().toISOString()),
  updatedAt: new Date().toISOString(),
  stats: { nodes: kps.length, edges: num(dom.stats?.edges, 0), branches: (dom.branches ?? []).length },
  branches: (dom.branches ?? []).map((b) => ({ id: b.id, name: b.name, nameEn: str(b.name_en, ''), color: str(b.color, '#64748B') })),
  layers: dom.layers ?? [],
  dimensions: dims.map((d) => ({ id: d.id, name: d.name, role: d.role, values: d.values ?? [] })),
  nodes: kps.map((n) => ({
    id: n.id,
    name: n.name,
    nameEn: n.name_en,
    level: n.level ?? 'L3',
    branch: n.branch,
    parent: n.parent || undefined,
    definition: str(n.definition),
    description: str(n.description ?? n.definition),
    difficulty: num(n.difficulty, 2),
    importance: num(n.importance, 70),
    centrality: num(n.centrality, 50),
    studyMinutes: num(n.study_minutes, 30),
    tags: n.tags ?? [],
    dimensions: n.dimensions ?? {},
    prerequisites: n.prerequisites ?? [],
    unit: n.unit,
    learning: n.learning
      ? {
          goals: n.learning.goals ?? [],
          sections: (n.learning.sections ?? []).map((s) => ({ title: str(s.title), body: str(s.body) })),
          practice: n.learning.practice,
          pitfalls: n.learning.pitfalls ?? [],
          further: n.learning.further ?? [],
        }
      : undefined,
  })),
  edges: [],
  routes: scenarios.map((s) => ({
    id: s.id,
    name: s.name,
    level: s.level ?? 'beginner',
    nodeCount: num(s.node_count, 0),
    description: str(s.description),
    stages: (s.stages ?? []).map((st) => ({ name: st.name, layer: st.layer, nodes: st.nodes ?? [] })),
  })),
};

const bundle = buildObsidianBundle(project, { includeL4: true, withCanvas: true, withStyle: true });

if (existsSync(outDir)) { try { rmSync(outDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch (e) { console.log('cleanup warn:', e.message); } }
for (const f of bundle.files) {
  const p = join(outDir, bundle.folder, f.path);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, f.content, 'utf8');
}

/* ------------------ 校验 ------------------ */
const errors = [];
const warns = [];

// 1) canvas JSON 合法 + 边端点存在
const canvases = bundle.files.filter((f) => f.path.endsWith('.canvas'));
for (const c of canvases) {
  let json;
  try {
    json = JSON.parse(c.content);
  } catch (e) {
    errors.push(`${c.path} JSON 解析失败：${e.message}`);
    continue;
  }
  const ids = new Set((json.nodes ?? []).map((n) => n.id));
  if (ids.size !== (json.nodes ?? []).length) errors.push(`${c.path} 节点 id 重复`);
  for (const e of json.edges ?? []) {
    if (!ids.has(e.fromNode)) errors.push(`${c.path} 边 ${e.id} fromNode 不存在：${e.fromNode}`);
    if (!ids.has(e.toNode)) errors.push(`${c.path} 边 ${e.id} toNode 不存在：${e.toNode}`);
  }
  // 2) file 节点指向的文件必须存在
  const fileSet = new Set(bundle.files.map((f) => f.path));
  for (const n of json.nodes ?? []) {
    if (n.type === 'file' && !fileSet.has(n.file)) errors.push(`${c.path} file 节点指向不存在的文件：${n.file}`);
  }
  // 3) 节点重叠检测（粗略：同类型卡片框相交）
  const cards = (json.nodes ?? []).filter((n) => n.type !== 'group');
  let overlaps = 0;
  for (let i = 0; i < cards.length; i++) {
    for (let j = i + 1; j < cards.length; j++) {
      const a = cards[i];
      const b = cards[j];
      const ox = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
      const oy = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
      if (ox > 8 && oy > 8) {
        overlaps++;
        if (overlaps <= 3) warns.push(`${c.path} 卡片重叠：${a.id} × ${b.id}`);
      }
    }
  }
  if (overlaps) warns.push(`${c.path} 共 ${overlaps} 处卡片重叠`);
}

// 4) 所有 wikilink 目标存在
const mdFiles = bundle.files.filter((f) => f.path.endsWith('.md'));
const exist = new Set(bundle.files.map((f) => f.path.replace(/\.md$/, '')));
const broken = new Map();
for (const f of mdFiles) {
  for (const m of f.content.matchAll(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g)) {
    const target = m[1].trim();
    if (!target) continue;
    const ok = exist.has(target) || exist.has(`笔记/${target}`) || bundle.files.some((x) => x.path.endsWith(`/${target}.md`)) || bundle.files.some((x) => x.path === target);
    if (!ok) broken.set(target, (broken.get(target) ?? 0) + 1);
  }
}
for (const [t, c] of broken) errors.push(`断链：${t}（${c} 处）`);

// 5) 白板 → 文章 与 文章 → 白板 双链闭环
const mainCanvasLinks = mdFiles.filter((f) => f.content.includes('知识全景.canvas')).length;
if (!mainCanvasLinks) errors.push('没有任何文章链接回白板');

const report = {
  folder: bundle.folder,
  counts: bundle.counts,
  canvasNodes: canvases.map((c) => ({ file: c.path, nodes: JSON.parse(c.content).nodes.length, edges: (JSON.parse(c.content).edges ?? []).length })),
  errors,
  warns,
};
console.log(JSON.stringify(report, null, 2));
console.log(`\n输出目录：${join(outDir, bundle.folder)}`);
if (errors.length) process.exit(1);

