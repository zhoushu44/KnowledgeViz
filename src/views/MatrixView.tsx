import { useEffect, useMemo, useState } from 'react';
import type { Dimension, DimensionValue, KnowledgePoint, Project, ProjectIndex } from '../lib/types';
import { STAGE_LABEL, STAGE_ORDER } from '../lib/types';
import type { FilterState } from '../components/DimensionFilter';
import { nodePasses } from '../components/DimensionFilter';
import { IconDownload } from '../components/Icons';
import { downloadPngFromElement } from '../lib/export';
import './MatrixView.css';

interface Props {
  project: Project;
  idx: ProjectIndex;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  filter: FilterState;
  query: string;
  onCount: (c: { nodes: number; edges: number }) => void;
}

type ColorKey = 'density' | 'difficulty' | 'importance' | 'none';
type SortKey = 'alpha' | 'count' | 'diff';

const COLOR_OPTS: { k: ColorKey; label: string }[] = [
  { k: 'density', label: '知识密度' },
  { k: 'difficulty', label: '学习难度' },
  { k: 'importance', label: '重要度' },
  { k: 'none', label: '无' },
];

const SORT_OPTS: { k: SortKey; label: string }[] = [
  { k: 'alpha', label: '字母序' },
  { k: 'count', label: '节点数' },
  { k: 'diff', label: '平均难度' },
];

/** 维度下拉项：可能是项目里的真维度，也可能是内置伪维度 */
type DimRef =
  | { kind: 'pseudo'; id: 'branch' | 'stage'; name: string; key: 'branch' | 'stage' }
  | { kind: 'real'; id: string; name: string; dim: Dimension; branchBacked: boolean };

/** 该维度下「没值」的兜底 key */
const NONE_KEY = '—';
/** 单元格最多展示的 chip 数 */
const MAX_CHIPS = 12;
/** 维度值没有 color 时的内置色板 */
const PALETTE = [
  '#2E4A9E', '#F59E0B', '#22B573', '#14B8A6', '#E11D63',
  '#9333EA', '#0EA5E9', '#F97316', '#64748B', '#84CC16',
];
const STAGE_COLOR: Record<string, string> = { basic: '#7BA7E0', core: '#3FA76B', adv: '#D89A46' };
const BRANCH_FALLBACK = '#64748B';

/** 行 / 列下拉：优先项目里 role 匹配的真维度，为空时回退到两个内置伪维度 */
function buildDimRefs(project: Project, role: 'row' | 'column'): DimRef[] {
  const dims = project.dimensions ?? [];
  const branches = project.branches ?? [];
  const list = dims.filter((d) => d.role === role);
  if (list.length) {
    // 严格保持 dimensions 数组顺序
    return list.map((d) => ({
      kind: 'real' as const,
      id: d.id,
      name: d.name,
      dim: d,
      // 知识领域维度（dim_field）的值本身就是分支 id；内置数据集里节点只写了 stage、
      // 从不写 field，取不到值时回落到 n.branch，否则整表会塌成一行「—」
      branchBacked:
        d.id === 'dim_field' &&
        d.values.length > 0 &&
        d.values.every((v) => branches.some((b) => b.id === v.id)),
    }));
  }
  const branch: DimRef = { kind: 'pseudo', id: 'branch', name: '知识领域', key: 'branch' };
  const stage: DimRef = { kind: 'pseudo', id: 'stage', name: '学习阶段', key: 'stage' };
  // 回退固定为「知识领域 → 学习阶段」；默认选中项由 rowId / colId 初值决定（branch / stage）
  return [branch, stage];
}

/** 空值判定：undefined / null / 空串 / 空数组 都算「没有值」 */
function isEmptyVal(v: string | string[] | undefined): boolean {
  if (v == null) return true;
  if (Array.isArray(v)) return v.length === 0;
  return String(v).trim() === '';
}

/**
 * 取节点在某个维度下的 key 列表。
 * - 伪维度 branch → n.branch；伪维度 stage → n.dimensions.stage ?? 'core'
 * - 真维度 `dim_field` 先查 `n.dimensions['dim_field']`，没有则查短键 `field`
 * - 值可能是数组（如 ability: [a2]），一个节点可以落在多个行 / 列
 */
