import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Project, ProjectIndex, KnowledgePoint, RelationTypeId } from '../lib/types';
import { RELATION_TYPES } from '../lib/types';
import type { FilterState } from '../components/DimensionFilter';
import { nodePasses } from '../components/DimensionFilter';
import { IconDownload, IconClose, IconSparkle, IconRefresh, IconCheck, IconAlert, IconLink } from '../components/Icons';
import EmptyCanvas from '../components/EmptyCanvas';
import { useRouter } from '../store/router';
import { downloadPngFromSvg, downloadSvg } from '../lib/export';
import { aiBuildRoute, type AiRouteResult } from '../lib/ai-route';
import { netAvailable } from '../lib/net';
import { desktop } from '../lib/desktop';

interface Props {
  project: Project;
  idx: ProjectIndex;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  filter: FilterState;
  query: string;
  onCount: (c: { nodes: number; edges: number }) => void;
  routeId: string;
  onRouteChange: (id: string) => void;
  onSaveRoute?: (route: Project['routes'][number]) => void;
}

interface Pos {
  id: string;
  x: number;
  y: number;
  w: number;
  col: number;
  color: string;
  dim: boolean;
}

const COL_W = 250;
const ROW_H = 30;

export default function RouteView({
  project, idx, selectedId, onSelect, filter, query, onCount, routeId, onRouteChange, onSaveRoute,
}: Props) {
  const { push } = useRouter();
  const [zoom, setZoom] = useState(0.82);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [size, setSize] = useState({ w: 1000, h: 700 });
  const [relMode, setRelMode] = useState<'main' | 'all'>('main');
  const wrapRef = useRef<HTMLDivElement>(null);
  const panRef = useRef<{ x: number; y: number; px: number; py: number } | null>(null);

  // ---- AI 重排路线 ----
  const [aiBusy, setAiBusy] = useState(false);
  const [aiErr, setAiErr] = useState('');
  const [aiLevel, setAiLevel] = useState<'beginner' | 'intermediate' | 'advanced' | 'expert'>('advanced');
  const [aiRes, setAiRes] = useState<AiRouteResult | null>(null);

  const route = project.routes.find((r) => r.id === routeId) ?? project.routes[0];
  const q = query.trim().toLowerCase();

  /** 项目无节点、或没有任何学习路线时都走空态，避免 route 为空时后续取字段崩溃 */
  const isEmpty = project.nodes.filter((n) => n.level !== 'root').length === 0 || !route;

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const apply = () => setSize({ w: el.clientWidth || 1000, h: el.clientHeight || 700 });
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    apply();
    return () => ro.disconnect();
  }, []);

  /**
   * 路线内节点集合（含必要前导）。
   * 只补「直接前导」且设上限：roadmap 类视图超过 ~90 个节点就不可读了，
   * 与参考产品 70–81 节点的量级保持一致。
   */
  const inRoute = useMemo(() => {
    const set = new Set<string>();
    // 路线节点太多（>90）时按顺序均匀抽样，保证画布可读；P1 概览路线也要能看清
    const all: string[] = [];
    for (const s of route?.stages ?? []) for (const id of s.nodes) if (!all.includes(id)) all.push(id);
    const CAP = 78;
    const picked = all.length <= CAP
      ? all
      : Array.from({ length: CAP }, (_, i) => all[Math.floor((i * all.length) / CAP)]);
    for (const id of picked) set.add(id);
    const base = [...set];
    const extra: string[] = [];
    for (const id of base) {
      const n = idx.byId.get(id);
      if (!n) continue;
      for (const pre of n.prerequisites) {
        if (!set.has(pre) && idx.byId.has(pre) && extra.length < 16 && !extra.includes(pre)) {
          extra.push(pre);
        }
      }
    }
    for (const id of extra) set.add(id);
    return set;
  }, [route, idx]);

  const nodes = useMemo(
    () =>
      project.nodes.filter((n) => {
        if (n.level === 'root') return false;
        if (!inRoute.has(n.id)) return false;
        return true;
      }),
    [project, inRoute]
  );

  /** 分列布局：按 L1→L2→L3→L4 铺 4 列（与截图"在左到右逐层递进"一致） */
  const layout = useMemo(() => {
    const rank: Record<string, number> = { L1: 0, L2: 1, L3: 2, L4: 3 };
    const cols: KnowledgePoint[][] = [[], [], [], []];
    for (const n of nodes) {
      const r = rank[n.level] ?? 1;
      cols[r].push(n);
    }
    const branchOrder = new Map(project.branches.map((b, i) => [b.id, i]));
    for (const c of cols) {
      c.sort((a, b) => (branchOrder.get(a.branch)! - branchOrder.get(b.branch)!) || a.name.localeCompare(b.name, 'zh'));
    }

    const positions = new Map<string, Pos>();
    const COL_GAP = 70;

    // 以列宽 + 间隙累加真实 x 起点，避免长名互相覆盖
    const colX: number[] = [];
    let acc = 0;
    cols.forEach((col) => {
      colX.push(acc);
      const maxW = Math.max(60, ...col.map((n) => Math.max(58, Math.min(150, n.name.length * 11.5 + 14))));
      acc += maxW + COL_GAP;
    });

    const maxLen = Math.max(...cols.map((c) => c.length), 1);
    const totalH = maxLen * ROW_H;

    cols.forEach((col, ci) => {
      const startY = -totalH / 2 + (maxLen - col.length) * ROW_H / 2;
      col.forEach((n, ri) => {
        const b = idx.branchById.get(n.branch);
        const w = Math.max(58, Math.min(150, n.name.length * 11.5 + 14));
        positions.set(n.id, {
          id: n.id,
          x: colX[ci],
          y: startY + ri * ROW_H + ROW_H / 2,
          w,
          col: ci,
          color: b?.color ?? '#64748B',
          dim: !nodePasses(n, filter),
        });
      });
    });

    return { positions, cols, colX, totalH };
  }, [nodes, project, idx, filter]);

  const links = useMemo(() => {
    const out: { from: string; to: string; type: RelationTypeId }[] = [];
    for (const n of nodes) {
      for (const p of n.prerequisites) {
        if (layout.positions.has(p)) out.push({ from: p, to: n.id, type: 'depends' });
      }
      if (n.parent && layout.positions.has(n.parent) && relMode === 'all') out.push({ from: n.parent, to: n.id, type: 'contains' });
    }
    for (const e of project.edges) {
      if (e.type === 'depends' || e.type === 'contains') {
        if (relMode === 'all' && layout.positions.has(e.from) && layout.positions.has(e.to)) out.push({ from: e.from, to: e.to, type: e.type });
        continue;
      }
      if (layout.positions.has(e.from) && layout.positions.has(e.to)) out.push({ from: e.from, to: e.to, type: e.type });
    }
    return out;
  }, [nodes, layout, project, relMode]);

  /** 三色链路 */
  const chain = useMemo(() => {
    const pre = new Set<string>();
    const post = new Set<string>();
    const direct = new Set<string>();
    if (!selectedId) return { pre, post, direct, relEdges: new Set<string>() };

    const adjOut = new Map<string, string[]>();
    const adjIn = new Map<string, string[]>();
    for (const l of links) {
      if (l.type !== 'depends' && l.type !== 'evolved' && l.type !== 'extends') continue;
      if (!adjOut.has(l.from)) adjOut.set(l.from, []);
      adjOut.get(l.from)!.push(l.to);
      if (!adjIn.has(l.to)) adjIn.set(l.to, []);
      adjIn.get(l.to)!.push(l.from);
    }

    const walk = (start: string, adj: Map<string, string[]>, acc: Set<string>) => {
      const st = [start];
      const seen = new Set<string>([start]);
      while (st.length) {
        const cur = st.pop()!;
        for (const nxt of adj.get(cur) ?? []) {
          if (seen.has(nxt)) continue;
          seen.add(nxt);
          acc.add(nxt);
          st.push(nxt);
        }
      }
    };

    walk(selectedId, adjIn, pre);
    walk(selectedId, adjOut, post);
    for (const d of adjOut.get(selectedId) ?? []) direct.add(d);
    for (const d of adjIn.get(selectedId) ?? []) direct.add(d);

    const relEdges = new Set<string>();
    for (const l of links) {
      if (pre.has(l.to) && (pre.has(l.from) || l.from === selectedId)) relEdges.add(`${l.from}|${l.to}`);
      if (post.has(l.from) && (post.has(l.to) || l.to === selectedId)) relEdges.add(`${l.from}|${l.to}`);
    }
    return { pre, post, direct, relEdges };
  }, [selectedId, links]);

  useEffect(() => {
    onCount({ nodes: nodes.length, edges: links.length });
  }, [nodes.length, links.length, onCount]);

  const fit = useCallback(() => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of layout.positions.values()) {
      x0 = Math.min(x0, p.x);
      x1 = Math.max(x1, p.x + p.w);
      y0 = Math.min(y0, p.y - 14);
      y1 = Math.max(y1, p.y + 14);
    }
    if (!isFinite(x0)) return;
    const W = size.w - 90;
    const H = size.h - 110;
    const z = Math.min(1.15, Math.max(0.14, Math.min(W / Math.max(1, x1 - x0), H / Math.max(1, y1 - y0))));
    const cxW = (x0 + x1) / 2;
    const cyW = (y0 + y1) / 2;
    setZoom(z);
    setPan({ x: -cxW * z, y: -cyW * z });
  }, [layout.positions, size]);

  useLayoutEffect(() => { fit(); }, [fit, routeId]);

  const posOf = (id: string) => layout.positions.get(id);

  const bezier = (a: Pos, b: Pos) => {
    const x1 = a.x + a.w;
    const y1 = a.y;
    const x2 = b.x;
    const y2 = b.y;
    const mx = (x1 + x2) / 2;
    return `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`;
  };

  const dashFor = (t: RelationTypeId) => {
    const rt = RELATION_TYPES.find((r) => r.id === t);
    return rt?.style === 'dashed' ? '5 4' : rt?.style === 'dotted' ? '1.5 4' : undefined;
  };

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    setZoom((z) => Math.min(3, Math.max(0.12, z * (e.deltaY > 0 ? 0.92 : 1.08))));
  };
  const onDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('[data-nid]')) return;
    panRef.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y };
  };
  const onMove = (e: React.MouseEvent) => {
    if (!panRef.current) return;
    setPan({ x: panRef.current.px + (e.clientX - panRef.current.x), y: panRef.current.py + (e.clientY - panRef.current.y) });
  };
  const onUp = () => { panRef.current = null; };

  const sel = selectedId ? idx.byId.get(selectedId) : null;
  const selBranch = sel ? idx.branchById.get(sel.branch) : null;
  const selStage = sel ? String(sel.dimensions?.stage ?? 'core') : '';
  const selLayerName = { basic: 'L1 基础认知', core: 'L2 核心理论', adv: 'L3 高级前沿' }[selStage] ?? '';

  const exportPng = () => {
    const svg = wrapRef.current?.querySelector('svg');
    if (svg) downloadPngFromSvg(svg, `${project.name}-${route?.name ?? '学习路线'}.png`);
  };

  const exportSvgFile = () => {
    const svg = wrapRef.current?.querySelector('svg');
    if (svg) downloadSvg(svg, `${project.name}-${route?.name ?? '学习路线'}.svg`);
  };

  const runAi = async () => {
    setAiBusy(true);
    setAiErr('');
    setAiRes(null);
    try {
      const r = await aiBuildRoute(project, { routeId: route?.id, level: aiLevel });
      if (!r.route.stages.length) {
        setAiErr('AI 没排出有效阶段，请重试');
      } else {
        setAiRes(r);
      }
    } catch (e: any) {
      setAiErr(String(e?.message ?? e));
    } finally {
      setAiBusy(false);
    }
  };

  const applyAi = () => {
    if (!aiRes || !onSaveRoute) return;
    onSaveRoute(aiRes.route);
    onRouteChange(aiRes.route.id);
    setAiRes(null);
  };

  const COL_TITLE = ['L1 一级分支', 'L2 子领域', 'L3 方法', 'L4 原子单元'];
  const totalH = layout.totalH;

  return (
    <div className="view">
      <div className="view-toolbar rt-toolbar">
        <div className="rt-title-wrap">
          <span className="rt-title">学习路线图（在左到右逐层递进）</span>
          <span className="rt-sub">箭头方向统一表示：前导知识 → 后续知识。点击节点高亮蓝色前导、绿色后续、粉色直接路径。</span>
        </div>
        <div className="rt-controls">
          <span className="mx-label">路线</span>
          <select className="select" value={route?.id ?? ''} onChange={(e) => onRouteChange(e.target.value)} style={{ maxWidth: 240 }}>
            {project.routes.map((r) => (
              <option key={r.id} value={r.id}>{r.name} ({r.level} · {r.nodeCount}节点)</option>
            ))}
          </select>
          <span className="mx-label">关系</span>
          <select className="select" value={relMode} onChange={(e) => setRelMode(e.target.value as any)}>
            <option value="main">学习主线</option>
            <option value="all">全部关系</option>
          </select>
          <button className="btn-text" onClick={fit}>重置视图</button>
          <button className="btn-text" onClick={() => onSelect(null)}>清除高亮</button>
          <span className="rt-ai-sep" />
          <select className="select" value={aiLevel} onChange={(e) => setAiLevel(e.target.value as any)} style={{ maxWidth: 108 }} title="AI 重排的目标难度">
            <option value="beginner">零基础</option>
            <option value="intermediate">有基础</option>
            <option value="advanced">系统学</option>
            <option value="expert">进阶专家</option>
          </select>
          <button className="btn-text rt-ai-btn" onClick={() => void runAi()} disabled={aiBusy} title="让 AI 按前置依赖和主流学习顺序重排路线">
            {aiBusy ? <IconRefresh size={14} /> : <IconSparkle size={14} />}
            {aiBusy ? 'AI 重排中…' : 'AI 重排路线'}
          </button>
          <button className="btn-text" onClick={exportPng}><IconDownload size={14} /> 导出图片</button>
          <button className="btn-text" onClick={exportSvgFile}>SVG</button>
        </div>
      </div>

      <div className="rt-legend">
        <span className="rt-lg"><span className="rt-lg-line dep" />前导依赖 depends</span>
        <span className="rt-lg"><span className="rt-lg-line con" />组装包含 contains</span>
        <span className="rt-lg"><span className="rt-lg-line evo" />思想/方法演进 evolved</span>
        <span className="rt-lg"><span className="rt-lg-line ctr" />对比阅读 contrast</span>
        <span className="rt-lg"><span className="rt-lg-line ana" />类比参照 analogy</span>
        <span className="rt-lg"><span className="rt-lg-dot" />节点颜色表示主维度分组</span>
      </div>

      <div
        className="rt-canvas"
        ref={wrapRef}
        onWheel={onWheel}
        onMouseDown={onDown}
        onMouseMove={onMove}
        onMouseUp={onUp}
        onMouseLeave={onUp}
        onClick={(e) => { if (!(e.target as HTMLElement).closest('[data-nid]')) onSelect(null); }}
      >
        {isEmpty && (
          <EmptyCanvas
            title="该知识体系暂无节点，请重新生成或导入 YAML"
            hint="也可以到「项目设置」里重新生成，或从已有 YAML 文件导入"
            actionLabel="返回我的项目"
            onAction={() => push({ name: 'home' })}
          />
        )}
        <svg className="rt-svg" width={size.w} height={size.h}>
          <g transform={`translate(${size.w / 2 + pan.x}, ${size.h / 2 + pan.y}) scale(${zoom})`}>
            {/* 阶段背景带 + 列标题 */}
            {layout.cols.map((col, i) => (
              <g key={i}>
                <rect
                  x={(layout.colX[i] ?? i * COL_W) - 14}
                  y={-totalH / 2 - 34}
                  width={(layout.cols[i + 1] ? layout.colX[i + 1] : (layout.colX[i] ?? 0) + 180) - (layout.colX[i] ?? 0) - 26}
                  height={totalH + 46}
                  rx="8"
                  fill={i % 2 === 0 ? '#F6F8FC' : '#FAFBFD'}
                />
                <text x={layout.colX[i] ?? i * COL_W} y={-totalH / 2 - 16} fontSize="10.5" fill="#8A9099" fontWeight="600">
                  {COL_TITLE[i]} · {col.length}
                </text>
              </g>
            ))}

            {/* 边 */}
            <g>
              {links.map((l, i) => {
                const a = posOf(l.from);
                const b = posOf(l.to);
                if (!a || !b) return null;
                const key = `${l.from}|${l.to}`;
                const isHi = chain.relEdges.has(key);
                const isDirect = l.from === selectedId || l.to === selectedId;
                const rt = RELATION_TYPES.find((r) => r.id === l.type)!;
                let stroke = rt.color;
                let width = 1.2;
                let op = 0.42;
                if (selectedId) {
                  if (isDirect) { stroke = '#DB2777'; width = 2.2; op = 1; }
                  else if (isHi) { stroke = chain.post.has(l.from) ? '#16A34A' : '#3B82F6'; width = 1.7; op = 0.95; }
                  else { stroke = '#DDE1E8'; width = 0.9; op = 0.35; }
                }
                return (
                  <path
                    key={i}
                    d={bezier(a, b)}
                    fill="none"
                    stroke={stroke}
                    strokeWidth={width}
                    strokeDasharray={dashFor(l.type)}
                    opacity={op}
                    markerEnd={rt.arrow ? 'url(#rt-arrow)' : undefined}
                  />
                );
              })}
            </g>

            {/* 节点 */}
            <g>
              {[...layout.positions.values()].map((p) => {
                const n = idx.byId.get(p.id);
                if (!n) return null;
                if (q && !n.name.toLowerCase().includes(q) && !(n.nameEn ?? '').toLowerCase().includes(q)) return null;
                const isSel = selectedId === p.id;
                const isPre = chain.pre.has(p.id);
                const isPost = chain.post.has(p.id);
                const isDirect = chain.direct.has(p.id);
                let fill = p.color;
                let stroke = 'none';
                let sw = 0;
                if (selectedId) {
                  if (isSel || isDirect) { stroke = '#DB2777'; sw = 2.2; }
                  else if (isPre) { fill = '#DBEAFE'; stroke = '#3B82F6'; sw = 1.6; }
                  else if (isPost) { fill = '#DCFCE7'; stroke = '#16A34A'; sw = 1.6; }
                }
                const dim = (selectedId && !isPre && !isPost && !isDirect && !isSel) || p.dim;
                return (
                  <g
                    key={p.id}
                    data-nid={p.id}
                    transform={`translate(${p.x}, ${p.y - 10})`}
                    opacity={dim ? 0.22 : 1}
                    style={{ cursor: 'pointer' }}
                    onClick={(e) => { e.stopPropagation(); onSelect(p.id); }}
                  >
                    <rect width={p.w} height="20" rx="4" fill={fill} stroke={stroke} strokeWidth={sw} />
                    <text
                      x={p.w / 2}
                      y="13.5"
                      textAnchor="middle"
                      fontSize="10.5"
                      fill={isPre || isPost ? '#1F2329' : '#fff'}
                      fontWeight={isSel ? 600 : 400}
                    >
                      {n.name.length > 10 ? n.name.slice(0, 9) + '…' : n.name}
                    </text>
                  </g>
                );
              })}
            </g>
          </g>

          <defs>
            <marker id="rt-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#94A3B8" />
            </marker>
          </defs>
        </svg>

        {(aiRes || aiErr || aiBusy) && (
          <div className="rt-ai-panel">
            <div className="rt-ai-head">
              <span className="rt-ai-title">
                <IconSparkle size={13} /> AI 学习路线
                {aiBusy && <span className="rt-ai-busy">分析中…</span>}
              </span>
              {aiRes && (
                <span className="rt-ai-meta">
                  {Math.round(aiRes.elapsedMs / 1000)}s · {aiRes.route.stages.length} 阶段 · {aiRes.route.nodeCount} 节点
                  {aiRes.webUsed && aiRes.sources.length > 0 && ` · 联网 ${aiRes.sources.length} 源`}
                </span>
              )}
              <button className="detail-close" onClick={() => { setAiRes(null); setAiErr(''); }}><IconClose size={14} /></button>
            </div>

            <p className="rt-ai-desc">{aiRes?.route.description}</p>

            {aiRes?.route.stages.map((s, i) => (
              <div key={i} className="rt-ai-stage">
                <div className="rt-ai-stage-head">
                  <span className="rt-ai-stage-n">{i + 1}</span>
                  <span className="rt-ai-stage-name">{s.name}</span>
                  <span className="rt-ai-stage-count">{s.nodes.length} 节点</span>
                  <span className="rt-ai-stage-layer">{s.layer}</span>
                </div>
                {aiRes.rationale[i]?.why && <div className="rt-ai-why">{aiRes.rationale[i].why}</div>}
                <div className="rt-ai-nodes">
                  {s.nodes.slice(0, 10).map((id) => (
                    <button key={id} className="rt-ai-chip" onClick={() => onSelect(id)}>
                      {idx.byId.get(id)?.name ?? id}
                    </button>
                  ))}
                  {s.nodes.length > 10 && <span className="rt-ai-more">+{s.nodes.length - 10}</span>}
                </div>
              </div>
            ))}

            {aiRes && aiRes.sources.length > 0 && (
              <div className="rt-ai-sources">
                {aiRes.sources.slice(0, 5).map((u, i) => (
                  <a
                    key={i}
                    href={u}
                    className="rt-ai-src"
                    onClick={(e) => {
                      if (desktop) {
                        e.preventDefault();
                        void desktop.openExternal(u);
                      }
                    }}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <IconLink size={10} /> {shortHost(u)}
                  </a>
                ))}
              </div>
            )}

            {aiErr && <div className="rt-ai-err"><IconAlert size={13} /> {aiErr}</div>}

            {aiRes && (
              <div className="rt-ai-foot">
                <button className="learn-btn primary" onClick={applyAi}>
                  <IconCheck size={13} /> 保存为新路线
                </button>
                <button className="learn-btn" onClick={() => void runAi()} disabled={aiBusy}>
                  <IconRefresh size={12} /> 重新生成
                </button>
                <span className="rt-ai-tip">不会覆盖原路线，会新增一条并在下拉框里可切换</span>
              </div>
            )}
          </div>
        )}

        {sel && (
          <div className="rt-card">
            <div className="rt-card-head">
              <span className="rt-card-title">{sel.name}</span>
              <button className="detail-close" onClick={() => onSelect(null)}><IconClose size={14} /></button>
            </div>
            <div className="rt-card-meta">
              {selBranch?.name} | {selLayerName} | 难度 {sel.difficulty}/4
            </div>
            <div className="rt-card-desc">{sel.description}</div>
            <div className="rt-card-kv">
              <div>
                <span className="rt-k">直接前导</span>
                <span className="rt-v">
                  {(idx.incoming.get(sel.id) ?? []).filter((e) => e.type === 'depends').map((e) => idx.byId.get(e.from)?.name).filter(Boolean).join('、') || '无'}
                </span>
              </div>
              <div>
                <span className="rt-k">可组装/通向</span>
                <span className="rt-v">
                  {(idx.outgoing.get(sel.id) ?? []).filter((e) => e.type === 'depends').map((e) => idx.byId.get(e.to)?.name).filter(Boolean).slice(0, 4).join('、') || '无'}
                </span>
              </div>
              <div>
                <span className="rt-k">组装说明</span>
                <span className="rt-v">{sel.assembleNote ?? (sel.prerequisites.length ? `由 ${sel.prerequisites.length} 个直接前导共同支撑` : '暂无多个直接前导')}</span>
              </div>
              <div>
                <span className="rt-k">L4 组成</span>
                <span className="rt-v">{(idx.children.get(sel.id) ?? []).filter((c) => c.level === 'L4').map((c) => c.name.replace(sel.name + '·', '')).join('、') || '无'}</span>
              </div>
            </div>
            <div className="rt-card-legend">
              <span><i style={{ background: '#DBEAFE', borderColor: '#3B82F6' }} />前导</span>
              <span><i style={{ background: '#DCFCE7', borderColor: '#16A34A' }} />后续</span>
              <span><i style={{ background: '#FCE7F3', borderColor: '#DB2777' }} />直接路径</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function shortHost(u: string) {
  try {
    return new URL(u).hostname.replace(/^www\./, '');
  } catch {
    return u.slice(0, 32);
  }
}

