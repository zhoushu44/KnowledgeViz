import { useState } from 'react';
import type { Category, Project } from '../lib/types';
import { useProjects } from '../store/projects';
import { CategoryPicker } from './ImportModal';
import { IconClose, IconDownload, IconTrash, IconFolder, IconBook } from './Icons';
import { serializeProject, downloadText } from '../lib/ksb';
import { desktop } from '../lib/desktop';
import ObsidianExportModal from './ObsidianExportModal';

export default function ProjectSettingsModal({
  project, onClose,
}: {
  project: Project; onClose: () => void;
}) {
  const { updateProject, removeProject } = useProjects();
  const [name, setName] = useState(project.name);
  const [desc, setDesc] = useState(project.description);
  const [cat, setCat] = useState<Category>(project.category);
  const [confirmDel, setConfirmDel] = useState(false);
  const [obsOpen, setObsOpen] = useState(false);

  const save = () => {
    updateProject(project.id, { name: name.trim() || project.name, description: desc, category: cat });
    onClose();
  };

  const exportAll = () => {
    const files = serializeProject(project);
    for (const [name, content] of Object.entries(files)) {
      downloadText(`${project.name}-${name}`, content);
    }
  };

  const saveToDisk = async () => {
    if (!desktop) return;
    await desktop.write(project.id, serializeProject(project));
    await desktop.reveal(project.id);
  };

  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal" style={{ width: 560 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span>项目设置</span>
          <button className="modal-x" onClick={onClose}><IconClose size={16} /></button>
        </div>
        <div className="modal-body">
          <label className="flabel">项目名称</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />

          <label className="flabel" style={{ marginTop: 16 }}>项目描述</label>
          <textarea
            className="input"
            style={{ height: 96, padding: '10px 12px', resize: 'vertical', lineHeight: 1.6 }}
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
          />

          <label className="flabel" style={{ marginTop: 16 }}>知识体系分类</label>
          <CategoryPicker value={cat} onChange={setCat} />

          <div className="settings-stats">
            <div><b>{project.stats.nodes}</b><span>知识点</span></div>
            <div><b>{project.stats.edges}</b><span>关系边</span></div>
            <div><b>{project.stats.branches}</b><span>一级分支</span></div>
            <div><b>{project.routes.length}</b><span>学习路线</span></div>
          </div>

          <div className="settings-obsidian">
            <div className="settings-obsidian-main">
              <div className="settings-obsidian-title"><IconBook size={15} /> Obsidian 知识库</div>
              <p>导出「文章 + 白板 + 双链」的完整文件夹，用 Obsidian 打开即可使用：思维导图转白板、卡片双击进文章。</p>
            </div>
            <button className="btn btn-ghost" onClick={() => setObsOpen(true)}>
              <IconDownload size={15} /> 导出
            </button>
          </div>

          <div className="settings-danger">
            {confirmDel ? (
              <div className="settings-danger-confirm">
                删除后不可恢复，确定删除《{project.name}》？
                <button className="btn" style={{ background: 'var(--danger)', color: '#fff', height: 30 }} onClick={() => { removeProject(project.id); onClose(); }}>删除</button>
                <button className="btn btn-ghost" style={{ height: 30 }} onClick={() => setConfirmDel(false)}>取消</button>
              </div>
            ) : (
              <button className="btn-text" style={{ color: 'var(--danger)' }} onClick={() => setConfirmDel(true)}>
                <IconTrash size={14} /> 删除此项目
              </button>
            )}
          </div>
        </div>
        <div className="modal-foot">
          <button className="btn btn-ghost" style={{ marginRight: 'auto' }} onClick={exportAll}>
            <IconDownload size={15} /> 导出全部 YAML
          </button>
          {desktop && (
            <button className="btn btn-ghost" onClick={() => void saveToDisk()}>
              <IconFolder size={15} /> 保存并打开目录
            </button>
          )}
          <button className="btn btn-ghost" onClick={onClose}>取消</button>
          <button className="btn btn-primary" onClick={save}>保存</button>
        </div>
      </div>

      {obsOpen && <ObsidianExportModal project={project} onClose={() => setObsOpen(false)} />}
    </div>
  );
}
