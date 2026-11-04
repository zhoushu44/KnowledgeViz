import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from '../store/router';
import { useProjects } from '../store/projects';
import { indexProject, type Project, type KnowledgePoint } from '../lib/types';
import {
  IconChevronLeft, IconChevronRight, IconChevronDown, IconSearch, IconMindmap,
  IconGrid, IconGraph, IconRoute, IconRefresh, IconSettings, IconTag, IconSparkle,
} from '../components/Icons';
import MindMapView from '../views/MindMapView';
import MatrixView from '../views/MatrixView';
import GraphView from '../views/GraphView';
import RouteView from '../views/RouteView';
import TreeNav from '../components/TreeNav';
import DimensionFilter, { type FilterState, emptyFilter } from '../components/DimensionFilter';
import NodeDetail from '../components/NodeDetail';
import ProjectSettingsModal from '../components/ProjectSettingsModal';
import GlobalSearch from '../components/GlobalSearch';
import { readLastOpen, writeLastOpen } from '../store/projects';

export type ViewKey = 'mindmap' | 'matrix' | 'graph' | 'route';

/** 从 URL query 读回筛选（f=dim:value,dim:value & d=1-4） */
function readFilterFromHash(): FilterState {
  try {
    const h = window.location.hash.replace(/^#/, '');
    const [, query] = h.split('?');
    const params = new URLSearchParams(query ?? '');
    const values: Record<string, string[]> = {};
    for (const token of (params.get('f') ?? '').split(',').filter(Boolean)) {
      const [dim, val] = token.split(':');
      if (!dim || !val) continue;
      (values[dim] ??= []).push(val);
    }
    const [lo, hi] = (params.get('d') ?? '1-4').split('-').map((x) => Number(x));
    return {
      values,
      difficulty: [Number.isFinite(lo) ? lo : 1, Number.isFinite(hi) ? hi : 4],
    };
  } catch {
    return emptyFilter;
  }
}

function serializeFilter(f: FilterState): string {
  const params = new URLSearchParams();
  const tokens = Object.entries(f.values).flatMap(([dim, vals]) => vals.map((v) => `${dim}:${v}`));
  if (tokens.length) params.set('f', tokens.join(','));
  if (f.difficulty[0] !== 1 || f.difficulty[1] !== 4) params.set('d', `${f.difficulty[0]}-${f.difficulty[1]}`);
  return params.toString();
}

const VIEWS: { key: ViewKey; label: string; icon: (p: any) => JSX.Element; statusLabel: string }[] = [
  { key: 'mindmap', label: '思维导图', icon: IconMindmap, statusLabel: '思维导图' },
  { key: 'matrix', label: '矩阵', icon: IconGrid, statusLabel: '知识多维矩阵' },
  { key: 'graph', label: '图谱', icon: IconGraph, statusLabel: '知识网络图' },
  { key: 'route', label: '学习路线', icon: IconRoute, statusLabel: '学习路线图' },
];

export default function WorkspacePage({ projectId }: { projectId: string }) {
  // 切换项目时强制重挂载，避免沿用上一个项目的视图/选中状态
  return <WorkspaceInner key={projectId} projectId={projectId} />;
}

function WorkspaceInner({ projectId }: { projectId: string }) {
  const { back } = useRouter();
  const { getProject, updateNode, addNodes, upsertRoute } = useProjects();
  const project = getProject(projectId);

  const [view, setView] = useState<ViewKey>(() => {
    const last = readLastOpen();
    return last && last.projectId === projectId ? last.view : 'mindmap';
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(true);
  const [q, setQ] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [filter, setFilter] = useState<FilterState>(() => readFilterFromHash());

  // 筛选状态写进 URL query，刷新/分享后可恢复（PRD 4.6）
  useEffect(() => {
    const h = window.location.hash.replace(/^#/, '');
    const [path] = h.split('?');
    const qs = serializeFilter(filter);
    const next = qs ? `#${path}?${qs}` : `#${path}`;
    if (window.location.hash !== next) {
      window.history.replaceState(null, '', next);
    }
  }, [filter]);
  const [routeId, setRouteId] = useState<string>('');
  const [renderCount, setRenderCount] = useState({ nodes: 0, edges: 0 });
  const [searchOpen, setSearchOpen] = useState(false);
  const [layoutNonce, setLayoutNonce] = useState(0);

  const idx = useMemo(() => (project ? indexProject(project) : null), [project]);

  useEffect(() => {
    if (project && project.routes.length && !routeId) setRouteId(project.routes[0].id);
  }, [project, routeId]);

  useEffect(() => {
    const order: ViewKey[] = ['mindmap', 'matrix', 'graph', 'route'];
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen(true);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        setSearchOpen(true);
        return;
      }
      if (e.key === 'Escape') {
        if (searchOpen) setSearchOpen(false);
        else if (settingsOpen) setSettingsOpen(false);
        else if (detailOpen) setDetailOpen(false);
        return;
      }
      if (typing) return;
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        const i = order.indexOf(view);
        const next = order[(i + (e.key === 'ArrowRight' ? 1 : order.length - 1)) % order.length];
        setView(next);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [detailOpen, settingsOpen, searchOpen, view]);

  // 原生菜单 View → 切视图
  useEffect(() => {
    const onView = (e: Event) => {
      const v = (e as CustomEvent).detail as ViewKey;
      if (view === v || !v) return;
      setView(v);
    };
    window.addEventListener('ksb:view', onView);
    return () => window.removeEventListener('ksb:view', onView);
  }, [view]);

  // 记住上次打开的项目与视图（PRD 10.4）
  useEffect(() => {
    writeLastOpen({ projectId, view });
  }, [projectId, view]);

  if (!project || !idx) {
    return (
      <div className="ws-missing">
        <div>项目不存在或已被删除</div>
        <button className="btn btn-primary" onClick={back}>返回项目列表</button>
      </div>
    );
  }

  const selected = selectedId ? idx.byId.get(selectedId) ?? null : null;
  const path = selected ? idx.pathOf(selected.id) : [];
  const curView = VIEWS.find((v) => v.key === view)!;

  const selectNode = (id: string | null) => {
    setSelectedId(id);
    if (id) setDetailOpen(true);
  };

  const common = {
    project,
    idx,
    selectedId,
    onSelect: selectNode,
    filter,
    query: q,
    onCount: setRenderCount,
  };

  return (
    <div className="ws">
      {/* ---------- 顶栏 ---------- */}
      <header className="ws-top">
        <div className="ws-top-left">
          <button className="ws-back" onClick={back} title="返回"><IconChevronLeft size={18} /></button>
          <div className="ws-proj-icon"><IconSparkle size={15} /></div>
          <span className="ws-proj-name" title={project.name}>{project.name}</span>
        </div>

        <nav className="seg ws-tabs">
          {VIEWS.map((v) => (
            <button
              key={v.key}
              className={`seg-item${view === v.key ? ' active' : ''}`}
              onClick={() => setView(v.key)}
            >
              <v.icon size={15} />
              {v.label}
            </button>
          ))}
        </nav>

        <div className="ws-top-right">
          <div className="ws-search">
            <IconSearch size={14} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索知识点" />
          </div>
          <button
            className="ws-iconbtn"
            title="重新布局（重置缩放与力导向）"
            onClick={() => { setSelectedId(null); setLayoutNonce((n) => n + 1); }}
          >
            <IconRefresh size={16} />
          </button>
          <button className="ws-iconbtn" title="项目设置" onClick={() => setSettingsOpen(true)}><IconSettings size={16} /></button>
        </div>
      </header>

      {/* ---------- 主体三栏 ---------- */}
      <div className="ws-body">
        <aside className="ws-left">
          <TreeNav
            project={project}
            idx={idx}
            selectedId={selectedId}
            onSelect={selectNode}
            query={q}
          />
          <DimensionFilter project={project} value={filter} onChange={setFilter} />
          <RouteList
            project={project}
            activeId={routeId}
            onPick={(id) => { setRouteId(id); setView('route'); }}
          />
        </aside>

        <main className="ws-main" key={`${view}-${layoutNonce}`}>
          {view === 'mindmap' && <MindMapView {...common} />}
          {view === 'matrix' && <MatrixView {...common} />}
          {view === 'graph' && <GraphView {...common} />}
          {view === 'route' && (
            <RouteView
              {...common}
              routeId={routeId}
              onRouteChange={setRouteId}
              onSaveRoute={(r) => upsertRoute(project.id, r)}
            />
          )}
        </main>

        {detailOpen && (
          <aside className="ws-right">
            {selected ? (
              <NodeDetail
                project={project}
                idx={idx}
                node={selected}
                onClose={() => setDetailOpen(false)}
                onSelect={selectNode}
                onUpdate={(patch) => updateNode(project.id, selected.id, patch)}
                onAddNodes={(nodes) =>
                  addNodes(
                    project.id,
                    nodes,
                    nodes
                      .filter((n) => n.parent)
                      .map((n) => ({ from: n.parent!, to: n.id, type: 'contains' as const }))
                  )
                }
              />
            ) : (
              <div className="detail-empty">
                <div className="detail-empty-ico"><IconTag size={22} /></div>
                <div>在图中点击任意节点查看详情</div>
                <button className="btn-text" onClick={() => setDetailOpen(false)}>关闭面板</button>
              </div>
            )}
          </aside>
        )}
      </div>

      {/* ---------- 状态栏 ---------- */}
      <footer className="ws-status">
        <span className="ws-status-focus" title={path.map((p) => p.name).join(' › ')}>
          焦点: {selected ? `${selected.name}${path.length > 1 ? ' — ' + path.map((p) => p.name).join(' › ') : ''}` : '—'}
        </span>
        <span className="ws-status-right">
          <span>视图: {curView.statusLabel}</span>
          <span>节点: {renderCount.nodes || project.stats.nodes}</span>
          <span>边: {renderCount.edges || project.stats.edges}</span>
          <span>路线: {project.routes.find((r: { id: string; name: string }) => r.id === routeId)?.name ?? '—'}</span>
          <span className="ws-status-dot" /> 项目
        </span>
      </footer>

      {searchOpen && (
        <GlobalSearch
          project={project}
          idx={idx}
          onClose={() => setSearchOpen(false)}
          onPick={(id) => {
            selectNode(id);
            setSearchOpen(false);
          }}
        />
      )}

      {settingsOpen && <ProjectSettingsModal project={project} onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}

function RouteList({
  project, activeId, onPick,
}: {
  project: Project; activeId: string; onPick: (id: string) => void;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div className="sect">
      <button className="sect-head" onClick={() => setOpen((o) => !o)}>
        <span className="sect-title"><IconRoute size={14} /> 学习路线</span>
        {open ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
      </button>
      {open && (
        <div className="route-list">
          {project.routes.map((r) => (
            <button
              key={r.id}
              className={`route-item${activeId === r.id ? ' active' : ''}`}
              onClick={() => onPick(r.id)}
            >
              <span className={`route-dot${activeId === r.id ? ' active' : ''}`} />
              <span className="route-body">
                <span className="route-name">{r.name}</span>
                <span className="route-meta">{r.level} · {r.nodeCount} 节点</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

