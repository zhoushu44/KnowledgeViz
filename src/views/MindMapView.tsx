import { useMemo, useRef, useState, useEffect, useLayoutEffect, useCallback } from 'react';
import type { Project, ProjectIndex, KnowledgePoint } from '../lib/types';
import type { FilterState } from '../components/DimensionFilter';
import { nodePasses } from '../components/DimensionFilter';
import { IconDownload, IconExpand, IconPlus, IconMinus } from '../components/Icons';
import EmptyCanvas from '../components/EmptyCanvas';
import MapAdjustPanel from '../components/MapAdjustPanel';
import { useRouter } from '../store/router';
import { downloadPngFromSvg, downloadSvg } from '../lib/export';

interface Props {
  project: Project;
  idx: ProjectIndex;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  filter: FilterState;
  query: string;
  onCount: (c: { nodes: number; edges: number }) => void;
}

interface LaidNode {
  id: string;
  name: string;
  x: number;
  y: number;
  w: number;
  depth: number;
  color: string;
  isRoot: boolean;
  isL1: boolean;
  hasKids: boolean;
  collapsed: boolean;
  side: -1 | 1;
  dim: boolean;
}

const NODE_H = 28;
const GAP_Y = 10;
const COL_W = 176;
const LEVEL_RANK: Record<string, number> = { root: 0, L1: 1, L2: 2, L3: 3, L4: 4 };

