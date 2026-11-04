import { useEffect, useMemo, useRef, useState } from 'react';
import type { KnowledgePoint, LearningContent, LearningSection, Project, ProjectIndex } from '../lib/types';
import {
  aiLearning, degenerateReason, learningToMarkdown, lintLearning, templateLearning,
  type AiLearningResult, type LintResult,
} from '../lib/learning';
import { downloadText } from '../lib/ksb';
import { desktop } from '../lib/desktop';
import { IconBulb, IconCheck, IconEdit, IconRefresh, IconSparkle, IconDownload, IconPlus, IconTrash, IconAlert, IconLink } from './Icons';

interface Props {
  project: Project;
  idx: ProjectIndex;
  node: KnowledgePoint;
  onSave: (patch: Partial<KnowledgePoint>) => void;
}

/**
 * 「学习」标签页 v2
 *  - 默认展示：内置体检单（0 等待），但明确标注「不是学习材料」，并给出质检分
 *  - AI 重写：联网取证 → 硬约束生成 → 质检 → 不达标自动回炉一次
 *  - 定义退化时给出「建议定义」，一键采纳，否则所有内容都建在空定义上
 */
export default function LearningPanel({ project, idx, node, onSave }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<LearningContent | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [savedAt, setSavedAt] = useState<string>('');
  const [aiMeta, setAiMeta] = useState<{ rounds: number; ms: number; sources: string[] } | null>(null);
  const [suggested, setSuggested] = useState<{ definition?: string; description?: string } | null>(null);
  const [adopted, setAdopted] = useState(false);
  const autoGen = useRef<string>('');

  const all = useMemo(() => idx.byId as Map<string, KnowledgePoint>, [idx]);
  const content: LearningContent | null = draft ?? node.learning ?? null;
  const deg = degenerateReason(node);
  const lint: LintResult = useMemo(() => lintLearning(node, content), [node, content]);

  // 首次打开自动生成模板内容（不写盘，用户点保存才落盘）
  useEffect(() => {
    setEditing(false);
    setErr('');
    setDraft(null);
    setAiMeta(null);
    setSuggested(null);
    setAdopted(false);
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
      sources: draft.sources ?? [],
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
    if (busy) return;
    setBusy(true);
    setErr('');
    setAiMeta(null);
    setSuggested(null);
    setAdopted(false);
    try {
      const res: AiLearningResult = await aiLearning(node, project.name, all);
      setDraft(res.content);
      setSuggested(res.suggested ?? null);
      setAiMeta({ rounds: res.rounds, ms: res.elapsedMs, sources: res.sources });
      setEditing(true);
      if (res.lint.score < 75) {
        setErr(`生成结果质检 ${res.lint.score}/100（${res.lint.summary}），已${res.rounds ? '回炉一次' : '未能修复'}。可手动补具体机制与数字，或换个模型重试。`);
      }
    } catch (e: any) {
      setErr(`AI 生成失败：${String(e?.message ?? e)}。可先看「体检单」，或手动补写。`);
    } finally {
      setBusy(false);
    }
  };

  const adoptSuggestion = () => {
    if (!suggested) return;
    onSave({
      ...(suggested.definition ? { definition: suggested.definition } : {}),
      ...(suggested.description ? { description: suggested.description } : {}),
    });
    setAdopted(true);
  };

  const exportMd = () => {
    if (!content) return;
    downloadText(`${node.name}-学习内容.md`, learningToMarkdown(node, content, lint), 'text/markdown');
  };

  return (
    <div className="learn">
      {/* ---------- 质检条 ---------- */}
      <div className={`learn-quality q-${lint.grade}`}>
        <span className="learn-quality-score">{lint.score}</span>
        <span className="learn-quality-body">
          <span className="learn-quality-title">内容质检 · {lint.summary}</span>
          <span className="learn-quality-src">
            {content?.source === 'ai' ? 'AI 生成' : content?.source === 'manual' ? '手动编辑' : '内置体检单'}
            {content?.updatedAt ? ` · ${new Date(content.updatedAt).toLocaleDateString('zh-CN')}` : ''}
            {aiMeta ? ` · 耗时 ${Math.round(aiMeta.ms / 1000)}s${aiMeta.rounds ? ' · 已回炉 1 次' : ''}` : ''}
          </span>
        </span>
        <span className="learn-actions">
          {!editing && (
            <>
              <button className="learn-btn" onClick={startEdit}><IconEdit size={13} /> 编辑</button>
              <button className="learn-btn primary" onClick={() => void askAi()} disabled={busy}>
                <IconSparkle size={13} /> {busy ? '联网生成中…' : 'AI 重写'}
              </button>
              <button className="learn-btn" onClick={regenTemplate} title="重新生成本地体检单"><IconRefresh size={13} /> 体检</button>
              <button className="learn-btn" onClick={exportMd} disabled={!content}><IconDownload size={13} /> 导出</button>
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

      {busy && (
        <div className="learn-progress">
          <IconRefresh size={12} /> 正在联网检索该主题的真实资料 → 生成 → 质检，约 20–60s
        </div>
      )}

      {savedAt && !editing && <div className="learn-saved"><IconCheck size={12} /> 已保存到项目（YAML） · {savedAt}</div>}
      {err && <div className="learn-err"><IconAlert size={12} /> {err}</div>}

      {/* ---------- 定义退化提示 ---------- */}
      {deg && (
        <div className="learn-defgap">
          <div className="learn-defgap-head"><IconAlert size={12} /> 源头定义不达标：{deg}</div>
          <div className="learn-defgap-body">
            在这种情况下，任何「学习内容」都只能复述这句话。先补定义，再谈学习。
          </div>
          {suggested?.definition ? (
            <div className="learn-suggest">
              <div className="learn-suggest-label">建议定义</div>
              <p className="learn-suggest-text">{suggested.definition}</p>
              {suggested.description && <p className="learn-suggest-text muted">{suggested.description}</p>}
              {adopted ? (
                <div className="learn-saved"><IconCheck size={12} /> 已采纳，写入本节点</div>
              ) : (
                <button className="learn-btn primary" onClick={adoptSuggestion}><IconCheck size={12} /> 采纳并写入节点</button>
              )}
            </div>
          ) : (
            <div className="learn-defgap-body muted">点「AI 重写」会同时给出建议定义。</div>
          )}
        </div>
      )}

      {/* ---------- 模板横幅：明确它不是学习材料 ---------- */}
      {content?.source === 'template' && (
        <div className="learn-banner">
          <IconBulb size={13} />
          <span>
            这是<strong>节点体检单</strong>，不是学习材料 —— 它只引用本节点真实内容并列出缺口，不含该领域知识。
            点「AI 重写」才会联网取证并生成正文。
          </span>
        </div>
      )}

      {!content && <div className="learn-empty">暂无学习内容，点「编辑」开始写，或点「AI 重写」让模型联网生成。</div>}

      {/* ---------- 只读 ---------- */}
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
          {!!content.sources?.length && (
            <section className="learn-sec">
              <h4>📎 依据（联网取证）</h4>
              <ul className="learn-list learn-sources">
                {content.sources.map((u, i) => (
                  <li key={i}>
                    <a
                      href={u}
                      onClick={(e) => {
                        if (desktop) {
                          e.preventDefault();
                          void desktop.openExternal(u);
                        }
                      }}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <IconLink size={11} /> {safeHost(u)}
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}

      {/* ---------- 编辑 ---------- */}
      {content && editing && (
        <div className="learn-edit">
          {!!lint.issues.length && (
            <details className="learn-issues" open={lint.score < 75}>
              <summary>质检发现 {lint.issues.length} 处问题（{lint.score}/100）</summary>
              <ul>
                {lint.issues.map((x, i) => (
                  <li key={i} className={x.level === 'error' ? 'lv-error' : 'lv-warn'}>
                    <b>{x.field}</b> · {x.text}
                  </li>
                ))}
              </ul>
            </details>
          )}

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
                rows={5}
                value={s.body}
                placeholder="给机制、给数字、给步骤、给反例 —— 不要复述标题"
                onChange={(e) => {
                  const next = [...(content.sections ?? [])];
                  next[i] = { ...next[i], body: e.target.value };
                  patch({ sections: next });
                }}
              />
              <div className="learn-sec-meta">
                {s.body.trim().length} 字
                {s.body.trim().length < 60 ? ' · 建议 ≥60' : ''}
                {s.body.trim().length > 400 ? ' · 过长，建议 ≤400' : ''}
              </div>
            </div>
          ))}

          <label className="learn-label">动手练习（要产出可检查的物件）</label>
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

function safeHost(u: string): string {
  try {
    return new URL(u).hostname.replace(/^www\./, '');
  } catch {
    return u;
  }
}