function getKeys(n: KnowledgePoint, ref: DimRef): string[] {
  let raw: string | string[] | undefined;
  if (ref.kind === 'pseudo') {
    raw = ref.key === 'branch' ? n.branch : String(n.dimensions?.stage ?? 'core');
  } else {
    raw = n.dimensions?.[ref.dim.id];
    if (isEmptyVal(raw)) {
      const short = ref.dim.id.replace(/^dim_/, '');
      if (short !== ref.dim.id) raw = n.dimensions?.[short];
    }
    // 知识领域维度：节点完全没写该键时，用其所属分支兜底
    if (isEmptyVal(raw) && ref.branchBacked) raw = n.branch;
  }
  if (isEmptyVal(raw)) return [NONE_KEY];
  const list = (Array.isArray(raw) ? raw : [raw as string])
    .map((v) => String(v).trim())
    .filter((v) => v.length > 0);
  const uniq = Array.from(new Set(list));
  return uniq.length ? uniq : [NONE_KEY];
}

function valueMapOf(ref: DimRef): Map<string, DimensionValue> {
  return ref.kind === 'real' ? new Map(ref.dim.values.map((v) => [v.id, v])) : new Map<string, DimensionValue>();
}

function labelOf(
  ref: DimRef,
  key: string,
  vm: Map<string, DimensionValue>,
  idx: ProjectIndex
): string {
  if (ref.kind === 'real') return vm.get(key)?.name ?? key;
  if (ref.key === 'branch') return idx.branchById.get(key)?.name ?? key;
  return STAGE_LABEL[key] ?? key;
}

/** 维度值在 values 里的下标 → 内置色板位置（值本身没配 color 时用） */
function paletteIndex(ref: DimRef, key: string, fallbackIndex: number): number {
  if (ref.kind !== 'real') return fallbackIndex;
  const i = ref.dim.values.findIndex((v) => v.id === key);
  return i >= 0 ? i : fallbackIndex;
}

/** 列头圆点：优先维度值自带 color，其次分支色，最后按内置色板循环 */
function dotColorOf(
  ref: DimRef,
  key: string,
  vm: Map<string, DimensionValue>,
  idx: ProjectIndex,
  fallbackIndex: number
): string {
  if (ref.kind === 'real') {
    return (
      vm.get(key)?.color ??
      idx.branchById.get(key)?.color ??
      PALETTE[paletteIndex(ref, key, fallbackIndex) % PALETTE.length]
    );
  }
  if (ref.key === 'branch') return idx.branchById.get(key)?.color ?? BRANCH_FALLBACK;
  return STAGE_COLOR[key] ?? '#94A3B8';
}

/** 行头左侧竖条：优先该行对应的分支色，其次维度值 color，最后按内置色板循环 */
function rowBarColorOf(
  ref: DimRef,
  key: string,
  vm: Map<string, DimensionValue>,
  idx: ProjectIndex,
  fallbackIndex: number
): string {
  const branchColor = idx.branchById.get(key)?.color;
  if (branchColor) return branchColor;
  if (ref.kind === 'real') {
    return vm.get(key)?.color ?? PALETTE[paletteIndex(ref, key, fallbackIndex) % PALETTE.length];
  }
  if (ref.key === 'stage') return STAGE_COLOR[key] ?? '#94A3B8';
  return BRANCH_FALLBACK;
}

/** 按维度 values 顺序排（保持业务语义），未声明的 key 按出现顺序，'—' 永远最后 */
function orderKeys(keys: string[], ref: DimRef, project: Project): string[] {
  const declared =
    ref.kind === 'real'
      ? ref.dim.values.map((v) => v.id)
      : ref.key === 'branch'
        ? project.branches.map((b) => b.id)
        : [...STAGE_ORDER];
  const at = new Map(declared.map((k, i) => [k, i]));
  const known: string[] = [];
  const unknown: string[] = [];
  const none: string[] = [];
  for (const k of keys) {
    if (k === NONE_KEY) none.push(k);
    else if (at.has(k)) known.push(k);
    else unknown.push(k);
  }
  known.sort((a, b) => (at.get(a) ?? 0) - (at.get(b) ?? 0));
  return [...known, ...unknown, ...none];
}

