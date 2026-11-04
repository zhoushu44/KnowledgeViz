import { useState } from 'react';
import type { Project, Dimension } from '../lib/types';
import { IconChevronDown, IconChevronRight, IconFilter } from './Icons';

export interface FilterState {
  /** dimensionId -> 选中的 valueId 集合 */
  values: Record<string, string[]>;
  difficulty: [number, number];
}

export const emptyFilter: FilterState = { values: {}, difficulty: [1, 4] };

export function isFilterActive(f: FilterState) {
  return Object.values(f.values).some((v) => v.length > 0) || f.difficulty[0] !== 1 || f.difficulty[1] !== 4;
}

export default function DimensionFilter({
  project, value, onChange,
}: {
  project: Project;
  value: FilterState;
  onChange: (f: FilterState) => void;
}) {
  const [open, setOpen] = useState(true);
  const dims = project.dimensions.filter((d) => d.role === 'filter');
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  const toggleGroup = (id: string) =>
    setCollapsedGroups((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  const toggleValue = (dim: Dimension, vid: string) => {
    const cur = value.values[dim.id] ?? [];
    const next = cur.includes(vid) ? cur.filter((x) => x !== vid) : [...cur, vid];
    onChange({ ...value, values: { ...value.values, [dim.id]: next } });
  };

  const selectAll = (dim: Dimension) => {
    const all = dim.values.map((v) => v.id);
    const cur = value.values[dim.id] ?? [];
    onChange({ ...value, values: { ...value.values, [dim.id]: cur.length === all.length ? [] : all } });
  };

  const reset = () => onChange(emptyFilter);

  const active = isFilterActive(value);
  const total = Object.values(value.values).reduce((s, v) => s + v.length, 0);

  return (
    <div className="sect">
      <button className="sect-head" onClick={() => setOpen((o) => !o)}>
        <span className="sect-title"><IconFilter size={14} /> 维度筛选</span>
        <span className="sect-head-right">
          {active && <span className="filter-badge">{total + (value.difficulty[0] > 1 || value.difficulty[1] < 4 ? 1 : 0)}</span>}
          {open ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
        </span>
      </button>

      {open && (
        <div className="filter-body">
          {dims.map((dim) => {
            const isCollapsed = collapsedGroups.has(dim.id);
            const selected = value.values[dim.id] ?? [];
            return (
              <div key={dim.id} className="filter-group">
                <div className="filter-group-head">
                  <button className="filter-group-toggle" onClick={() => toggleGroup(dim.id)}>
                    {isCollapsed ? <IconChevronRight size={11} /> : <IconChevronDown size={11} />}
                    {dim.name}
                  </button>
                  <button className="filter-all" onClick={() => selectAll(dim)}>
                    {selected.length === dim.values.length ? '取消全选' : '全选'}
                  </button>
                </div>
                {!isCollapsed && (
                  <div className="filter-values">
                    {dim.values.map((v) => {
                      const on = selected.includes(v.id);
                      return (
                        <label
                          key={v.id}
                          className={`filter-value${on ? ' on' : ''}`}
                          onClick={(e) => { e.preventDefault(); toggleValue(dim, v.id); }}
                        >
                          <input
                            type="checkbox"
                            className="filter-native"
                            checked={on}
                            onChange={() => toggleValue(dim, v.id)}
                            tabIndex={-1}
                          />
                          <span className={`cbox${on ? ' on' : ''}`}>
                            {on && (
                              <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M4 12.5l5 5L20 6.5" />
                              </svg>
                            )}
                          </span>
                          {v.color && <span className="filter-dot" style={{ background: v.color }} />}
                          <span className="filter-label">{v.name}</span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}

          <div className="filter-group">
            <div className="filter-group-head">
              <span className="filter-group-toggle" style={{ cursor: 'default' }}>难度范围</span>
              <span className="filter-range-label">{value.difficulty[0]} – {value.difficulty[1]}</span>
            </div>
            <div className="filter-range">
              <input
                type="range" min={1} max={4} step={1} value={value.difficulty[0]}
                onChange={(e) => {
                  const lo = Math.min(+e.target.value, value.difficulty[1]);
                  onChange({ ...value, difficulty: [lo, value.difficulty[1]] });
                }}
              />
              <input
                type="range" min={1} max={4} step={1} value={value.difficulty[1]}
                onChange={(e) => {
                  const hi = Math.max(+e.target.value, value.difficulty[0]);
                  onChange({ ...value, difficulty: [value.difficulty[0], hi] });
                }}
              />
            </div>
          </div>

          {active && (
            <button className="filter-reset" onClick={reset}>重置筛选</button>
          )}
        </div>
      )}
    </div>
  );
}

/** 根据筛选条件判断节点是否可见 */
export function nodePasses(
  n: { id: string; dimensions: Record<string, string | string[]>; difficulty: number; branch: string },
  f: FilterState
): boolean {
  if (n.difficulty < f.difficulty[0] || n.difficulty > f.difficulty[1]) return false;
  for (const [dimId, selected] of Object.entries(f.values)) {
    if (!selected.length) continue;
    if (dimId === 'dim_field') {
      if (!selected.includes(n.branch)) return false;
      continue;
    }
    const raw = n.dimensions[dimId];
    const vals = Array.isArray(raw) ? raw : raw ? [raw] : [];
    if (!vals.some((v) => selected.includes(v))) return false;
  }
  return true;
}
