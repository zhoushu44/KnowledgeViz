import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from '../store/router';
import {
  IconChevronLeft, IconSearch, IconSparkle, IconAlert, IconCheck, IconClose,
  IconLink, IconRefresh, IconFile, IconBulb, IconChart,
} from '../components/Icons';
import {
  confidenceTier, netAvailable, onNetTick, stableJudge, searchMany, researchMany,
  STATUS_NOTE, VERDICT_META, type JudgeResult, type SearchBundle, type Verdict,
} from '../lib/net';
import { desktop } from '../lib/desktop';

type Tab = 'research' | 'verify';

export default function ResearchPage({ tab: tabProp, onClose }: { tab?: Tab; onClose?: () => void }) {
  const { back } = useRouter();
  const [tab, setTab] = useState<Tab>(tabProp ?? 'research');

  useEffect(() => {
    if (tabProp) setTab(tabProp);
  }, [tabProp]);

  const close = () => (onClose ? onClose() : back());

  return (
    <div className="rp">
      <div className="rp-top">
        <button className="btn-text" onClick={close}><IconChevronLeft size={15} /> 返回</button>
        <div className="rp-tabs">
          <button className={`rp-tab${tab === 'research' ? ' active' : ''}`} onClick={() => setTab('research')}>
            <IconSearch size={14} /> 深入研究
          </button>
          <button className={`rp-tab${tab === 'verify' ? ' active' : ''}`} onClick={() => setTab('verify')}>
            <IconCheck size={14} /> 事实核查
          </button>
        </div>
        <span className="rp-badge">内置联网 · 全部并发</span>
      </div>

      {!netAvailable() ? (
        <div className="rp-body">
          <div className="rp-warn">
            <IconAlert size={16} />
            联网调研需要桌面版运行（Electron 主进程代理）；当前是浏览器预览模式。
          </div>
        </div>
      ) : tab === 'research' ? (
        <ResearchPanel />
      ) : (
        <VerifyPanel />
      )}
    </div>
  );
}

/* ============================ 深入研究 ============================ */

const RESEARCH_EXAMPLES = [
  '2026 年主流向量数据库的技术差异与选型建议',
  '知识图谱在电商搜索中的应用现状',
  '大模型 RAG 的常见失败模式与改进方案',
];

