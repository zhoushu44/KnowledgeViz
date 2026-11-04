import { useEffect, useMemo, useRef, useState } from 'react';
import type { KnowledgePoint, LearningContent, LearningSection, Project, ProjectIndex } from '../lib/types';
import { aiLearning, learningToMarkdown, templateLearning } from '../lib/learning';
import { downloadText } from '../lib/ksb';
import { IconBulb, IconCheck, IconEdit, IconRefresh, IconSparkle, IconDownload, IconPlus, IconTrash } from './Icons';

interface Props {
  project: Project;
  idx: ProjectIndex;
  node: KnowledgePoint;
  onSave: (patch: Partial<KnowledgePoint>) => void;
}

/**
 * 「学习」标签页：
 *  - 没有内容时给一份本地结构化讲解（0 等待），可一键用 AI 重写得更具体
 *  - 全字段可编辑：目标 / 小节 / 练习 / 误区 / 延伸
 */
export default function LearningPanel({ project, idx, node, onSave }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<LearningContent | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [savedAt, setSavedAt] = useState<string>('');
  const autoGen = useRef<string>('');

  const all = useMemo(() => idx.byId as Map<string, KnowledgePoint>, [idx]);
  const content: LearningContent | null = draft ?? node.learning ?? null;

  // 首次打开自动生成模板内容（不写盘，用户点保存才落盘）
  useEffect(() => {
    setEditing(false);
    setErr('');
    setDraft(null);
    if (!node.learning && autoGen.current !== node.id) {
      autoGen.current = node.id;
      setDraft(templateLearning(node, all));
    }
  }, [node.id, node.learning, all]);

  const startEdit = () => {
    setDraft(content ?? templateLearning(node, all));
    setEditing(true);
    setErr('');
  };

  const patch = (p: Partial<LearningContent>) => setDraft((d) => ({ ...(d ?? templateLearning(node, all)), ...p }));

  const save = () => {
    if (!draft) return;
    const fallback = templateLearning(node, all);
    const next: LearningContent = {
      goals: draft.goals?.length ? draft.goals : fallback.goals,
      sections: draft.sections?.some((x) => x.title && x.body.trim())
        ? draft.sections.filter((x) => x.title || x.body.trim())
        : fallback.sections,
      practice: draft.practice?.trim() ? draft.practice : fallback.practice,
      pitfalls: draft.pitfalls?.length ? draft.pitfalls : fallback.pitfalls,
      further: draft.further?.length ? draft.further : fallback.further,
      source: draft.source === 'ai' ? 'ai' : 'manual',
      updatedAt: new Date().toISOString(),
    };
    onSave({ learning: next });
    setDraft(null);
    setEditing(false);
    setSavedAt(new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }));
  };

  const regenTemplate = () => {
    setDraft(templateLearning(node, all));
    setEditing(true);
  };

  const askAi = async () => {
    setBusy(true);
    setErr('');
    try {
      const res = await aiLearning(node, project.name, all);
      setDraft(res);
      setEditing(true);
    } catch (e: any) {
      setErr(`AI 生成较慢或不可用（${String(e?.message ?? e)}）。已打开编辑器并填入内置模板，可直接修改。`);
      setDraft(templateLearning(node, all));
      setEditing(true);
    } finally {
      setBusy(false);
    }
  };

  const exportMd = () => {
    if (!content) return;
    downloadText(`${node.name}-学习内容.md`, learningToMarkdown(node, content), 'text/markdown');
  };

  return (
    <div className="learn">
      <div className="learn-bar">
        <span className="learn-src">
          {content?.source === 'ai' ? 'AI 生成' : content?.source === 'manual' ? '手动编辑' : '内置模板'}
          {content?.updatedAt ? ` · ${new Date(content.updatedAt).toLocaleDateString('zh-CN')}` : ''}
        </span>
        <span className="learn-actions">
          {!editing && (
            <>
              <button className="learn-btn" onClick={startEdit}><IconEdit size={13} /> 编辑</button>
              <button className="learn-btn" onClick={() => void askAi()} disabled={busy}>
                <IconSparkle size={13} /> {busy ? '生成中…' : 'AI 重写'}
              </button>
              <button className="learn-btn" onClick={regenTemplate}><IconRefresh size={13} /> 模板</button>
              <button className="learn-btn" onClick={exportMd}><IconDownload size={13} /> 导出</button>
            </>
          )}
          {editing && (
            <>
              <button className="learn-btn primary" onClick={save}><IconCheck size={13} /> 保存</button>
              <button className="learn-btn" onClick={() => { setEditing(false); setDraft(null); }}>取消</button>
            </>
          )}
        </span>
      </div>

      {savedAt && !editing && <div className="learn-saved"><IconCheck size={12} /> 已保存到项目（YAML） · {savedAt}</div>}
      {err && <div className="learn-err">{err}</div>}

      {!content && <div className="learn-empty">暂无学习内容，点「编辑」开始写，或点「AI 重写」让模型生成。</div>}

      {content && !editing && (
        <div className="learn-read">
          {!!content.goals?.length && (
            <section className="learn-sec">
              <h4>🎯 学完能做到</h4>
              <ul className="learn-goals">
                {content.goals.map((g, i) => <li key={i}>{g}</li>)}
              </ul>
            </section>
          )}
          {content.sections?.map((s, i) => (
            <section className="learn-sec" key={i}>
              <h4>{s.title}</h4>
              {s.body.split(/\n{2,}/).map((para, k) => (
                <p key={k} className="learn-p">{para}</p>
              ))}
            </section>
          ))}
          {content.practice && (
            <section className="learn-sec">
              <h4>🛠 动手练习</h4>
              <p className="learn-p learn-practice">{content.practice}</p>
            </section>
          )}
          {!!content.pitfalls?.length && (
            <section className="learn-sec">
              <h4>⚠️ 常见误区</h4>
              <ul className="learn-list">{content.pitfalls.map((p, i) => <li key={i}>{p}</li>)}</ul>
            </section>
          )}
          {!!content.further?.length && (
            <section className="learn-sec">
              <h4>🧭 下一步</h4>
              <ul className="learn-list">{content.further.map((p, i) => <li key={i}>{p}</li>)}</ul>
            </section>
          )}
        </div>
      )}

      {content && editing && (
        <div className="learn-edit">
          <label className="learn-label">学完能做到（每行一条）</label>
          <textarea
            className="learn-textarea"
            rows={3}
            value={(content.goals ?? []).join('\n')}
            onChange={(e) => patch({ goals: e.target.value.split('\n').map((x) => x.trim()).filter(Boolean) })}
          />

          <div className="learn-label-row">
            <span className="learn-label">讲解小节</span>
            <button
              className="learn-btn"
              onClick={() => patch({ sections: [...(content.sections ?? []), { title: '新小节', body: '' } as LearningSection] })}
            >
              <IconPlus size={12} /> 加一节
            </button>
          </div>
          {(content.sections ?? []).map((s, i) => (
            <div className="learn-sec-edit" key={i}>
              <div className="learn-sec-edit-head">
                <input
                  className="learn-input"
                  value={s.title}
                  placeholder="小节标题"
                  onChange={(e) => {
                    const next = [...(content.sections ?? [])];
                    next[i] = { ...next[i], title: e.target.value };
                    patch({ sections: next });
                  }}
                />
                <button
                  className="learn-btn danger"
                  title="删除这一节"
                  onClick={() => patch({ sections: (content.sections ?? []).filter((_, k) => k !== i) })}
                >
                  <IconTrash size={12} />
                </button>
              </div>
              <textarea
                className="learn-textarea"
                rows={4}
                value={s.body}
                placeholder="先做什么、再做什么、怎么判断做对了"
                onChange={(e) => {
                  const next = [...(content.sections ?? [])];
                  next[i] = { ...next[i], body: e.target.value };
                  patch({ sections: next });
                }}
              />
            </div>
          ))}

          <label className="learn-label">动手练习</label>
          <textarea className="learn-textarea" rows={3} value={content.practice ?? ''} onChange={(e) => patch({ practice: e.target.value })} />

          <label className="learn-label">常见误区（每行一条）</label>
          <textarea
            className="learn-textarea"
            rows={3}
            value={(content.pitfalls ?? []).join('\n')}
            onChange={(e) => patch({ pitfalls: e.target.value.split('\n').map((x) => x.trim()).filter(Boolean) })}
          />

          <label className="learn-label">下一步（每行一条）</label>
          <textarea
            className="learn-textarea"
            rows={2}
            value={(content.further ?? []).join('\n')}
            onChange={(e) => patch({ further: e.target.value.split('\n').map((x) => x.trim()).filter(Boolean) })}
          />

          <div className="learn-hint"><IconBulb size={12} /> 保存后会写回该项目的 knowledge_points.yaml，下次打开直接可见。</div>
        </div>
      )}
    </div>
  );
}
