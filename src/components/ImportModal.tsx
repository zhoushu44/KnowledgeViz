import { useMemo, useRef, useState } from 'react';
import type { Category } from '../lib/types';
import { CATEGORY_STYLE } from '../lib/types';
import { ICON_BY_NAME, IconClose, IconUpload, IconBook, IconFolder, IconAlert } from './Icons';
import { useProjects } from '../store/projects';
import { useRouter } from '../store/router';
import { BUNDLE_FILES, parseBundle, bundleTemplate, downloadText, type ValidationIssue } from '../lib/ksb';
import { desktop, isDesktop } from '../lib/desktop';

const CATS: Category[] = ['学科知识', '行业工作', '通用知识'];

export function CategoryPicker({
  value, onChange,
}: {
  value: Category; onChange: (c: Category) => void;
}) {
  return (
    <div className="catpick">
      {CATS.map((c) => {
        const st = CATEGORY_STYLE[c];
        const Icon = ICON_BY_NAME[st.icon] ?? IconBook;
        const active = value === c;
        return (
          <button
            key={c}
            type="button"
            className={`catpick-item${active ? ' active' : ''}`}
            onClick={() => onChange(c)}
          >
            <span className="catpick-icon" style={{ background: st.bg, color: st.color }}>
              <Icon size={20} />
            </span>
            <span className="catpick-name">{c}</span>
            <span className="catpick-sub">{st.sub}</span>
            {active && (
              <span className="catpick-check" style={{ background: 'var(--brand)' }}>
                <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 12.5l5 5L20 6.5" />
                </svg>
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export default function ImportModal({ onClose }: { onClose: () => void }) {
  const { projects, addProject } = useProjects();
  const { push } = useRouter();
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [cat, setCat] = useState<Category>('通用知识');
  const [picked, setPicked] = useState<{ dirName: string; files: Record<string, string>; missing: string[] } | null>(null);
  const [issues, setIssues] = useState<ValidationIssue[]>([]);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const missingTip = useMemo(() => {
    if (!picked) return '';
    return picked.missing.length ? `缺少：${picked.missing.join('、')}` : '';
  }, [picked]);

  const pickDir = async () => {
    setErr('');
    setIssues([]);
    if (!desktop) {
      fileRef.current?.click();
      return;
    }
    setBusy(true);
    try {
      const res = await desktop.pickDir();
      if (res.canceled || !res.files) return;
      setPicked({ dirName: res.dirName ?? '', files: res.files, missing: res.missing ?? [] });
      if (res.dirName && !name.trim()) setName(res.dirName);
    } catch (e: any) {
      setErr(`目录读取失败：${String(e?.message ?? e)}`);
    } finally {
      setBusy(false);
    }
  };

  const onFiles = async (list: FileList | null) => {
    if (!list?.length) return;
    const files: Record<string, string> = {};
    for (const f of Array.from(list)) {
      const base = f.name.toLowerCase();
      if (!BUNDLE_FILES.includes(base as any)) continue;
      files[base] = await f.text();
    }
    const missing = BUNDLE_FILES.filter((f) => !files[f]);
    setPicked({ dirName: name.trim(), files, missing });
    setIssues([]);
  };

  const doImport = () => {
    setErr('');
    setIssues([]);
    if (!name.trim()) {
      setErr('请输入项目名称（需与 yaml/ 下子目录名一致）');
      return;
    }
    if (!/^[\u4e00-\u9fa5A-Za-z0-9_\-. ]+$/.test(name)) {
      setErr('项目名称包含非法字符（不能用作目录名）');
      return;
    }
    if (projects.some((p) => p.id === name.trim() || p.name === name.trim())) {
      setErr('已存在同名项目，请换一个名称或先在项目中删除');
      return;
    }
    if (!picked) {
      setErr(isDesktop()
        ? '请先选择包含 5 个 YAML 文件的项目目录'
        : '请先选择 5 个 YAML 文件（浏览器模式），或使用桌面版直接导入目录');
      return;
    }
    if (missingTip) {
      setIssues(picked.missing.map((f) => ({ file: f, message: `缺少 ${f}` })));
      return;
    }
    const res = parseBundle(picked.files, name.trim());
    if (!res.ok || !res.project) {
      setIssues(res.issues);
      return;
    }
    const project = {
      ...res.project,
      id: name.trim(),
      name: name.trim(),
      description: desc.trim() || res.project.description,
      category: cat,
      updatedAt: new Date().toISOString(),
    };
    addProject(project);
    onClose();
    push({ name: 'workspace', projectId: project.id });
  };

  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal" style={{ width: 560 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span>从已有 YAML 文件导入项目</span>
          <button className="modal-x" onClick={onClose}><IconClose size={16} /></button>
        </div>

        <div className="modal-body">
          <p className="modal-tip">
            项目名称需与 <code>yaml/</code> 目录下的子目录名一致，系统会从该目录读取 5 个 YAML 文件。
          </p>

          <div className="import-picker">
            <button className="btn btn-ghost" onClick={pickDir} disabled={busy}>
              <IconFolder size={15} /> {busy ? '读取中…' : '选择项目目录'}
            </button>
            <span className={`import-picked${picked && !missingTip ? ' ok' : ''}`}>
              {picked
                ? missingTip || `已读取 ${picked.dirName || name}：5 / 5 个文件`
                : isDesktop()
                  ? '未选择目录'
                  : '浏览器模式：点击后选择 5 个 YAML 文件'}
            </span>
            <input
              ref={fileRef}
              type="file"
              multiple
              accept=".yaml,.yml"
              style={{ display: 'none' }}
              onChange={(e) => void onFiles(e.target.files)}
            />
          </div>

          <label className="flabel" style={{ marginTop: 14 }}>项目名称</label>
          <input
            className={`input${err ? ' error' : ''}`}
            value={name}
            onChange={(e) => { setName(e.target.value); setErr(''); }}
            placeholder="例如：金融知识体系"
          />

          <label className="flabel" style={{ marginTop: 16 }}>项目描述（可选）</label>
          <input
            className="input"
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            placeholder="简要描述"
          />

          <label className="flabel" style={{ marginTop: 16 }}>知识体系分类</label>
          <CategoryPicker value={cat} onChange={setCat} />

          {err && <div className="form-err">{err}</div>}

          <div className="import-template">
            <span>不会写 YAML？</span>
            <button
              className="btn-text"
              onClick={() => {
                const tpl = bundleTemplate(name.trim() || '示例知识体系');
                for (const [f, content] of Object.entries(tpl)) downloadText(f, content);
              }}
            >
              下载 5 文件模板
            </button>
          </div>

          {issues.length > 0 && (
            <div className="import-issues">
              <div className="import-issues-head"><IconAlert size={14} /> 校验未通过（{issues.length} 项）</div>
              <ul>
                {issues.slice(0, 8).map((i, k) => (
                  <li key={k}>
                    <b>{i.file}</b>
                    {i.line ? ` 第 ${i.line} 行` : ''}：{i.message}
                  </li>
                ))}
              </ul>
              {issues.length > 8 && <div className="import-issues-more">… 还有 {issues.length - 8} 项</div>}
            </div>
          )}
        </div>

        <div className="modal-foot">
          <button className="btn btn-ghost" onClick={onClose}>取消</button>
          <button className="btn btn-primary" onClick={doImport}>
            <IconUpload size={15} /> 导入
          </button>
        </div>
      </div>
    </div>
  );
}