function ResearchPanel() {
  const [tasks, setTasks] = useState<string[]>(['']);
  const [running, setRunning] = useState(false);
  const [rows, setRows] = useState<{ task: string; content: string; sources: string[]; ms: number; error?: string }[]>([]);
  const [tick, setTick] = useState<string>('');
  const [err, setErr] = useState('');
  const abortRef = useRef(false);

  useEffect(() => onNetTick((t) => {
    if (t.phase === 'in_progress' || t.phase === 'queued') {
      setTick(`${t.task ? t.task.slice(0, 22) + '… ' : ''}${t.phase === 'queued' ? '已提交' : '检索中'} · ${Math.round((t.elapsedMs ?? 0) / 1000)}s`);
    }
  }), []);

  const filled = tasks.map((t) => t.trim()).filter(Boolean);

  const run = async () => {
    if (!filled.length) {
      setErr('请至少输入一个研究问题');
      return;
    }
    setErr('');
    setRunning(true);
    setRows([]);
    setTick('已提交，等待结果…');
    abortRef.current = false;
    try {
      const res = await researchMany(filled, { model: 'mini' });
      setRows(
        res.map((r) => ({
          task: r.task ?? '',
          content: typeof r.content === 'string' ? r.content : JSON.stringify(r.content ?? '', null, 2),
          // 网关 sources 是 {url,title} 对象数组，主进程已拍平成字符串；这里再做一层兜底
          sources: (r.sources ?? []).map((s: any) => (typeof s === 'string' ? s : s?.url)).filter((u: any) => typeof u === 'string' && u),
          ms: r.elapsedMs ?? 0,
          error: r.error,
        }))
      );
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    } finally {
      setRunning(false);
      setTick('');
    }
  };

  return (
    <div className="rp-body">
      <div className="rp-card">
        <div className="rp-card-head">
          <IconSparkle size={15} /> 研究任务（可一次填多个，全部并发）
        </div>

        {tasks.map((t, i) => (
          <div key={i} className="rp-task-row">
            <textarea
              className="input rp-textarea"
              rows={2}
              value={t}
              placeholder={i === 0 ? `例如：${RESEARCH_EXAMPLES[0]}` : '再加一个问题（会与其它问题并发跑）'}
              onChange={(e) => setTasks((list) => list.map((x, k) => (k === i ? e.target.value : x)))}
            />
            {tasks.length > 1 && (
              <button className="rp-del" title="删除" onClick={() => setTasks((list) => list.filter((_, k) => k !== i))}>
                <IconClose size={14} />
              </button>
            )}
          </div>
        ))}

        <div className="rp-actions">
          <button className="btn-text" onClick={() => setTasks((l) => [...l, ''])}>+ 添加任务</button>
          <span className="rp-hint">并发 {Math.max(1, filled.length)} · 预计 {Math.max(15, filled.length * 4)}–{Math.max(40, filled.length * 12)}s</span>
          <button className="btn btn-primary rp-run" onClick={() => void run()} disabled={running}>
            {running ? <IconRefresh size={15} /> : <IconSearch size={15} />} {running ? '研究中…' : '开始研究'}
          </button>
        </div>
        {err && <div className="form-err">{err}</div>}
        {running && <div className="rp-progress"><span className="rp-spin" /> {tick || '正在检索…'}</div>}
      </div>

      {rows.map((r, i) => (
        <div key={i} className="rp-card">
          <div className="rp-card-head">
            <IconFile size={15} /> {r.task}
            {r.ms > 0 && <span className="rp-time">{Math.round(r.ms / 1000)}s</span>}
          </div>
          {r.error ? (
            <div className="form-err">{r.error}</div>
          ) : (
            <>
              <pre className="rp-content">{r.content}</pre>
              {r.sources.length > 0 && (
                <div className="rp-sources">
                  <span className="rp-sources-label">来源 {r.sources.length}</span>
                  {r.sources.slice(0, 12).map((u, k) => (
                    <a
                      key={k}
                      href={u}
                      onClick={(e) => {
                        if (desktop) {
                          e.preventDefault();
                          void desktop.openExternal(u);
                        }
                      }}
                      target="_blank"
                      rel="noreferrer"
                      className="rp-src"
                    >
                      <IconLink size={11} /> {shortUrl(u)}
                    </a>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      ))}

      {!rows.length && !running && (
        <div className="rp-tip">
          <IconBulb size={15} />
          <div>
            <b>怎么用</b>：一个任务写一个完整问题（带时间、范围、比较维度更好）。多个任务会并发跑，
            每个结论都附来源链接。要「严格字段结构」的内容，用事实核查或下面的示例句式改写问题。
          </div>
        </div>
      )}
    </div>
  );
}

/* ============================ 事实核查 ============================ */

function VerifyPanel() {
  const [claims, setClaims] = useState<string[]>(['']);
  const [samples, setSamples] = useState(3);
  const [mode, setMode] = useState<'fast' | 'deep'>('deep');
  const [running, setRunning] = useState(false);
  const [rows, setRows] = useState<JudgeResult[]>([]);
  const [err, setErr] = useState('');

  useEffect(() => onNetTick(() => {}), []);

  const filled = claims.map((c) => c.trim()).filter(Boolean);

  const run = async () => {
    if (!filled.length) {
      setErr('请至少输入一条待核查的说法');
      return;
    }
    setErr('');
    setRunning(true);
    setRows([]);
    try {
      const res = filled.length === 1
        ? [await stableJudge(filled[0], { samples, mode })]
        : await judgeManyWithFallback(filled, { samples, mode });
      setRows(res);
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    } finally {
      setRunning(false);
    }
  };

  const decided = rows.filter((r) => r.status === 'decided').length;

  return (
    <div className="rp-body">
      <div className="rp-card">
        <div className="rp-card-head">
          <IconCheck size={15} /> 待核查说法（每行一条，全部并发）
        </div>

        {claims.map((c, i) => (
          <div key={i} className="rp-task-row">
            <textarea
              className="input rp-textarea"
              rows={2}
              value={c}
              placeholder={i === 0 ? '例如：英伟达 CEO 黄仁勋在 2026 年 10 月宣布退休' : '再加一条说法'}
              onChange={(e) => setClaims((list) => list.map((x, k) => (k === i ? e.target.value : x)))}
            />
            {claims.length > 1 && (
              <button className="rp-del" title="删除" onClick={() => setClaims((list) => list.filter((_, k) => k !== i))}>
                <IconClose size={14} />
              </button>
            )}
          </div>
        ))}

        <div className="rp-actions">
          <button className="btn-text" onClick={() => setClaims((l) => [...l, ''])}>+ 添加说法</button>

          <label className="rp-opt">
            票数
            <select className="select" value={samples} onChange={(e) => setSamples(Number(e.target.value))}>
              <option value={1}>1（快筛）</option>
              <option value={3}>3（默认）</option>
              <option value={5}>5（重要结论）</option>
            </select>
          </label>

          <label className="rp-opt">
            模式
            <select className="select" value={mode} onChange={(e) => setMode(e.target.value as 'fast' | 'deep')}>
              <option value="deep">deep（准确）</option>
              <option value="fast">fast（快，判不出假）</option>
            </select>
          </label>

          <button className="btn btn-primary rp-run" onClick={() => void run()} disabled={running}>
            {running ? <IconRefresh size={15} /> : <IconCheck size={15} />} {running ? '核查中…' : '开始核查'}
          </button>
        </div>

        <div className="rp-note">
          置信度用<b>票型后验</b>计算（不是模型自报值）：3 票全一致 = 0.80，4/5 = 0.71。
          实测模型自报置信度恒为 0.90–0.99，对错都高，不可直接采信。
        </div>
        {err && <div className="form-err">{err}</div>}
        {running && (
          <div className="rp-progress">
            <span className="rp-spin" />
            并发展开 {filled.length} 条 × 每{Math.max(1, Math.min(samples, filled.length ? samples : samples))}票 · 约 {mode === 'deep' ? 20 : 5}–{mode === 'deep' ? 40 : 15}s
          </div>
        )}
      </div>

      {rows.length > 0 && (
        <div className="rp-summary">
          共 {rows.length} 条 · decided {decided} 条 · 非 decided {rows.length - decided} 条
          {rows.length !== decided && <span className="rp-summary-warn">（非 decided 的结论不能直接用）</span>}
        </div>
      )}

      {rows.map((r, i) => (
        <JudgeCard key={i} r={r} />
      ))}
    </div>
  );
}

function JudgeCard({ r }: { r: JudgeResult }) {
  const meta = VERDICT_META[r.verdict] ?? VERDICT_META.uncertain;
  const tier = confidenceTier(r.confidence);
  const voteText = (Object.entries(r.votes) as [Verdict, number][])
    .filter(([, n]) => n > 0)
    .map(([v, n]) => `${VERDICT_META[v].text}×${n}`)
    .join(' · ');

  return (
    <div className={`rp-card rp-judge${r.status !== 'decided' ? ' soft' : ''}`}>
      <div className="rp-judge-head">
        <span className="rp-verdict" style={{ color: meta.color }}>
          {meta.icon} {meta.text}
        </span>
        <div className="rp-judge-conf">
          <span className="rp-conf-label">置信度</span>
          <span className="rp-conf-val" style={{ color: tier.color }}>{r.confidence.toFixed(2)}</span>
          <span className="rp-conf-tier" style={{ color: tier.color }}>{tier.label}</span>
          <span className="rp-conf-bar">
            <span className="rp-conf-fill" style={{ width: `${Math.round(r.confidence * 100)}%`, background: tier.color }} />
          </span>
        </div>
      </div>

      <div className="rp-claim">{r.claim}</div>

      <div className="rp-judge-meta">
        <span className={`rp-status ${r.status}`}>{r.status}</span>
        <span>票型 {voteText || '—'}</span>
        <span>一致率 {r.agreement.toFixed(2)}</span>
        <span>
          {r.samples} 票{r.failedSamples ? ` · 失败 ${r.failedSamples}` : ''}
        </span>
        {r.elapsedMs ? <span>{Math.round(r.elapsedMs / 1000)}s</span> : null}
        {r.rawConfidence ? <span className="rp-raw">自报 {r.rawConfidence.toFixed(2)}</span> : null}
      </div>

      <p className="rp-reason">{r.reason}</p>

      {r.status !== 'decided' && (
        <div className="rp-warn soft">
          <IconAlert size={14} /> {STATUS_NOTE[r.status]}
        </div>
      )}

      {r.evidence.length > 0 && (
        <div className="rp-sources">
          <span className="rp-sources-label">来源 {r.evidence.length}</span>
          {r.evidence.map((u, k) => (
            <a
              key={k}
              href={u}
              onClick={(e) => {
                if (desktop) {
                  e.preventDefault();
                  void desktop.openExternal(u);
                }
              }}
              target="_blank"
              rel="noreferrer"
              className="rp-src"
            >
              <IconLink size={11} /> {shortUrl(u)}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

/** 多条时走 judgeMany；若 IPC 侧不可用则退化为逐条并发 */
async function judgeManyWithFallback(claims: string[], opts: { samples: number; mode: 'fast' | 'deep' }) {
  const api = window.ksbNet;
  if (api?.judgeMany) return api.judgeMany(claims, opts);
  return Promise.all(claims.map((c) => stableJudge(c, opts)));
}

function shortUrl(u: string) {
  if (typeof u !== 'string' || !u) return '';
  try {
    const url = new URL(u);
    const path = url.pathname.length > 28 ? url.pathname.slice(0, 28) + '…' : url.pathname;
    return url.hostname.replace(/^www\./, '') + path;
  } catch {
    return String(u).slice(0, 48);
  }
}
