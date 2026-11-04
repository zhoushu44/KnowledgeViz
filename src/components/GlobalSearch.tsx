import { useEffect, useMemo, useRef, useState } from 'react';
import type { KnowledgePoint, Project, ProjectIndex } from '../lib/types';
import { IconSearch, IconClose } from './Icons';

interface Props {
  project: Project;
  idx: ProjectIndex;
  onPick: (id: string) => void;
  onClose: () => void;
}

/** Ctrl/Cmd + K 全局搜索浮层：按名称 / 英文名 / 定义 / 描述模糊匹配 */
export default function GlobalSearch({ project, idx, onPick, onClose }: Props) {
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const hits = useMemo(() => {
    const kw = q.trim().toLowerCase();
    if (!kw) {
      return project.nodes
        .filter((n) => n.level !== 'L4')
        .slice(0, 8)
        .map((n) => ({ node: n, score: 0 }));
    }
    const scored: { node: KnowledgePoint; score: number }[] = [];
    for (const n of project.nodes) {
      if (n.level === 'root') continue;
      const name = n.name.toLowerCase();
      const en = (n.nameEn ?? '').toLowerCase();
      const def = n.definition.toLowerCase();
      const desc = n.description.toLowerCase();
      let score = 0;
      if (name === kw) score = 100;
      else if (name.startsWith(kw)) score = 80;
      else if (name.includes(kw)) score = 60;
      else if (en.includes(kw)) score = 40;
      else if (def.includes(kw)) score = 25;
      else if (desc.includes(kw)) score = 15;
      if (score) scored.push({ node: n, score: score + n.importance / 100 });
    }
    scored.sort((a, b) => b.score - a.score || b.node.importance - a.node.importance);
    return scored.slice(0, 12);
  }, [q, project]);

  useEffect(() => {
    setActive(0);
  }, [q]);

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>('.gsearch-item.active');
    el?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(hits.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const hit = hits[active];
      if (hit) onPick(hit.node.id);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div className="gsearch-mask" onClick={onClose}>
      <div className="gsearch" onClick={(e) => e.stopPropagation()}>
        <div className="gsearch-head">
          <IconSearch size={15} />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKey}
            placeholder="搜索知识点：名称、英文名、定义…"
          />
          <span className="gsearch-hint">↑↓ 选择 · ↵ 定位 · Esc 关闭</span>
          <button className="modal-x" onClick={onClose}><IconClose size={15} /></button>
        </div>

        <div className="gsearch-list" ref={listRef}>
          {hits.length === 0 && <div className="gsearch-empty">没有匹配「{q}」的知识点</div>}
          {hits.map(({ node }, i) => {
            const b = idx.branchById.get(node.branch);
            const path = idx.pathOf(node.id).slice(1, -1).map((p) => p.name);
            return (
              <button
                key={node.id}
                className={`gsearch-item${i === active ? ' active' : ''}`}
                onMouseEnter={() => setActive(i)}
                onClick={() => onPick(node.id)}
              >
                <span className="gsearch-dot" style={{ background: b?.color ?? '#64748B' }} />
                <span className="gsearch-body">
                  <span className="gsearch-name">{node.name}</span>
                  {node.nameEn && <span className="gsearch-en">{node.nameEn}</span>}
                  <span className="gsearch-path">
                    {b?.name}
                    {path.length ? ` › ${path.join(' › ')}` : ''}
                  </span>
                </span>
                <span className="gsearch-level">{node.level}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
