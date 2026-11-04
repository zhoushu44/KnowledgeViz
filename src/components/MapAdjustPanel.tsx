import { useEffect, useMemo, useRef, useState } from 'react';
import type { Project, ProjectIndex } from '../lib/types';
import { useProjects } from '../store/projects';
import {
  applyAdjustment, countText, localAdjustment, requestAdjustment, snapshotOf,
  type AdjustOp, type AdjustPreview, type AdjustStep, type AdjustmentResponse, type ProjectSnapshot,
} from '../lib/adjust';
import { IconClose, IconSend, IconSparkle, IconUndo, IconAlert, IconCheck } from './Icons';

interface Plan {
  ops: AdjustOp[];
  /** 全量执行时的逐条结果（用于列表展示与初始勾选） */
  steps: AdjustStep[];
  dropped: string[];
  warnings: string[];
  source: 'ai' | 'local';
}

interface Msg {
  id: number;
  role: 'user' | 'assistant';
  text: string;
  plan?: Plan;
  applied?: boolean;
}

const QUICK = [
  '这个分支太粗，帮我拆细一点',
  '帮我删掉和主题不相关的节点',
  '命名不准确，改得更专业一些',
  '这些层级太深了，精简成两级',
];

/** 导图页右下角的「不满意 → 说出来 → AI 改」浮动对话框 */
export default function MapAdjustPanel({
  project, idx, selectedId, onSelect, onApplied,
}: {
  project: Project;
  idx: ProjectIndex;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onApplied?: (info: { touched: string[]; expand: string[] }) => void;
}) {
  const { updateProject } = useProjects();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [waited, setWaited] = useState(0);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [err, setErr] = useState('');
  /** 撤回栈：最近 5 次 */
  const [undoStack, setUndoStack] = useState<{ snap: ProjectSnapshot; note: string }[]>([]);
  const [flash, setFlash] = useState('');
  const abortRef = useRef<AbortController | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const seq = useRef(0);
  /** 已应用的清单消息 id：防抖连点（同一版不会被应用两次） */
  const appliedRef = useRef(new Set<number>());

  const selected = selectedId ? idx.byId.get(selectedId) : null;

  useEffect(() => () => abortRef.current?.abort(), []);
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => inputRef.current?.focus(), 60);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => {
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs, busy]);

  // 切换项目时清空对话与撤回点（避免把 A 项目的撤销打到 B 项目）
  useEffect(() => {
    setMsgs([]);
    setUndoStack([]);
    setErr('');
    setText('');
  }, [project.id]);

  useEffect(() => {
    if (!busy) { setWaited(0); return; }
    const t = window.setInterval(() => setWaited((s) => s + 1), 1000);
    return () => window.clearInterval(t);
  }, [busy]);

  const history = useMemo(
    () => msgs.filter((m) => m.role === 'user' || (m.role === 'assistant' && !m.plan)).map((m) => ({ role: m.role, content: m.text })),
    [msgs]
  );

  const push = (m: Omit<Msg, 'id'>) => setMsgs((list) => [...list, { ...m, id: ++seq.current }]);
  const say = (message: string) => setFlash(message);

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(''), 2600);
    return () => clearTimeout(t);
  }, [flash]);

  const send = async (raw?: string) => {
    const q = (raw ?? text).trim();
    if (!q || busy) return;
    setText('');
    setErr('');
    push({ role: 'user', text: q });
    setBusy(true);
    const ctl = new AbortController();
    abortRef.current = ctl;
    try {
      // 明确的「把 A 改名为 B / 删掉 A / 在 A 下加 B / 把 A 移到 B 下」本地立刻处理，不等模型
      const fast = localAdjustment(q, project, selectedId);
      let res: AdjustmentResponse;
      if (fast && fast.ops.length) {
        res = fast;
      } else {
        try {
          res = await requestAdjustment({ project, idx, text: q, history, selectedId, signal: ctl.signal });
        } catch (e: any) {
          if (ctl.signal.aborted) throw e;
          if (!fast) throw e;
          res = fast;
        }
      }
      if (!res.ops.length) {
        push({
          role: 'assistant',
          text: res.dropped.length ? `${res.reply}\n（${res.dropped.slice(0, 3).join('；')}）` : res.reply,
        });
        return;
      }
      const preview = applyAdjustment(project, res.ops);
      push({
        role: 'assistant',
        text: res.reply,
        plan: {
          ops: res.ops,
          steps: preview.steps,
          dropped: res.dropped,
          warnings: preview.warnings,
          source: res.source,
        },
      });
    } catch (e: any) {
      if (ctl.signal.aborted) {
        push({ role: 'assistant', text: '已停止这次调整。' });
      } else {
        setErr(
          `AI 暂时没接上（${String(e?.message ?? e).slice(0, 80)}）。` +
          '可以先试试明确说法：把「A」改名为「B」／删掉「A」／在「A」下新增「B」／把「A」移到「B」下。'
        );
      }
    } finally {
      abortRef.current = null;
      setBusy(false);
    }
  };

  const applyPlan = (m: Msg, ops: AdjustOp[], preview: AdjustPreview) => {
    if (!ops.length) {
      say('没有勾选任何改动');
      return;
    }
    // 同一版清单只应用一次：连点会重复新增节点
    if (appliedRef.current.has(m.id)) return;
    appliedRef.current.add(m.id);
    const snap = snapshotOf(project);
    updateProject(project.id, {
      nodes: preview.project.nodes,
      edges: preview.project.edges,
      routes: preview.project.routes,
      stats: preview.project.stats,
    });
    setUndoStack((s) => [...s.slice(-4), { snap, note: countText(preview.counts) }]);
    setMsgs((list) => list.map((x) => (x.id === m.id ? { ...x, applied: true } : x)));
    say(`已应用：${countText(preview.counts)}`);
    onApplied?.({ touched: preview.touched, expand: preview.expand });
    if (selectedId && !preview.project.nodes.some((n) => n.id === selectedId)) onSelect(null);
  };

  const revert = () => {
    const last = undoStack[undoStack.length - 1];
    if (!last) return;
    updateProject(project.id, last.snap);
    setUndoStack((s) => s.slice(0, -1));
    say('已撤回上一次调整');
  };

  const skipPlan = (m: Msg) =>
    setMsgs((list) => list.map((x) => (x.id === m.id ? { ...x, plan: undefined, applied: true, text: `${x.text}\n（已忽略这版改动）` } : x)));

  if (!open) {
    return (
      <button className="mm-ai-fab" onClick={() => setOpen(true)} title="对这张导图不满意？说给 AI 听">
        <IconSparkle size={14} />
        不满意？让 AI 改
      </button>
    );
  }

  return (
    <div className="mm-ai" onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } }}>
      <div className="mm-ai-head">
        <span className="mm-ai-title"><IconSparkle size={14} /> AI 调整导图</span>
        {selected && <span className="mm-ai-ctx" title={selected.name}>上下文：{selected.name}</span>}
        <button className="mm-ai-x" onClick={() => setOpen(false)} title="收起"><IconClose size={15} /></button>
      </div>

      <div className="mm-ai-body" ref={bodyRef}>
        {!msgs.length && (
          <div className="mm-ai-empty">
            <div className="mm-ai-empty-title">哪里不满意，直接说</div>
            <div className="mm-ai-empty-sub">AI 会先列出改动清单，你可以逐条勾选，确认后才真正改这张导图。</div>
            <div className="mm-ai-quick">
              {QUICK.map((q) => (
                <button key={q} className="mm-ai-chip" onClick={() => void send(q)}>{q}</button>
              ))}
            </div>
          </div>
        )}

        {msgs.map((m) => (
          <div key={m.id} className={`mm-ai-msg ${m.role}`}>
            <div className="mm-ai-bubble">
              {m.text}
              {m.plan && (
                <PlanCard
                  plan={m.plan}
                  project={project}
                  done={Boolean(m.applied)}
                  onApply={(ops, preview) => applyPlan(m, ops, preview)}
                  onSkip={() => skipPlan(m)}
                />
              )}
            </div>
          </div>
        ))}

        {busy && (
          <div className="mm-ai-msg assistant">
            <div className="mm-ai-bubble mm-ai-thinking">
              <span className="mm-ai-dots"><i /><i /><i /></span>
              正在读你的知识树并生成改动清单…
              {waited >= 12 && <span className="mm-ai-wait">{waited}s</span>}
            </div>
          </div>
        )}

        {!!err && <div className="mm-ai-err"><IconAlert size={12} /> {err}</div>}
      </div>

      {!!flash && <div className="mm-ai-flash"><IconCheck size={12} /> {flash}</div>}
      {waited >= 25 && busy && (
        <div className="mm-ai-tip">模型较慢，可继续等；也可以直接用「把 A 改名为 B / 删掉 A」这类明确说法，本地会立即处理。</div>
      )}

      {undoStack.length > 0 && (
        <div className="mm-ai-undo">
          <span>可撤回 {undoStack.length} 步 · 最近：{undoStack[undoStack.length - 1].note}</span>
          <button className="mm-ai-undo-btn" onClick={revert}><IconUndo size={12} /> 撤回</button>
        </div>
      )}

      <div className="mm-ai-input">
        <textarea
          ref={inputRef}
          rows={2}
          value={text}
          placeholder={selected ? `说说「${selected.name}」哪里不对…` : '例如：机器学习这块太笼统，拆成 3 个方法'}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
        />
        {busy ? (
          <button className="mm-ai-send stop" onClick={() => abortRef.current?.abort()}>停止</button>
        ) : (
          <button className="mm-ai-send" disabled={!text.trim()} onClick={() => void send()} title="发送（Enter）">
            <IconSend size={14} />
          </button>
        )}
      </div>
      <div className="mm-ai-hint">Enter 发送 · Shift+Enter 换行 · 勾选后可只应用其中几条 · 改动写回 YAML</div>
    </div>
  );
}

