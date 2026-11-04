import { useMemo, useState } from 'react';
import { useProjects } from '../store/projects';
import { useRouter } from '../store/router';
import { CATEGORY_STYLE, type Project } from '../lib/types';
import {
  ICON_BY_NAME, IconUpload, IconPlus, IconChevronRight, IconCalendar,
  IconEdit, IconTrash, IconFolder, IconClose, IconSparkle, IconCheck, IconBook, IconSettings, IconSearch, IconDownload,
} from '../components/Icons';
import ImportModal from '../components/ImportModal';
import ProjectSettingsModal from '../components/ProjectSettingsModal';
import ObsidianExportModal from '../components/ObsidianExportModal';

function fmtDate(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

function ProjectCard({
  p, onEnter, onEdit, onDelete, onExport,
}: {
  p: Project; onEnter: () => void; onEdit: () => void; onDelete: () => void; onExport: () => void;
}) {
  const [hover, setHover] = useState(false);
  const st = CATEGORY_STYLE[p.category] ?? CATEGORY_STYLE['通用知识'];
  const Icon = ICON_BY_NAME[st.icon] ?? IconBook;

  return (
    <div
      className="pcard"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={onEnter}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onEnter()}
    >
      <div className="pcard-head">
        <div className="pcard-icon" style={{ background: st.bg, color: st.color }}>
          <Icon size={24} />
        </div>
        <div className="pcard-title-wrap">
          <div className="pcard-title" title={p.name}>{p.name}</div>
        </div>
        {hover && (
          <div className="pcard-actions" onClick={(e) => e.stopPropagation()}>
            <button className="pcard-act" title="导出到 Obsidian" onClick={onExport}><IconDownload size={14} /></button>
            <button className="pcard-act" title="编辑" onClick={onEdit}><IconEdit size={14} /></button>
            <button className="pcard-act danger" title="删除" onClick={onDelete}><IconTrash size={14} /></button>
          </div>
        )}
      </div>

      <p className="pcard-desc">{p.description}</p>

      <div className="pcard-foot">
        <span className="tag" style={{ color: st.color, background: st.bg }}>{p.category}</span>
        <span className="pcard-date">
          <IconCalendar size={11} />
          {fmtDate(p.updatedAt)}
        </span>
        <span className="pcard-enter">进入 <IconChevronRight size={12} /></span>
      </div>
    </div>
  );
}

export default function HomePage({ onOpenModelSettings }: { onOpenModelSettings?: () => void }) {
  const { projects, removeProject } = useProjects();
  const { push } = useRouter();
  const [importOpen, setImportOpen] = useState(false);
  const [settingsFor, setSettingsFor] = useState<Project | null>(null);
  const [exportFor, setExportFor] = useState<Project | null>(null);
  const [confirmDel, setConfirmDel] = useState<Project | null>(null);
  const [query, setQuery] = useState('');
  const [filterCat, setFilterCat] = useState<'全部' | Project['category']>('全部');

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return [...projects]
      .filter((p) => (filterCat === '全部' ? true : p.category === filterCat))
      .filter((p) => (q ? p.name.toLowerCase().includes(q) || p.description.toLowerCase().includes(q) : true))
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }, [projects, query, filterCat]);

  return (
    <div className="home">
      <div className="brandbar">
        <div className="brandbar-left">
          <BrandMark />
          <span className="brandbar-title">知识体系可视化平台</span>
        </div>
      </div>

      <div className="home-body">
        <div className="home-head">
          <h1 className="home-title">我的项目</h1>
          <div className="home-actions">
            {onOpenModelSettings && (
              <button className="btn btn-ghost" onClick={onOpenModelSettings} title="内置大模型设置">
                <IconSettings size={15} /> 模型设置
              </button>
            )}
            <button className="btn btn-ghost" onClick={() => push({ name: 'research' })} title="联网深入研究 / 事实核查">
              <IconSearch size={15} /> 联网调研
            </button>
            <button className="btn btn-ghost" onClick={() => setImportOpen(true)}>
              <IconUpload size={15} /> 导入YAML
            </button>
            <button className="btn btn-primary" onClick={() => push({ name: 'create' })}>
              <IconPlus size={15} /> 新建项目
            </button>
          </div>
        </div>

        {list.length === 0 ? (
          <div className="home-empty">
            <div className="home-empty-icon"><IconFolder size={40} /></div>
            <div className="home-empty-title">
              {projects.length === 0 ? '还没有知识体系，从新建一个开始吧' : '没有匹配的项目'}
            </div>
            <div className="home-empty-sub">
              {projects.length === 0
                ? '输入一个领域名称，AI 会为你生成完整的知识体系'
                : '换个关键词或分类试试'}
            </div>
            {projects.length === 0 && (
              <button className="btn btn-primary" onClick={() => push({ name: 'create' })}>
                <IconPlus size={15} /> 新建项目
              </button>
            )}
          </div>
        ) : (
          <div className="home-grid">
            {list.map((p) => (
              <ProjectCard
                key={p.id}
                p={p}
                onEnter={() => push({ name: 'workspace', projectId: p.id })}
                onEdit={() => setSettingsFor(p)}
                onDelete={() => setConfirmDel(p)}
                onExport={() => setExportFor(p)}
              />
            ))}
          </div>
        )}

        <div className="home-footnote">
          共 {projects.length} 个知识体系 · KSB-YAML v1.0
        </div>
      </div>

      {importOpen && <ImportModal onClose={() => setImportOpen(false)} />}
      {settingsFor && <ProjectSettingsModal project={settingsFor} onClose={() => setSettingsFor(null)} />}
      {exportFor && <ObsidianExportModal project={exportFor} onClose={() => setExportFor(null)} />}
      {confirmDel && (
        <div className="modal-mask" onClick={() => setConfirmDel(null)}>
          <div className="modal" style={{ width: 420 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <span>删除项目</span>
              <button className="modal-x" onClick={() => setConfirmDel(null)}><IconClose size={16} /></button>
            </div>
            <div className="modal-body">
              <p style={{ margin: 0, color: 'var(--text-2)', lineHeight: 1.7 }}>
                删除后不可恢复，确定删除《{confirmDel.name}》？
              </p>
            </div>
            <div className="modal-foot">
              <button className="btn btn-ghost" onClick={() => setConfirmDel(null)}>取消</button>
              <button
                className="btn"
                style={{ background: 'var(--danger)', color: '#fff' }}
                onClick={() => { removeProject(confirmDel.id); setConfirmDel(null); }}
              >
                删除
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function BrandMark({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 5.5A1.5 1.5 0 014.5 4H9a2 2 0 012 2v13" />
      <path d="M21 5.5A1.5 1.5 0 0019.5 4H15a2 2 0 00-2 2v13" />
      <path d="M3 5.5V18a1 1 0 001 1h5M21 5.5V18a1 1 0 01-1 1h-5" />
      <path d="M6 8h3M6 11h3M15 8h3M15 11h3" />
    </svg>
  );
}

