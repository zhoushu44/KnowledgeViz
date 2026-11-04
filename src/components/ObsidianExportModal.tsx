import { useMemo, useState } from 'react';
import type { Project } from '../lib/types';
import { buildObsidianBundle, zipFiles, type ObsidianBundle } from '../lib/obsidian';
import { desktop } from '../lib/desktop';
import { IconClose, IconDownload, IconFolder, IconCheck, IconBook } from './Icons';

function triggerDownload(url: string, filename: string) {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function fmtBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

export default function ObsidianExportModal({ project, onClose }: { project: Project; onClose: () => void }) {
  const [includeL4, setIncludeL4] = useState(true);
  const [withStyle, setWithStyle] = useState(true);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ path: string; files: number } | null>(null);
  const [err, setErr] = useState('');

  const bundle: ObsidianBundle = useMemo(
    () => buildObsidianBundle(project, { includeL4, withCanvas: true, withStyle }),
    [project, includeL4, withStyle]
  );

  const notes = bundle.files.filter((f) => f.path.endsWith('.md')).length;

  const exportToFolder = async () => {
    setErr('');
    setBusy(true);
    try {
      const api = desktop;
      const writeVault = api?.writeVault;
      if (api && writeVault) {
        const res = await writeVault(bundle.folder, bundle.files);
        setDone({ path: res.path, files: bundle.files.length });
        if (res.reveal !== false) await api.revealPath?.(res.path);
      } else {
        triggerDownload(URL.createObjectURL(zipFiles(bundle.files, bundle.folder)), `${bundle.folder}-Obsidian.zip`);
        setDone({ path: '下载文件夹（ZIP）', files: bundle.files.length });
      }
    } catch (e: any) {
      setErr(`导出失败：${String(e?.message ?? e)}`);
    } finally {
      setBusy(false);
    }
  };

  const exportZip = () => {
    const blob = zipFiles(bundle.files, bundle.folder);
    triggerDownload(URL.createObjectURL(blob), `${bundle.folder}-Obsidian.zip`);
  };

  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal" style={{ width: 620 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span>导出到 Obsidian</span>
          <button className="modal-x" onClick={onClose}><IconClose size={16} /></button>
        </div>

        <div className="modal-body">
          <p className="modal-tip">
            生成一个可直接「打开文件夹作为库」的 Obsidian 知识库：<b>文章 + 白板 + 双向链接</b>，白板用原生
            <code>.canvas</code>，双击卡片即可打开对应文章。
          </p>

          <div className="export-stats">
            <div><b>{notes}</b><span>篇笔记</span></div>
            <div><b>{bundle.counts.canvas}</b><span>块白板</span></div>
            <div><b>{bundle.counts.links}</b><span>条双链</span></div>
            <div><b>{fmtBytes(bundle.counts.bytes)}</b><span>体积</span></div>
          </div>

          <label className="obs-check">
            <input type="checkbox" checked={includeL4} onChange={(e) => setIncludeL4(e.target.checked)} />
            <span>
              包含 L4 原子单元（输入识别 / 处理步骤 / 输出检验）
              <em>关掉可让白板更清爽，只保留到三级方法</em>
            </span>
          </label>

          <label className="obs-check">
            <input type="checkbox" checked={withStyle} onChange={(e) => setWithStyle(e.target.checked)} />
            <span>
              附带排版美化（CSS 片段 + 库配置）
              <em>正文 16.5px / 行高 1.9，标题三级层次，表格与标注块重绘</em>
            </span>
          </label>

          <div className="obs-struct">
            <div className="obs-struct-title"><IconBook size={14} /> 目录结构</div>
            <pre>{`${bundle.folder}/
├─ README.md              总览入口
├─ 知识索引.md             全量层级目录
├─ 知识全景.canvas         思维导图白板（${bundle.counts.canvas ? '已生成' : '—'}）
├─ 学习路线.canvas         路线白板
├─ 笔记/01-xxx/           ${notes - 2} 篇知识点文章
├─ 学习路线/              路线文章
└─ _样式/ksb-vault.css    排版片段`}</pre>
          </div>

          {done && (
            <div className="obs-done">
              <IconCheck size={14} /> 已导出 {done.files} 个文件到
              <code>{done.path}</code>
            </div>
          )}
          {err && <div className="form-err">{err}</div>}
        </div>

        <div className="modal-foot">
          <button className="btn btn-ghost" style={{ marginRight: 'auto' }} onClick={exportZip}>
            <IconDownload size={15} /> 下载 ZIP
          </button>
          <button className="btn btn-ghost" onClick={onClose}>关闭</button>
          <button className="btn btn-primary" disabled={busy} onClick={() => void exportToFolder()}>
            <IconFolder size={15} /> {busy ? '导出中…' : '导出到文件夹'}
          </button>
        </div>
      </div>
    </div>
  );
}