/** 一版改动清单：逐条勾选 + 只应用选中的 */
function PlanCard({
  plan, project, done, onApply, onSkip,
}: {
  plan: Plan;
  project: Project;
  done: boolean;
  onApply: (ops: AdjustOp[], preview: AdjustPreview) => void;
  onSkip: () => void;
}) {
  const [picked, setPicked] = useState<boolean[]>(() => plan.steps.map((s) => s.ok));

  // 只算勾选的那几条；索引天然对齐（applyAdjustment 按传入顺序产 steps）
  const preview = useMemo(
    () => applyAdjustment(project, plan.ops.filter((_, i) => picked[i])),
    [project, plan.ops, picked]
  );

  const chosen = picked.filter(Boolean).length;
  const allOn = chosen === picked.length;
  const failed = plan.steps.filter((s) => !s.ok).length;

  return (
    <div className={`mm-ai-plan${done ? ' done' : ''}`}>
      <div className="mm-ai-plan-head">
        <IconSparkle size={12} />
        {done ? '已应用到导图' : `待确认：${countText(preview.counts) || '无有效改动'}`}
        {plan.source === 'local' && <span className="mm-ai-tag">本地规则</span>}
        {!done && picked.length > 1 && (
          <button
            className="mm-ai-selall"
            onClick={() => setPicked((p) => p.map(() => !allOn))}
          >
            {allOn ? '全不选' : '全选'}
          </button>
        )}
      </div>

      <ul className="mm-ai-plan-list">
        {plan.steps.map((s, i) => (
          <li key={i} className={`mm-ai-step${picked[i] ? '' : ' off'}${s.ok ? '' : ' bad'}`}>
            {!done && (
              <input
                type="checkbox"
                checked={picked[i]}
                disabled={!s.ok}
                onChange={() => setPicked((p) => p.map((v, k) => (k === i ? !v : v)))}
              />
            )}
            <span>{s.label}</span>
          </li>
        ))}
      </ul>

      {!!plan.dropped.length && (
        <div className="mm-ai-drop"><IconAlert size={11} /> 忽略 {plan.dropped.length} 条无效操作</div>
      )}
      {failed > 0 && !done && (
        <div className="mm-ai-drop"><IconAlert size={11} /> {failed} 条无法生效（已自动取消勾选）</div>
      )}
      {!!plan.warnings.length && !done && (
        <div className="mm-ai-warn"><IconAlert size={11} /> {plan.warnings.join('；')}</div>
      )}

      {!done && (
        <div className="mm-ai-plan-actions">
          <button className="btn btn-primary mm-ai-apply" disabled={!chosen} onClick={() => onApply(plan.ops.filter((_, i) => picked[i]), preview)}>
            <IconCheck size={13} /> {chosen === picked.length ? '应用全部' : `应用选中的 ${chosen} 条`}
          </button>
          <button className="btn btn-ghost mm-ai-skip" onClick={onSkip}>忽略</button>
        </div>
      )}
    </div>
  );
}