function avgDiff(ns: { difficulty: number }[]): number {
  if (!ns.length) return 0;
  return ns.reduce((s, n) => s + n.difficulty, 0) / ns.length;
}

export default function MatrixView({ project, idx, selectedId, onSelect, filter, query, onCount }: Props) {
  const [rowId, setRowId] = useState('branch');
  const [colId, setColId] = useState('stage');
  const [colorKey, setColorKey] = useState<ColorKey>('density');
  const [sortBy, setSortBy] = useState<SortKey>('alpha');
  const [colSort, setColSort] = useState<{ dimId: string; key: string; dir: 'asc' | 'desc' } | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const rowDims = useMemo(() => buildDimRefs(project, 'row'), [project]);
  const colDims = useMemo(() => buildDimRefs(project, 'column'), [project]);
  // 项目切换后旧 id 可能失效 → 回落到第一个可选项
  const rowRef = rowDims.find((d) => d.id === rowId) ?? rowDims[0];
  const colRef = colDims.find((d) => d.id === colId) ?? colDims[0];

  const rowValueMap = useMemo(() => valueMapOf(rowRef), [rowRef]);
  const colValueMap = useMemo(() => valueMapOf(colRef), [colRef]);

  const activeColSort = colSort && colSort.dimId === colRef.id ? colSort : null;

  const q = query.trim().toLowerCase();

  const visible = useMemo(
    () =>
      project.nodes.filter((n) => {
        if (n.level === 'root') return false;
        if (!q) return true;
        return n.name.toLowerCase().includes(q) || (n.nameEn ?? '').toLowerCase().includes(q);
      }),
    [project.nodes, q]
  );

  useEffect(() => {
    onCount({ nodes: visible.length, edges: project.edges.length });
  }, [visible.length, project.edges.length, onCount]);

  /** 一次遍历建好：行 → 节点、列 → 节点、单元格 → 节点（同一节点在同一格只出现一次） */
  const matrix = useMemo(() => {
    const rowNodes = new Map<string, KnowledgePoint[]>();
    const colNodes = new Map<string, KnowledgePoint[]>();
    const grid = new Map<string, Map<string, KnowledgePoint[]>>();

    const push = (m: Map<string, KnowledgePoint[]>, k: string, n: KnowledgePoint) => {
      const arr = m.get(k);
      if (arr) {
        if (!arr.includes(n)) arr.push(n);
      } else {
        m.set(k, [n]);
      }
    };

    for (const n of visible) {
      const rks = getKeys(n, rowRef);
      const cks = getKeys(n, colRef);
      for (const rk of rks) {
        push(rowNodes, rk, n);
        let cells = grid.get(rk);
        if (!cells) {
          cells = new Map<string, KnowledgePoint[]>();
          grid.set(rk, cells);
        }
        for (const ck of cks) push(cells, ck, n);
      }
      for (const ck of cks) push(colNodes, ck, n);
    }
    return { rowNodes, colNodes, grid };
  }, [visible, rowRef, colRef]);

  const cols = useMemo(() => orderKeys([...matrix.colNodes.keys()], colRef, project), [matrix, colRef, project]);

  const rows = useMemo(() => {
    const entries = [...matrix.rowNodes.entries()];
    entries.sort((a, b) => {
      // '—'（无该维度值）始终排在最后
      const na = a[0] === NONE_KEY ? 1 : 0;
      const nb = b[0] === NONE_KEY ? 1 : 0;
      if (na !== nb) return na - nb;
      if (activeColSort) {
        const ca = matrix.grid.get(a[0])?.get(activeColSort.key)?.length ?? 0;
        const cb = matrix.grid.get(b[0])?.get(activeColSort.key)?.length ?? 0;
        if (ca !== cb) return activeColSort.dir === 'asc' ? ca - cb : cb - ca;
      }
      if (sortBy === 'alpha') {
        return labelOf(rowRef, a[0], rowValueMap, idx).localeCompare(labelOf(rowRef, b[0], rowValueMap, idx), 'zh');
      }
      if (sortBy === 'count') return b[1].length - a[1].length;
      return avgDiff(b[1]) - avgDiff(a[1]);
    });
    return entries;
  }, [matrix, activeColSort, sortBy, rowRef, rowValueMap, idx]);

  const densityMax = useMemo(() => {
    let m = 1;
    for (const cells of matrix.grid.values()) {
      for (const nodes of cells.values()) m = Math.max(m, nodes.length);
    }
    return m;
  }, [matrix]);

  const cellBg = (count: number, nodes: KnowledgePoint[]): string => {
    if (colorKey === 'none' || count === 0) return '#ffffff';
    if (colorKey === 'density') {
      const t = Math.min(1, count / densityMax);
      return `rgba(49, 69, 128, ${(0.03 + t * 0.15).toFixed(3)})`;
    }
    if (colorKey === 'difficulty') {
      const lv = Math.min(4, Math.max(1, Math.round(avgDiff(nodes))));
      return (
        ['', 'rgba(34, 181, 115, 0.10)', 'rgba(59, 130, 246, 0.10)', 'rgba(245, 158, 11, 0.12)', 'rgba(225, 29, 99, 0.12)'][lv] ??
        '#ffffff'
      );
    }
    const imp = nodes.reduce((s, n) => s + n.importance, 0) / Math.max(1, nodes.length);
    return `rgba(139, 92, 246, ${(0.03 + (imp / 100) * 0.15).toFixed(3)})`;
  };

  const collapseKey = (rk: string) => `${rowRef.id}\u0000${rk}`;

  const toggleRow = (rk: string) => {
    const k = collapseKey(rk);
    setCollapsed((s) => {
      const next = new Set(s);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  };

  const toggleColSort = (ck: string) => {
    setColSort((cur) => {
      if (!cur || cur.dimId !== colRef.id || cur.key !== ck) return { dimId: colRef.id, key: ck, dir: 'desc' };
      if (cur.dir === 'desc') return { dimId: colRef.id, key: ck, dir: 'asc' };
      return null;
    });
  };

  const exportPng = () => {
    const el = document.getElementById('matrix-table');
    if (!el) return;
    downloadPngFromElement(el, `${project.name}-知识多维矩阵.png`);
  };

  return (
    <div className="view mxv-view">
      <div className="view-toolbar mxv-toolbar">
        <div className="mxv-controls">
          <span className="mxv-label">行:</span>
          <select
            className="select mxv-select"
            value={rowRef.id}
            aria-label="行维度"
            onChange={(e) => setRowId(e.target.value)}
          >
            {rowDims.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>

          <span className="mxv-label">列:</span>
          <select
            className="select mxv-select"
            value={colRef.id}
            aria-label="列维度"
            onChange={(e) => {
              setColId(e.target.value);
              setColSort(null);
            }}
          >
            {colDims.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>

          <span className="mxv-label">着色:</span>
          <select
            className="select mxv-select"
            value={colorKey}
            aria-label="着色方式"
            onChange={(e) => setColorKey(e.target.value as ColorKey)}
          >
            {COLOR_OPTS.map((o) => (
              <option key={o.k} value={o.k}>{o.label}</option>
            ))}
          </select>

          <span className="mxv-label">排序:</span>
          <select
            className="select mxv-select"
            value={sortBy}
            aria-label="排序方式"
            onChange={(e) => {
              setSortBy(e.target.value as SortKey);
              setColSort(null);
            }}
          >
            {SORT_OPTS.map((o) => (
              <option key={o.k} value={o.k}>{o.label}</option>
            ))}
          </select>
        </div>

        <div className="mxv-right">
          <button type="button" className="btn-text mxv-export" onClick={exportPng}>
            <IconDownload size={14} /> 导出图片
          </button>
        </div>
      </div>

      <div className="mxv-scroll">
        {rows.length === 0 ? (
          <div className="mxv-none">当前条件下没有可展示的节点</div>
        ) : (
          <table className="mxv-table" id="matrix-table">
            <thead>
              <tr>
                <th className="mxv-corner" scope="col">
                  <span className="mxv-corner-dim">{rowRef.name}</span>
                  <span className="mxv-corner-sep">\</span>
                  <span className="mxv-corner-dim">{colRef.name}</span>
                </th>
                {cols.map((ck, ci) => {
                  const colLabel = labelOf(colRef, ck, colValueMap, idx);
                  const colCount = matrix.colNodes.get(ck)?.length ?? 0;
                  const sorted = activeColSort?.key === ck ? activeColSort.dir : null;
                  return (
                    <th key={ck} className="mxv-colhead" scope="col">
                      <button
                        type="button"
                        className="mxv-colhead-btn"
                        onClick={() => toggleColSort(ck)}
                        title={
                          sorted === 'desc'
                            ? '当前按该列节点数降序，点击改为升序'
                            : sorted === 'asc'
                              ? '当前按该列节点数升序，点击恢复默认排序'
                              : '点击按该列节点数排序'
                        }
                      >
                        <span
                          className="mxv-dot"
                          style={{ background: dotColorOf(colRef, ck, colValueMap, idx, ci) }}
                        />
                        <span className="mxv-colhead-name" title={colLabel}>
                          {colLabel}
                        </span>
                        <span className="mxv-count">{colCount}</span>
                        {sorted && <span className="mxv-caret-sort">{sorted === 'desc' ? '▾' : '▴'}</span>}
                      </button>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {rows.map(([rk, rNodes], ri) => {
                const isCollapsed = collapsed.has(collapseKey(rk));
                const rowLabel = labelOf(rowRef, rk, rowValueMap, idx);
                return (
                  <tr key={rk} className={isCollapsed ? 'mxv-row is-collapsed' : 'mxv-row'}>
                    <th
                      scope="row"
                      className="mxv-rowhead"
                      onClick={() => toggleRow(rk)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          toggleRow(rk);
                        }
                      }}
                      tabIndex={0}
                      role="button"
                      aria-expanded={!isCollapsed}
                    >
                      <span className="mxv-row-inner">
                        <span
                          className="mxv-rowbar"
                          style={{ background: rowBarColorOf(rowRef, rk, rowValueMap, idx, ri) }}
                        />
                        <span className="mxv-rowlabel">
                          <span className="mxv-rowname" title={rowLabel}>{rowLabel}</span>
                          <span className="mxv-rowcount">{rNodes.length}</span>
                        </span>
                        <span className={isCollapsed ? 'mxv-caret is-collapsed' : 'mxv-caret'} aria-hidden>
                          ▾
                        </span>
                      </span>
                    </th>

                    {isCollapsed ? (
                      <td className="mxv-collapsed" colSpan={cols.length}>
                        已折叠 {rNodes.length} 个节点，点击行标题展开
                      </td>
                    ) : (
                      cols.map((ck) => {
                        const nodes = matrix.grid.get(rk)?.get(ck) ?? [];
                        return (
                          <td key={ck} className="mxv-cell" style={{ background: cellBg(nodes.length, nodes) }}>
                            {nodes.length === 0 ? (
                              <div className="mxv-empty">0 节点 · 均难 —</div>
                            ) : (
                              <div className="mxv-cellbody">
                                <div className="mxv-chips">
                                  {nodes.slice(0, MAX_CHIPS).map((n) => {
                                    const pass = nodePasses(n, filter);
                                    const branchColor = idx.branchById.get(n.branch)?.color ?? BRANCH_FALLBACK;
                                    return (
                                      <button
                                        key={n.id}
                                        type="button"
                                        className={`mxv-chip${selectedId === n.id ? ' sel' : ''}${pass ? '' : ' dim'}`}
                                        onClick={() => {
                                          if (pass) onSelect(n.id);
                                        }}
                                        tabIndex={pass ? 0 : -1}
                                        aria-disabled={!pass}
                                        aria-pressed={selectedId === n.id}
                                        title={n.definition || n.name}
                                      >
                                        <span className="mxv-chip-dot" style={{ background: branchColor }} />
                                        <span className="mxv-chip-name">{n.name}</span>
                                        <span className="mxv-chip-stars" aria-hidden>
                                          {'★'.repeat(Math.max(0, Math.min(4, n.difficulty)))}
                                        </span>
                                      </button>
                                    );
                                  })}
                                  {nodes.length > MAX_CHIPS && (
                                    <span className="mxv-more">… 还有 {nodes.length - MAX_CHIPS} 个</span>
                                  )}
                                </div>
                                <div className="mxv-meta">
                                  {nodes.length} 节点 · 均难 {avgDiff(nodes).toFixed(1)}
                                </div>
                              </div>
                            )}
                          </td>
                        );
                      })
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