export default function MindMapView({ project, idx, selectedId, onSelect, filter, query, onCount }: Props) {
  const { push } = useRouter();
  const [maxDepth, setMaxDepth] = useState(2);
  const [manual, setManual] = useState<Record<string, boolean>>({});
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [size, setSize] = useState({ w: 1000, h: 700 });
  const [fitNonce, setFitNonce] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const fitted = useRef(false);

  const q = query.trim().toLowerCase();

  /** 项目无节点（除根节点外没有任何知识点）时展示空态 */
  const isEmpty = project.nodes.filter((n) => n.level !== 'root').length === 0;

  const matches = useMemo(() => {
    if (!q) return null;
    const s = new Set<string>();
    for (const n of project.nodes) {
      if (n.name.toLowerCase().includes(q) || (n.nameEn ?? '').toLowerCase().includes(q)) {
        s.add(n.id);
        for (const p of idx.pathOf(n.id)) s.add(p.id);
      }
    }
    return s;
  }, [q, project, idx]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setSize({ w: el.clientWidth, h: el.clientHeight });
    });
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const layout = useMemo(() => {
    const root = project.nodes.find((n) => !n.parent);
    if (!root) return { nodes: [] as LaidNode[], links: [] as { from: string; to: string; color: string }[], bounds: { x0: 0, y0: 0, x1: 0, y1: 0 } };

    const isOpen = (n: KnowledgePoint): boolean => {
      const override = manual[n.id];
      if (override !== undefined) return override;
      return LEVEL_RANK[n.level] < maxDepth;
    };

    const kidsOf = (id: string): KnowledgePoint[] => {
      if (!isOpen(idx.byId.get(id)!)) return [];
      return idx.children.get(id) ?? [];
    };

    const heightOf = (n: KnowledgePoint): number => {
      const kids = kidsOf(n.id);
      if (!kids.length) return NODE_H;
      return kids.reduce((s, k) => s + heightOf(k), 0) + (kids.length - 1) * GAP_Y;
    };

    const out: LaidNode[] = [];
    const links: { from: string; to: string; color: string }[] = [];

    const place = (n: KnowledgePoint, side: -1 | 1, x: number, yTop: number, depth: number) => {
      const h = heightOf(n);
      const b = idx.branchById.get(n.branch);
      const kids = kidsOf(n.id);
      const w = Math.max(74, Math.min(COL_W - 30, n.name.length * 11.5 + (depth <= 1 ? 34 : 22)));
      out.push({
        id: n.id, name: n.name, x: x * side, y: yTop + h / 2, w, depth,
        color: b?.color ?? '#64748B',
        isRoot: depth === 0, isL1: depth === 1,
        hasKids: (idx.children.get(n.id) ?? []).length > 0,
        collapsed: !isOpen(n),
        side,
        dim: !nodePasses(n, filter) || (!!matches && !matches.has(n.id)),
      });
      let cy = yTop;
      for (const k of kids) {
        links.push({ from: n.id, to: k.id, color: b?.color ?? '#64748B' });
        place(k, side, x + COL_W, cy, depth + 1);
        cy += heightOf(k) + GAP_Y;
      }
    };

    const l1 = kidsOf(root.id);
    const leftCount = Math.ceil(l1.length / 2);
    const left = l1.slice(0, leftCount);
    const right = l1.slice(leftCount);

    const rootW = 180;
    out.push({
      id: root.id, name: root.name, x: 0, y: 0, w: rootW, depth: 0,
      color: '#1F2373', isRoot: true, isL1: false, hasKids: true, collapsed: false, side: 1, dim: false,
    });

    let y = -(left.reduce((s, k) => s + heightOf(k), 0) + Math.max(0, left.length - 1) * GAP_Y) / 2;
    for (const k of left) {
      const b = idx.branchById.get(k.branch);
      links.push({ from: root.id, to: k.id, color: b?.color ?? '#64748B' });
      place(k, -1, COL_W, y, 1);
      y += heightOf(k) + GAP_Y;
    }

    y = -(right.reduce((s, k) => s + heightOf(k), 0) + Math.max(0, right.length - 1) * GAP_Y) / 2;
    for (const k of right) {
      const b = idx.branchById.get(k.branch);
      links.push({ from: root.id, to: k.id, color: b?.color ?? '#64748B' });
      place(k, 1, COL_W, y, 1);
      y += heightOf(k) + GAP_Y;
    }

    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const n of out) {
      const leftEdge = n.side === -1 ? n.x - n.w : n.x;
      x0 = Math.min(x0, leftEdge);
      x1 = Math.max(x1, leftEdge + n.w);
      y0 = Math.min(y0, n.y - NODE_H / 2);
      y1 = Math.max(y1, n.y + NODE_H / 2);
    }

    return { nodes: out, links, bounds: { x0, y0, x1, y1 } };
  }, [project, idx, maxDepth, manual, filter, matches]);

  useEffect(() => {
    onCount({ nodes: layout.nodes.length, edges: layout.links.length });
  }, [layout, onCount]);

  /** 自动适应窗口 */
  const fit = useCallback(() => {
    const { x0, y0, x1, y1 } = layout.bounds;
    const cw = Math.max(1, x1 - x0) + 80;
    const ch = Math.max(1, y1 - y0) + 80;
    const z = Math.min(2, Math.min(size.w / cw, size.h / ch));
    setZoom(Math.max(0.22, z));
    setPan({ x: 0, y: 0 });
  }, [layout.bounds, size]);

  useLayoutEffect(() => {
    if (!size.w || !size.h || !layout.nodes.length) return;
    fitted.current = false;
    fit();
    // 仅在首次布局 / 尺寸变化时自适应
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size.w, size.h, maxDepth, project.id, fitNonce]);

  const nodeById = useMemo(() => new Map(layout.nodes.map((n) => [n.id, n])), [layout]);

  const bezier = (f: LaidNode, t: LaidNode) => {
    const x1 = f.x;
    const x2 = t.x;
    const midX = (x1 + x2) / 2;
    return `M ${x1} ${f.y} C ${midX} ${f.y}, ${midX} ${t.y}, ${x2} ${t.y}`;
  };

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    setZoom((z) => Math.min(3, Math.max(0.18, z * (e.deltaY > 0 ? 0.92 : 1.09))));
  };

  const onDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('[data-nid]')) return;
    dragRef.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y };
  };
  const onMove = (e: React.MouseEvent) => {
    if (!dragRef.current) return;
    setPan({ x: dragRef.current.px + (e.clientX - dragRef.current.x), y: dragRef.current.py + (e.clientY - dragRef.current.y) });
  };
  const onUp = () => { dragRef.current = null; };

  const toggle = (id: string) => {
    setManual((m) => {
      const cur = m[id] ?? LEVEL_RANK[idx.byId.get(id)!.level] < maxDepth;
      return { ...m, [id]: !cur };
    });
  };

  const exportPng = () => {
    const svg = wrapRef.current?.querySelector('svg');
    if (svg) downloadPngFromSvg(svg, `${project.name}-思维导图.png`);
  };

  const exportSvgFile = () => {
    const svg = wrapRef.current?.querySelector('svg');
    if (svg) downloadSvg(svg, `${project.name}-思维导图.svg`);
  };

  const cx = size.w / 2;
  const cy = size.h / 2;

  return (
    <div className="view">
      <div className="view-toolbar">
        <span className="vt-title">思维导图</span>
        <span className="vt-sub">{layout.nodes.length} 个可见节点 · 滚轮缩放 · 拖拽平移</span>
        <div className="vt-right">
          <button className={`btn-text${maxDepth === 4 ? ' on' : ''}`} onClick={() => { setMaxDepth(4); setManual({}); }}>展开全部</button>
          <button className={`btn-text${maxDepth === 2 ? ' on' : ''}`} onClick={() => { setMaxDepth(2); setManual({}); }}>展开二级</button>
          <button className={`btn-text${maxDepth === 1 ? ' on' : ''}`} onClick={() => { setMaxDepth(1); setManual({}); }}>折叠主干</button>
          <span className="vt-div" />
          <button className="btn-text" onClick={exportPng}><IconDownload size={14} /> 导出 PNG</button>
          <button className="btn-text" onClick={exportSvgFile}>SVG</button>
          <span className="vt-div" />
          <button className="vt-icon" onClick={() => setZoom((z) => Math.max(0.18, z * 0.88))}><IconMinus size={14} /></button>
          <span className="vt-zoom mono" onClick={fit} title="点击适应窗口">{Math.round(zoom * 100)}%</span>
          <button className="vt-icon" onClick={() => setZoom((z) => Math.min(3, z * 1.14))}><IconPlus size={14} /></button>
          <button className="vt-icon" onClick={fit} title="适应窗口"><IconExpand size={14} /></button>
        </div>
      </div>

      <div
        className="mm-canvas"
        ref={wrapRef}
        onWheel={onWheel}
        onMouseDown={onDown}
        onMouseMove={onMove}
        onMouseUp={onUp}
        onMouseLeave={onUp}
        onClick={(e) => { if (!(e.target as HTMLElement).closest('[data-nid]')) onSelect(null); }}
      >
        <svg className="mm-svg" width={size.w} height={size.h}>
          <g transform={`translate(${cx + pan.x}, ${cy + pan.y}) scale(${zoom})`}>
            <g>
              {layout.links.map((l, i) => {
                const f = nodeById.get(l.from);
                const t = nodeById.get(l.to);
                if (!f || !t) return null;
                const hi = selectedId && (l.from === selectedId || l.to === selectedId);
                return (
                  <path
                    key={i}
                    d={bezier(f, t)}
                    fill="none"
                    stroke={hi ? l.color : l.color + '55'}
                    strokeWidth={hi ? 2.2 : 1.4}
                    strokeLinecap="round"
                  />
                );
              })}
            </g>
            <g>
              {layout.nodes.map((n) => {
                const isSel = selectedId === n.id;
                if (n.isRoot) {
                  return (
                    <g key={n.id} data-nid={n.id} className="mm-node" opacity={n.dim ? 0.12 : 1} transform={`translate(${-n.w / 2}, ${n.y - 21})`} onClick={(e) => { e.stopPropagation(); onSelect(n.id); }}>
                      <rect width={n.w} height="42" rx="10" fill="url(#rootGrad)" />
                      <text x={n.w / 2} y="26" textAnchor="middle" className="mm-root-text">{n.name}</text>
                    </g>
                  );
                }
                const leftEdge = n.side === -1 ? -n.w : 0;
                if (n.isL1) {
                  return (
                    <g key={n.id} data-nid={n.id} className="mm-node" opacity={n.dim ? 0.12 : 1} transform={`translate(${n.x + leftEdge}, ${n.y - 13})`} onClick={(e) => { e.stopPropagation(); onSelect(n.id); }}>
                      <rect width={n.w} height="26" rx="13" fill={n.color} opacity={isSel ? 1 : 0.94} />
                      {isSel && <rect width={n.w} height="26" rx="13" fill="none" stroke="#1F2329" strokeWidth="1.6" />}
                      <text x={n.w / 2} y="17.5" textAnchor="middle" className="mm-l1-text">{n.name}</text>
                      {n.hasKids && (
                        <g className="mm-toggle" transform={`translate(${n.side === -1 ? -6 : n.w + 6}, 0)`} onClick={(e) => { e.stopPropagation(); toggle(n.id); }}>
                          <circle r="6.5" fill="#fff" stroke={n.color} strokeWidth="1.3" />
                          <text y="3.2" textAnchor="middle" fontSize="9" fill={n.color} fontWeight="700">{n.collapsed ? '+' : '−'}</text>
                        </g>
                      )}
                    </g>
                  );
                }
                return (
                  <g key={n.id} data-nid={n.id} className="mm-node" opacity={n.dim ? 0.12 : 1} transform={`translate(${n.x + leftEdge}, ${n.y - 12})`} onClick={(e) => { e.stopPropagation(); onSelect(n.id); }}>
                    <rect width={n.w} height="24" rx="5" fill="#fff" stroke={isSel ? n.color : '#E4E8F0'} strokeWidth={isSel ? 1.6 : 1} />
                    <rect width="2.5" height="24" rx="1.2" fill={n.color} />
                    <text x="8" y="16" className="mm-node-text">
                      {n.name.length > 11 ? n.name.slice(0, 10) + '…' : n.name}
                    </text>
                    {n.hasKids && (
                      <g className="mm-toggle" transform={`translate(${n.side === -1 ? -6 : n.w + 6}, 0)`} onClick={(e) => { e.stopPropagation(); toggle(n.id); }}>
                        <circle r="5.5" fill="#fff" stroke="#CBD2DE" strokeWidth="1" />
                        <text y="2.8" textAnchor="middle" fontSize="8" fill="#8A9099" fontWeight="700">{n.collapsed ? '+' : '−'}</text>
                      </g>
                    )}
                  </g>
                );
              })}
            </g>
          </g>
          <defs>
            <linearGradient id="rootGrad" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#1F2373" />
              <stop offset="100%" stopColor="#2E3A9E" />
            </linearGradient>
          </defs>
        </svg>

        {isEmpty && (
          <EmptyCanvas
            title="该知识体系暂无节点，请重新生成或导入 YAML"
            hint="也可以到「项目设置」里重新生成，或从已有 YAML 文件导入"
            actionLabel="返回我的项目"
            onAction={() => push({ name: 'home' })}
          />
        )}

        {/* 不满意就直说：AI 出改动清单 → 确认后落到导图 */}
        <div
          className="mm-ai-dock"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          onWheel={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
        >
          <MapAdjustPanel
            project={project}
            idx={idx}
            selectedId={selectedId}
            onSelect={onSelect}
            onApplied={({ expand }) => {
              // 新加的节点多半在折叠层里：把落点及其祖先链展开，否则看起来「什么都没变」
              setManual((m) => {
                const next = { ...m };
                for (const id of expand) {
                  for (const a of idx.pathOf(id)) next[a.id] = true;
                }
                return next;
              });
              setFitNonce((n) => n + 1);
            }}
          />
        </div>
      </div>
    </div>
  );
}


