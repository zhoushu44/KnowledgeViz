import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  forceSimulation, forceLink, forceManyBody, forceCenter, forceCollide,
  type Simulation, type SimulationNodeDatum, type SimulationLinkDatum,
} from 'd3-force';
import type { Project, ProjectIndex, RelationTypeId } from '../lib/types';
import { RELATION_TYPES } from '../lib/types';
import type { FilterState } from '../components/DimensionFilter';
import { nodePasses } from '../components/DimensionFilter';
import { IconDownload, IconExpand, IconPlus, IconMinus } from '../components/Icons';
import EmptyCanvas from '../components/EmptyCanvas';
import { useRouter } from '../store/router';
import { downloadPngFromSvg } from '../lib/export';

interface Props {
  project: Project;
  idx: ProjectIndex;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  filter: FilterState;
  query: string;
  onCount: (c: { nodes: number; edges: number }) => void;
}

interface FNode extends SimulationNodeDatum {
  id: string;
  name: string;
  r: number;
  color: string;
  branch: string;
  level: string;
  dim: boolean;
}

interface FLink extends SimulationLinkDatum<FNode> {
  source: string | FNode;
  target: string | FNode;
  type: RelationTypeId;
  color: string;
  style: string;
}

export default function GraphView({ project, idx, selectedId, onSelect, filter, query, onCount }: Props) {
  const { push } = useRouter();
  const [active, setActive] = useState<Set<RelationTypeId>>(new Set(RELATION_TYPES.map((r) => r.id)));
  const [maxLevel, setMaxLevel] = useState<'L2' | 'L3' | 'L4'>('L4');
  const [diffFilter, setDiffFilter] = useState<'all' | 1 | 2 | 3 | 4>('all');
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [showLabels, setShowLabels] = useState(true);
  const [showLegend, setShowLegend] = useState(false);
  const [hover, setHover] = useState<string | null>(null);
  const [, force] = useState(0);

  const svgRef = useRef<SVGSVGElement>(null);
  const simRef = useRef<Simulation<FNode, FLink> | null>(null);
  const nodesRef = useRef<FNode[]>([]);
  const linksRef = useRef<FLink[]>([]);
  const dragRef = useRef<{ id: string; dx: number; dy: number } | null>(null);
  const autoFitted = useRef(false);
  const [size, setSize] = useState({ w: 1000, h: 700 });
  const sizeRef = useRef({ w: 1000, h: 700 });

  const q = query.trim().toLowerCase();
  const levelRank: Record<string, number> = { root: 0, L1: 1, L2: 2, L3: 3, L4: 4 };
  const limit = levelRank[maxLevel];

  /** 项目无节点（除根节点外没有任何知识点）时展示空态 */
  const isEmpty = project.nodes.filter((n) => n.level !== 'root').length === 0;

  /** 计算关系类型计数（基于全量项目，与截图一致） */
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const r of RELATION_TYPES) c[r.id] = 0;
    for (const n of project.nodes) {
      for (const p of n.prerequisites) if (idx.byId.has(p)) c.depends++;
      if (n.parent && idx.byId.has(n.parent)) c.contains++;
    }
    for (const e of project.edges) {
      if (e.type === 'depends' || e.type === 'contains') continue;
      c[e.type] = (c[e.type] ?? 0) + 1;
    }
    return c;
  }, [project, idx]);

  const visibleNodes = useMemo(
    () =>
      project.nodes.filter((n) => {
        if (limit === 0) return false;
        if (levelRank[n.level] > limit) return false;
        if (diffFilter !== 'all' && n.difficulty !== diffFilter) return false;
        return true;
      }),
    [project, limit, filter, diffFilter]
  );

  const visibleIds = useMemo(() => new Set(visibleNodes.map((n) => n.id)), [visibleNodes]);

  const visibleLinks = useMemo(() => {
    const out: { from: string; to: string; type: RelationTypeId }[] = [];
    for (const n of project.nodes) {
      if (!visibleIds.has(n.id)) continue;
      for (const p of n.prerequisites) if (visibleIds.has(p)) out.push({ from: p, to: n.id, type: 'depends' });
      if (n.parent && visibleIds.has(n.parent)) out.push({ from: n.parent, to: n.id, type: 'contains' });
    }
    for (const e of project.edges) {
      if (e.type === 'depends' || e.type === 'contains') continue;
      if (visibleIds.has(e.from) && visibleIds.has(e.to)) out.push({ from: e.from, to: e.to, type: e.type });
    }
    return out.filter((l) => active.has(l.type));
  }, [project, visibleIds, active]);

  /** 邻居高亮集合 */
  const neighborSet = useMemo(() => {
    const key = hover ?? selectedId;
    if (!key) return null;
    const s = new Set<string>([key]);
    for (const l of visibleLinks) {
      const f = typeof l.from === 'string' ? l.from : (l.from as FNode).id;
      const t = typeof l.to === 'string' ? l.to : (l.to as FNode).id;
      if (f === key) s.add(t);
      if (t === key) s.add(f);
    }
    return s;
  }, [hover, selectedId, visibleLinks]);

  /** 构建并运行力导向仿真 */
  useEffect(() => {
    const prev = new Map(nodesRef.current.map((n) => [n.id, n]));
    const nodes: FNode[] = visibleNodes.map((n, i) => {
      const old = prev.get(n.id);
      const b = idx.branchById.get(n.branch);
      return {
        id: n.id,
        name: n.name,
        r: 9 + (n.importance / 100) * 11,
        color: b?.color ?? '#64748B',
        branch: n.branch,
        level: n.level,
        dim: !nodePasses(n, filter),
        x: old?.x ?? Math.cos((i / Math.max(1, visibleNodes.length)) * Math.PI * 2) * 260,
        y: old?.y ?? Math.sin((i / Math.max(1, visibleNodes.length)) * Math.PI * 2) * 260,
        vx: old?.vx, vy: old?.vy,
      };
    });

    const links: FLink[] = visibleLinks.map((l) => {
      const rt = RELATION_TYPES.find((r) => r.id === l.type)!;
      return { source: l.from, target: l.to, type: l.type, color: rt.color, style: rt.style };
    });

    nodesRef.current = nodes;
    linksRef.current = links;

    simRef.current?.stop();
    const sim = forceSimulation<FNode>(nodes)
      .force('link', forceLink<FNode, FLink>(links).id((d) => d.id).distance((l) => (l.type === 'contains' ? 46 : 74)).strength(0.72))
      .force('charge', forceManyBody().strength(-120))
      .force('center', forceCenter(0, 0))
      .force('collide', forceCollide<FNode>().radius((d) => d.r + 7))
      .alphaDecay(0.028)
      .on('tick', () => force((x) => x + 1))
      .on('end', () => { if (!autoFitted.current) { autoFitted.current = true; fitToView(); } });

    simRef.current = sim;
    onCount({ nodes: nodes.length, edges: links.length });

    // 兜底：仿真未在 2.5s 内结束时也做一次自适应
    const t = window.setTimeout(() => {
      if (!autoFitted.current) { autoFitted.current = true; fitToView(); }
    }, 2500);

    return () => { sim.stop(); clearTimeout(t); };
  }, [visibleNodes, visibleLinks, idx, onCount]);

  useEffect(() => {
    const el = svgRef.current?.parentElement;
    if (!el) return;
    const apply = () => {
      const s = { w: el.clientWidth || 1000, h: el.clientHeight || 700 };
      sizeRef.current = s;
      setSize(s);
    };
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    apply();
    return () => ro.disconnect();
  }, []);

  /** 自动适应窗口：把仿真结果缩放到画布内 */
  const fitToView = useCallback(() => {
    const ns = nodesRef.current.filter((n) => n.x != null && n.y != null && isFinite(n.x) && isFinite(n.y));
    if (!ns.length) return;
    // 用 2%~98% 分位裁剪离群点，避免个别节点把视野拉爆
    const xs = ns.map((n) => n.x!).sort((a, b) => a - b);
    const ys = ns.map((n) => n.y!).sort((a, b) => a - b);
    const pick = (arr: number[], p: number) => arr[Math.max(0, Math.min(arr.length - 1, Math.floor(arr.length * p)))];
    let x0 = pick(xs, 0.02) - 24, x1 = pick(xs, 0.98) + 24;
    let y0 = pick(ys, 0.02) - 24, y1 = pick(ys, 0.98) + 24;
    if (!isFinite(x0) || x1 - x0 < 60) { x0 -= 60; x1 += 60; }
    if (!isFinite(y0) || y1 - y0 < 60) { y0 -= 60; y1 += 60; }
    const W = sizeRef.current.w - 110;
    const H = sizeRef.current.h - 110;
    const z = Math.min(1.5, Math.max(0.12, Math.min(W / Math.max(1, x1 - x0), H / Math.max(1, y1 - y0))));
    const cxW = (x0 + x1) / 2;
    const cyW = (y0 + y1) / 2;
    setZoom(z);
    setPan({ x: -cxW * z, y: -cyW * z });
  }, []);

  useEffect(() => { if (autoFitted.current) fitToView(); }, [size, fitToView]);

  /** 拖拽 & 缩放 */
  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    setZoom((z) => Math.min(4, Math.max(0.15, z * (e.deltaY > 0 ? 0.9 : 1.1))));
  };
  const panRef = useRef<{ x: number; y: number; px: number; py: number } | null>(null);

  const screenToWorld = (clientX: number, clientY: number) => {
    const rect = svgRef.current!.getBoundingClientRect();
    const cx = size.w / 2 + pan.x;
    const cy = size.h / 2 + pan.y;
    return { x: (clientX - rect.left - cx) / zoom, y: (clientY - rect.top - cy) / zoom };
  };

  const onDown = (e: React.MouseEvent) => {
    const target = (e.target as HTMLElement).closest('[data-nid]') as HTMLElement | null;
    if (target) {
      const id = target.dataset.nid!;
      const n = nodesRef.current.find((x) => x.id === id);
      if (!n) return;
      const w = screenToWorld(e.clientX, e.clientY);
      dragRef.current = { id, dx: (n.x ?? 0) - w.x, dy: (n.y ?? 0) - w.y };
      n.fx = n.x; n.fy = n.y;
      simRef.current?.alphaTarget(0.16).restart();
      return;
    }
    panRef.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y };
  };

  const onMove = (e: React.MouseEvent) => {
    if (dragRef.current) {
      const w = screenToWorld(e.clientX, e.clientY);
      const n = nodesRef.current.find((x) => x.id === dragRef.current!.id);
      if (n) { n.fx = w.x + dragRef.current.dx; n.fy = w.y + dragRef.current.dy; }
      return;
    }
    if (panRef.current) {
      setPan({ x: panRef.current.px + (e.clientX - panRef.current.x), y: panRef.current.py + (e.clientY - panRef.current.y) });
    }
  };

  const onUp = () => {
    if (dragRef.current) {
      const n = nodesRef.current.find((x) => x.id === dragRef.current!.id);
      if (n) { n.fx = null; n.fy = null; }
      simRef.current?.alphaTarget(0);
      dragRef.current = null;
    }
    panRef.current = null;
  };

  const resetView = () => { autoFitted.current = false; simRef.current?.alpha(0.6).restart(); setTimeout(() => { autoFitted.current = true; fitToView(); }, 1200); };

  const linkPath = (l: FLink) => {
    const s = l.source as FNode;
    const t = l.target as FNode;
    if (!s || !t || s.x == null || t.x == null || s.y == null || t.y == null) return '';
    const sx0 = s.x;
    const sy0 = s.y;
    const tx0 = t.x;
    const ty0 = t.y;
    const dx = tx0 - sx0;
    const dy = ty0 - sy0;
    const dist = Math.hypot(dx, dy) || 1;
    const r1 = s.r + 2;
    const r2 = t.r + 6;
    const sx = sx0 + (dx / dist) * r1;
    const sy = sy0 + (dy / dist) * r1;
    const tx = tx0 - (dx / dist) * r2;
    const ty = ty0 - (dy / dist) * r2;
    const mx = (sx + tx) / 2 + dy * 0.14;
    const my = (sy + ty) / 2 - dx * 0.14;
    return `M ${sx} ${sy} Q ${mx} ${my} ${tx} ${ty}`;
  };

  const dashFor = (style: string) => (style === 'dashed' ? '5 4' : style === 'dotted' ? '1.5 4' : undefined);

  const exportPng = () => {
    const svg = svgRef.current;
    if (svg) downloadPngFromSvg(svg, `${project.name}-知识网络图.png`);
  };

  return (
    <div className="view">
      <div className="view-toolbar gv-toolbar">
        <div className="gv-chips">
          <button
            className={`gv-chip all${active.size === RELATION_TYPES.length ? ' on' : ''}`}
            onClick={() => setActive(active.size === RELATION_TYPES.length ? new Set() : new Set(RELATION_TYPES.map((r) => r.id)))}
          >
            全部 ({Object.values(counts).reduce((s, v) => s + v, 0)})
          </button>
          {RELATION_TYPES.map((r) => {
            const on = active.has(r.id);
            const n = counts[r.id] ?? 0;
            return (
              <button
                key={r.id}
                className={`gv-chip${on ? ' on' : ''}${n === 0 ? ' zero' : ''}`}
                style={{ color: r.color, borderColor: r.color, background: on ? r.color + '18' : '#fff' }}
                onClick={() => {
                  const next = new Set(active);
                  next.has(r.id) ? next.delete(r.id) : next.add(r.id);
                  setActive(next);
                }}
                disabled={n === 0}
              >
                <span className={`gv-chip-mark ${r.style}`} style={{ borderColor: r.color }} />
                {r.name} ({n})
              </button>
            );
          })}
        </div>

        <div className="gv-right">
          <select className="select" value={maxLevel} onChange={(e) => setMaxLevel(e.target.value as any)}>
            <option value="L2">展开层级：二级</option>
            <option value="L3">展开层级：三级</option>
            <option value="L4">展开层级：四级</option>
          </select>
          <select className="select" value={String(diffFilter)} onChange={(e) => setDiffFilter(e.target.value === 'all' ? 'all' : (+e.target.value as any))}>
            <option value="all">学习难度：全部</option>
            <option value="1">学习难度：基础</option>
            <option value="2">学习难度：入门</option>
            <option value="3">学习难度：进阶</option>
            <option value="4">学习难度：专家</option>
          </select>
          <button className="btn-text" onClick={exportPng}><IconDownload size={14} /> 导出</button>
          <button className={`btn-text${showLabels ? ' on' : ''}`} onClick={() => setShowLabels((s) => !s)}>标签</button>
          <button className={`btn-text${showLegend ? ' on' : ''}`} onClick={() => setShowLegend((s) => !s)}>图例</button>
          <span className="vt-div" />
          <button className="vt-icon" onClick={() => setZoom((z) => Math.max(0.15, z * 0.85))}><IconMinus size={14} /></button>
          <span className="vt-zoom mono">{Math.round(zoom * 100)}%</span>
          <button className="vt-icon" onClick={() => setZoom((z) => Math.min(4, z * 1.18))}><IconPlus size={14} /></button>
          <button className="vt-icon" onClick={resetView}><IconExpand size={14} /></button>
        </div>
      </div>

      <div className="gv-canvas">
        {isEmpty && (
          <EmptyCanvas
            title="该知识体系暂无节点，请重新生成或导入 YAML"
            hint="也可以到「项目设置」里重新生成，或从已有 YAML 文件导入"
            actionLabel="返回我的项目"
            onAction={() => push({ name: 'home' })}
          />
        )}
        {!isEmpty && visibleNodes.length === 0 && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 13,
              color: 'var(--text-3)',
              pointerEvents: 'none',
            }}
          >
            当前条件下没有可显示的节点
          </div>
        )}
        <svg
          ref={svgRef}
          className="gv-svg"
          onWheel={onWheel}
          onMouseDown={onDown}
          onMouseMove={onMove}
          onMouseUp={onUp}
          onMouseLeave={onUp}
          onClick={(e) => { if (!(e.target as HTMLElement).closest('[data-nid]')) onSelect(null); }}
        >
          <g transform={`translate(${size.w / 2 + pan.x}, ${size.h / 2 + pan.y}) scale(${zoom})`}>
            <g transform="translate(0,0)">
              <g className="gv-links">
                {linksRef.current.map((l, i) => {
                  const s = l.source as FNode;
                  const t = l.target as FNode;
                  if (!s || !t) return null;
                  const related = neighborSet ? neighborSet.has(s.id) && neighborSet.has(t.id) : true;
                  return (
                    <path
                      key={i}
                      d={linkPath(l)}
                      fill="none"
                      stroke={l.color}
                      strokeWidth={related ? 1.6 : 1}
                      strokeDasharray={dashFor(l.style)}
                      opacity={neighborSet ? (related ? 0.9 : 0.06) : 0.55}
                      markerEnd={RELATION_TYPES.find((r) => r.id === l.type)?.arrow ? 'url(#arrow)' : undefined}
                    />
                  );
                })}
              </g>
              <g className="gv-nodes">
                {nodesRef.current.map((n) => {
                  const dim = (neighborSet ? !neighborSet.has(n.id) : false) || n.dim;
                  const isSel = selectedId === n.id;
                  const showText = showLabels || zoom > 1.2 || n.id === selectedId;
                  return (
                    <g
                      key={n.id}
                      data-nid={n.id}
                      transform={`translate(${n.x ?? 0}, ${n.y ?? 0})`}
                      opacity={dim ? 0.12 : 1}
                      style={{ cursor: dim ? 'default' : 'pointer', pointerEvents: dim ? 'none' : 'auto' }}
                      onMouseEnter={() => setHover(n.id)}
                      onMouseLeave={() => setHover(null)}
                      onClick={(e) => { e.stopPropagation(); onSelect(n.id); }}
                    >
                      <circle
                        r={n.r}
                        fill={n.color}
                        stroke={isSel ? '#1F2329' : '#fff'}
                        strokeWidth={isSel ? 2.4 : 1.4}
                        opacity={0.92}
                      />
                      {(showText || isSel) && (
                        <text
                          x={n.r + 5}
                          y={4}
                          fontSize={11.5}
                          fill="#3A4150"
                          style={{ paintOrder: 'stroke', stroke: '#F9FAFC', strokeWidth: 3, strokeLinejoin: 'round' }}
                        >
                          {n.name.length > 14 ? n.name.slice(0, 13) + '…' : n.name}
                        </text>
                      )}
                    </g>
                  );
                })}
              </g>
            </g>
          </g>
          <defs>
            <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#94A3B8" />
            </marker>
          </defs>
        </svg>

        {showLegend && (
          <div className="gv-legend">
            <div className="gv-legend-title">关系类型</div>
            {RELATION_TYPES.map((r) => (
              <div key={r.id} className="gv-legend-row">
                <svg width="26" height="8">
                  <line x1="0" y1="4" x2="26" y2="4" stroke={r.color} strokeWidth="2" strokeDasharray={dashFor(r.style)} />
                </svg>
                {r.name}
              </div>
            ))}
            <div className="gv-legend-title" style={{ marginTop: 10 }}>分支</div>
            {project.branches.map((b) => (
              <div key={b.id} className="gv-legend-row">
                <span className="gv-legend-dot" style={{ background: b.color }} />
                {b.name}
              </div>
            ))}
          </div>
        )}

        <div className="gv-hint">拖拽节点可固定位置 · 滚轮缩放 · 空白处拖拽平移 · 双击画布恢复布局</div>
      </div>
    </div>
  );
}









