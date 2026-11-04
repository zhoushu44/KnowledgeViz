import { useEffect, useMemo, useRef, useState } from 'react';
import type { Project, ProjectIndex } from '../lib/types';
import { IconSearch, IconChevronDown, IconChevronRight, IconClose } from './Icons';

interface Props {
  project: Project;
  idx: ProjectIndex;
  selectedId: string | null;
  onSelect: (id: string) => void;
  query: string;
}

export default function TreeNav({ project, idx, selectedId, onSelect, query }: Props) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [localQ, setLocalQ] = useState('');
  const [open, setOpen] = useState(true);
  const bodyRef = useRef<HTMLDivElement>(null);

  const q = (localQ || query).trim().toLowerCase();

  const matched = useMemo(() => {
    if (!q) return null;
    const set = new Set<string>();
    for (const n of project.nodes) {
      if (n.name.toLowerCase().includes(q) || (n.nameEn ?? '').toLowerCase().includes(q)) {
        set.add(n.id);
        for (const p of idx.pathOf(n.id)) set.add(p.id);
      }
    }
    return set;
  }, [q, project, idx]);

  const toggle = (id: string) => {
    setCollapsed((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // 视图里选中节点后，树自动展开祖先链并滚动到可见（PRD 4.5 联动）
  useEffect(() => {
    if (!selectedId) return;
    const chain = idx.pathOf(selectedId).map((n) => n.id);
    setCollapsed((prev) => {
      const next = new Set(prev);
      for (const id of chain.slice(0, -1)) next.delete(id);
      return next;
    });
    const t = window.setTimeout(() => {
      const el = bodyRef.current?.querySelector<HTMLElement>(`[data-tree-id="${selectedId}"]`);
      el?.scrollIntoView({ block: 'nearest' });
    }, 60);
    return () => window.clearTimeout(t);
  }, [selectedId, idx]);

  const countOf = (id: string) => (idx.children.get(id) ?? []).length;

  const renderRow = (node: { id: string; name: string; level: string }, depth: number) => {
    const kids = idx.children.get(node.id) ?? [];
    const hasKids = kids.length > 0;
    const isCollapsed = collapsed.has(node.id);
    const isSel = selectedId === node.id;
    const dim = matched ? !matched.has(node.id) : false;

    return (
      <div key={node.id}>
        <div
          data-tree-id={node.id}
          className={`tree-row depth-${depth}${isSel ? ' sel' : ''}${dim ? ' dim' : ''}`}
          style={{ paddingLeft: 10 + depth * 13 }}
          onClick={() => onSelect(node.id)}
        >
          <span
            className={`tree-arrow${hasKids ? '' : ' leaf'}`}
            onClick={(e) => { e.stopPropagation(); if (hasKids) toggle(node.id); }}
          >
            {hasKids ? (isCollapsed ? <IconChevronRight size={12} /> : <IconChevronDown size={12} />) : null}
          </span>
          <span className="tree-label" title={node.name}>{node.name}</span>
          {hasKids && <span className="tree-count">({kids.length})</span>}
        </div>
        {hasKids && !isCollapsed && kids.map((k) => renderRow(k, depth + 1))}
      </div>
    );
  };

  return (
    <div className="sect tree-sect">
      <button className="sect-head" onClick={() => setOpen((o) => !o)}>
        <span className="sect-title">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <rect x="9" y="2.5" width="6" height="5" rx="1" />
            <rect x="9" y="16.5" width="6" height="5" rx="1" />
            <path d="M12 7.5v9M12 12H5.5M12 12h6.5" />
          </svg>
          知识树导航
        </span>
        {open ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
      </button>

      {open && (
        <>
          <div className="tree-search">
            <IconSearch size={13} />
            <input
              value={localQ}
              onChange={(e) => setLocalQ(e.target.value)}
              placeholder="搜索知识点..."
            />
            {localQ && (
              <button className="tree-search-clear" onClick={() => setLocalQ('')}><IconClose size={11} /></button>
            )}
          </div>
          <div className="tree-body" ref={bodyRef}>
            {project.nodes
              .filter((n) => !n.parent)
              .map((n) => renderRow(n, 0))}
          </div>
          {matched && matched.size === 0 && (
            <div className="tree-none">没有匹配「{q}」的知识点</div>
          )}
        </>
      )}
    </div>
  );
}
