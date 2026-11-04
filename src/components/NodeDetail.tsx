import { useState } from 'react';
import type { KnowledgePoint, Project, ProjectIndex } from '../lib/types';
import { DIFFICULTY_LABEL } from '../lib/types';
import { IconClose, IconClock, IconMap, IconTag, IconLink, IconBulb, IconChart, IconFile, IconEdit, IconCheck, IconSearch, IconRefresh, IconAlert, IconSparkle, IconPlus } from './Icons';
import { desktop } from '../lib/desktop';
import { enrichNode, type NodeResource } from '../lib/enrich';
import { expandNode, toKnowledgePoints, type ProposedNode } from '../lib/expand';
import { verifyNodes, verifyBadge } from '../lib/verify-nodes';
import { netAvailable } from '../lib/net';
import LearningPanel from './LearningPanel';

const TABS = [
  { key: 'learn', label: '学习', icon: IconBulb },
  { key: 'metric', label: '指标', icon: IconChart },
  { key: 'rel', label: '关联', icon: IconLink },
  { key: 'ex', label: '示例', icon: IconBulb },
  { key: 'res', label: '资源', icon: IconFile },
] as const;

function Stars({ n }: { n: number }) {
  return (
    <span className="stars">
      {[1, 2, 3, 4].map((i) => (
        <span key={i} className={i <= n ? 'on' : ''}>★</span>
      ))}
      <span className="stars-num">({n}/4)</span>
    </span>
  );
}

function Bar({ pct, color }: { pct: number; color: string }) {
  return (
    <span className="mbar">
      <span className="mbar-fill" style={{ width: `${pct}%`, background: color }} />
    </span>
  );
}

export default function NodeDetail({
  project, idx, node, onClose, onSelect, onUpdate, onAddNodes,
}: {
  project: Project;
  idx: ProjectIndex;
  node: KnowledgePoint;
  onClose: () => void;
  onSelect: (id: string) => void;
  onUpdate: (patch: Partial<KnowledgePoint>) => void;
  onAddNodes?: (nodes: KnowledgePoint[]) => void;
}) {
  const [tab, setTab] = useState<(typeof TABS)[number]['key']>('learn');
  const [editBase, setEditBase] = useState(false);
  const [draft, setDraft] = useState({ definition: node.definition, description: node.description });
  const branch = idx.branchById.get(node.branch);
  const outs = (idx.outgoing.get(node.id) ?? []).filter((e) => e.type === 'depends' || e.type === 'extends' || e.type === 'evolved');
  const ins = (idx.incoming.get(node.id) ?? []).filter((e) => e.type === 'depends');
  const relates = (idx.outgoing.get(node.id) ?? []).filter((e) => e.type === 'analogy' || e.type === 'contrast' || e.type === 'constrains');
  const route = project.routes.find((r) => r.stages.some((s) => s.nodes.includes(node.id)));

  return (
    <div className="detail">
      <div className="detail-head">
        <span className="detail-head-title">
          <IconFile size={14} /> 节点详情
        </span>
        <button className="detail-close" onClick={onClose}><IconClose size={16} /></button>
      </div>

      <div className="detail-body">
        <h2 className="detail-name">{node.name}</h2>
        {node.nameEn && <div className="detail-en">{node.nameEn}</div>}

        <div className="detail-sep" />

        <section className="detail-sec">
          <div className="detail-h3-row">
            <h3 className="detail-h3">📖 定义</h3>
            <span className="detail-h3-actions">
              {netAvailable() && <VerifyChip node={node} />}
              <button
                className="detail-edit"
                onClick={() => {
                  if (editBase) {
                    onUpdate({ definition: draft.definition.trim() || node.definition, description: draft.description.trim() || node.description });
                  } else {
                    setDraft({ definition: node.definition, description: node.description });
                  }
                  setEditBase((v) => !v);
                }}
              >
                {editBase ? <><IconCheck size={12} /> 保存</> : <><IconEdit size={12} /> 编辑</>}
              </button>
            </span>
          </div>
          {editBase ? (
            <textarea
              className="detail-edit-area"
              rows={2}
              value={draft.definition}
              onChange={(e) => setDraft((d) => ({ ...d, definition: e.target.value }))}
            />
          ) : (
            <p className="detail-p">{node.definition}</p>
          )}
        </section>

        <section className="detail-sec">
          <h3 className="detail-h3">📝 详细描述</h3>
          {editBase ? (
            <textarea
              className="detail-edit-area"
              rows={4}
              value={draft.description}
              onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
            />
          ) : (
            <p className="detail-p">{node.description}</p>
          )}
        </section>

        <div className="detail-tabs">
          {TABS.map((t) => (
            <button
              key={t.key}
              className={`detail-tab${tab === t.key ? ' active' : ''}`}
              onClick={() => setTab(t.key)}
            >
              <t.icon size={13} /> {t.label}
            </button>
          ))}
        </div>

        {tab === 'learn' && (
          <LearningPanel project={project} idx={idx} node={node} onSave={onUpdate} />
        )}

        {tab === 'metric' && (
          <div className="metric-list">
            <div className="metric-row">
              <span>难度</span><Stars n={node.difficulty} />
            </div>
            <div className="metric-row">
              <span>重要度</span>
              <span className="metric-val"><Bar pct={node.importance} color="#3B82F6" /><b>{node.importance}%</b></span>
            </div>
            <div className="metric-row">
              <span>枢纽度</span>
              <span className="metric-val"><Bar pct={node.centrality} color="#8B5CF6" /><b>{node.centrality}%</b></span>
            </div>
            <div className="metric-row">
              <span>建议学习时长</span>
              <span className="metric-time"><IconClock size={12} /> {node.studyMinutes} 分钟</span>
            </div>
          </div>
        )}

        {tab === 'rel' && (
          <div className="rel-list">
            <RelGroup title="前导知识" items={ins.map((e) => e.from)} idx={idx} onSelect={onSelect} empty="无（本节点是起点）" />
            <RelGroup title="后续知识" items={outs.map((e) => e.to)} idx={idx} onSelect={onSelect} empty="无（本节点是终点）" />
            <RelGroup title="相关参照" items={relates.map((e) => e.to)} idx={idx} onSelect={onSelect} empty="无" />
            {onAddNodes && (
              <ExpandPanel node={node} branchName={branch?.name} onAdd={onAddNodes} />
            )}
          </div>
        )}

        {tab === 'ex' && (
          <div className="detail-p" style={{ color: 'var(--text-3)' }}>
            {node.examples?.length ? (
              node.examples.map((e, i) => (
                <div key={i} className="detail-example">
                  <button className="detail-copy" onClick={() => void navigator.clipboard?.writeText(e)}>复制</button>
                  <pre className="detail-pre">{e}</pre>
                </div>
              ))
            ) : (
              '暂无示例。可在 YAML 的 examples 字段补充后重新导入。'
            )}
          </div>
        )}

        {tab === 'res' && (
          <ResourceTab node={node} branchName={branch?.name} onUpdate={onUpdate} />
        )}

        <div className="detail-sep" />

        <section className="detail-sec">
          <h3 className="detail-h3">🏷 维度标签</h3>
          <div className="detail-tags">
            {branch && (
              <span className="dtag" style={{ color: branch.color, borderColor: branch.color + '55', background: branch.color + '12' }}>
                <span className="dtag-dot" style={{ background: branch.color }} />
                {branch.name}
              </span>
            )}
            {node.tags.slice(1).map((t, i) => (
              <span key={i} className="dtag plain">{t}</span>
            ))}
            <span className="dtag plain" style={{ background: '#F0F2F6', color: 'var(--text-2)' }}>
              {DIFFICULTY_LABEL[node.difficulty]}
            </span>
          </div>
        </section>

        {route && (
          <section className="detail-sec">
            <h3 className="detail-h3">🗺 所属学习路线</h3>
            <div className="detail-route">
              <span className="detail-route-name">{route.name}</span>
              <span className="detail-route-stage">
                第 {route.stages.findIndex((s) => s.nodes.includes(node.id)) + 1} 阶段：
                {route.stages.find((s) => s.nodes.includes(node.id))?.name}
              </span>
            </div>
          </section>
        )}

        <div className="detail-foot-meta">
          <span className="mono">{node.id}</span>
          <span className="detail-level-badge">{node.level}{node.unit ? ` · ${node.unit}` : ''}</span>
        </div>
      </div>
    </div>
  );
}

/**
 * 定义可信度核验小徽标：点一下就跑 2 票 deep judge，把结论挂在这个节点上。
 * 结论不落盘（定义会变），只做当下提示；要留证据用「资源」页的联网补全。
 */
function VerifyChip({ node }: { node: KnowledgePoint }) {
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<{ text: string; color: string; title: string; conf?: number; reason?: string } | null>(null);

  const run = async () => {
    setBusy(true);
    setRes(null);
    try {
      const [r] = await verifyNodes([node], { samples: 2, limit: 1 });
      const badge = verifyBadge(r);
      setRes({ ...badge!, conf: r.judge.confidence, reason: r.judge.reason });
    } catch (e: any) {
      setRes({ text: '核验失败', color: 'var(--text-4)', title: String(e?.message ?? e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className="verify-chip-wrap">
      {res ? (
        <span className="verify-chip" style={{ color: res.color, borderColor: res.color + '66' }} title={res.title}>
          {res.text}
          {typeof res.conf === 'number' && res.conf > 0 ? ` ${res.conf.toFixed(2)}` : ''}
          <button className="verify-chip-redo" onClick={() => void run()} title="重新核验">
            <IconRefresh size={10} />
          </button>
        </span>
      ) : (
        <button className="verify-chip-btn" onClick={() => void run()} disabled={busy} title="联网核查这条定义是否与主流资料一致">
          {busy ? <IconRefresh size={11} /> : <IconCheck size={11} />} {busy ? '核验中…' : '核验定义'}
        </button>
      )}
    </span>
  );
}

/**
 * 资源标签页：原有 resources 展示 + 「联网补全」。
 * 联网补全会并发检索 3 个角度，按域名可信度排序，只把命中的前 N 条落盘。
 */
function ResourceTab({
  node, branchName, onUpdate,
}: {
  node: KnowledgePoint;
  branchName?: string;
  onUpdate: (patch: Partial<KnowledgePoint>) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [preview, setPreview] = useState<{ items: NodeResource[]; scores: number[]; summary: string; ms: number } | null>(null);

  const run = async () => {
    setBusy(true);
    setErr('');
    setPreview(null);
    try {
      const r = await enrichNode(node.name, {
        hints: [branchName, node.tags[0]].filter(Boolean) as string[],
        limit: 8,
        withSummary: true,
      });
      if (!r.resources.length) {
        setErr('没检索到高可信资料，换个更具体的关键词再试');
      } else {
        setPreview({ items: r.resources, scores: r.scores, summary: r.summary, ms: r.elapsedMs });
      }
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
  };

  const apply = () => {
    if (!preview) return;
    const merged = [...(node.resources ?? [])];
    for (const it of preview.items) {
      if (!merged.some((m) => (m.url && it.url && m.url === it.url) || m.title === it.title)) merged.push(it);
    }
    onUpdate({
      resources: merged.slice(0, 20),
      ...(preview.summary && !node.examples?.length ? { examples: [preview.summary] } : {}),
    });
    setPreview(null);
  };

  return (
    <div className="detail-p" style={{ color: 'var(--text-3)' }}>
      {netAvailable() && (
        <div className="res-bar">
          <button className="learn-btn" onClick={() => void run()} disabled={busy}>
            {busy ? <IconRefresh size={13} /> : <IconSearch size={13} />}
            {busy ? '联网检索中…' : '联网补全资料'}
          </button>
          {busy && <span className="res-hint">3 个角度并发检索，约 5–15s</span>}
        </div>
      )}

      {err && <div className="learn-err">{err}</div>}

      {preview && (
        <div className="res-preview">
          <div className="res-preview-head">
            <IconSparkle size={13} /> 检索到 {preview.items.length} 条（{Math.round(preview.ms / 1000)}s，按可信度排序）
          </div>
          {preview.summary && <p className="res-summary">{preview.summary}</p>}
          {preview.items.map((r, i) => (
            <div key={i} className="detail-res">
              <span className="res-score" title="可信度分">{preview.scores[i]}</span>
              {r.url ? (
                <a
                  href={r.url}
                  onClick={(e) => {
                    if (desktop) {
                      e.preventDefault();
                      void desktop.openExternal(r.url!);
                    }
                  }}
                  target="_blank"
                  rel="noreferrer"
                >
                  {r.title}
                </a>
              ) : (
                <span>{r.title}</span>
              )}
              <span className="detail-res-type">{r.type}</span>
            </div>
          ))}
          <div className="res-preview-foot">
            <button className="learn-btn primary" onClick={apply}><IconCheck size={13} /> 采纳并保存到项目</button>
            <button className="learn-btn" onClick={() => setPreview(null)}>放弃</button>
          </div>
        </div>
      )}

      {!preview && (node.resources?.length
        ? node.resources.map((r, i) => (
            <div key={i} className="detail-res">
              {r.url ? (
                <a
                  href={r.url}
                  onClick={(e) => {
                    if (desktop) {
                      e.preventDefault();
                      void desktop.openExternal(r.url!);
                    }
                  }}
                  target="_blank"
                  rel="noreferrer"
                >
                  {r.title}
                </a>
              ) : (
                <span>{r.title}</span>
              )}
              <span className="detail-res-type">{r.type}</span>
            </div>
          ))
        : (
          <div className="res-empty">
            <IconAlert size={13} />
            暂无资源。点上方「联网补全资料」自动检索，或在 YAML 的 resources 字段手写书名 / 链接 / 课程。
          </div>
        ))}
    </div>
  );
}

/**
 * 联网扩展子节点：种子节点 → 并发检索 → 候选概念（带定义与来源）→ 勾选 → 并入思维导图。
 */
function ExpandPanel({
  node, branchName, onAdd,
}: {
  node: KnowledgePoint;
  branchName?: string;
  onAdd: (nodes: KnowledgePoint[]) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [res, setRes] = useState<{ seed: string; proposed: ProposedNode[]; ms: number } | null>(null);
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [done, setDone] = useState('');

  const run = async () => {
    setBusy(true);
    setErr('');
    setRes(null);
    setDone('');
    try {
      const r = await expandNode(node, { context: branchName, max: 8 });
      if (!r.proposed.length) {
        setErr('没抽到有效候选概念，换个更具体的节点再试');
      } else {
        setRes({ seed: r.seed, proposed: r.proposed, ms: r.elapsedMs });
        setPicked(Object.fromEntries(r.proposed.map((p) => [p.name, true])));
      }
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
  };

  const apply = () => {
    if (!res) return;
    const sel = res.proposed.filter((p) => picked[p.name]);
    if (!sel.length) return;
    const fieldId = typeof node.dimensions?.field === 'string' ? node.dimensions.field : undefined;
    const nodes = toKnowledgePoints(node, sel, fieldId ?? '');
    onAdd(nodes);
    setDone(`已并入 ${sel.length} 个节点到「${node.name}」下，图谱与导图已更新`);
    setRes(null);
    setPicked({});
  };

  const selCount = Object.values(picked).filter(Boolean).length;

  return (
    <div className="expand">
      <div className="expand-head">
        <span className="expand-title"><IconSparkle size={13} /> 联网扩展子节点</span>
        {netAvailable() && (
          <button className="learn-btn" onClick={() => void run()} disabled={busy}>
            {busy ? <IconRefresh size={13} /> : <IconSearch size={13} />}
            {busy ? '联网检索中…' : '联网扩展'}
          </button>
        )}
      </div>

      {busy && <div className="expand-hint">3 个角度并发检索 + 并发生成定义，约 15–30s</div>}
      {err && <div className="learn-err">{err}</div>}
      {done && <div className="learn-saved"><IconCheck size={12} /> {done}</div>}

      {res && (
        <div className="expand-result">
          <div className="expand-result-head">
            「{res.seed}」候选 {res.proposed.length} 个（{Math.round(res.ms / 1000)}s）
            <button
              className="expand-all"
              onClick={() => setPicked(Object.fromEntries(res.proposed.map((p) => [p.name, selCount !== res.proposed.length])))}
            >
              {selCount === res.proposed.length ? '全不选' : '全选'}
            </button>
          </div>

          {res.proposed.map((p) => (
            <label key={p.name} className={`expand-item${picked[p.name] ? ' on' : ''}`}>
              <input
                type="checkbox"
                checked={!!picked[p.name]}
                onChange={(e) => setPicked((m) => ({ ...m, [p.name]: e.target.checked }))}
              />
              <span className="expand-item-body">
                <span className="expand-item-name">
                  {p.name}
                  <span className="expand-item-hits" title="在检索结果中出现的次数">×{p.hits}</span>
                  {p.sources.length > 0 && <span className="expand-item-src" title={p.sources.join('\n')}>{p.sources.length} 源</span>}
                </span>
                <span className="expand-item-def">{p.definition}</span>
              </span>
            </label>
          ))}

          <div className="expand-foot">
            <button className="learn-btn primary" onClick={apply} disabled={!selCount}>
              <IconPlus size={13} /> 并入 {selCount} 个节点
            </button>
            <button className="learn-btn" onClick={() => setRes(null)}>取消</button>
          </div>
        </div>
      )}

      {!res && !busy && (
        <div className="expand-hint">
          以当前节点为种子联网调研，抽出该领域真实在用的下级概念并补一句话定义；勾选后直接并入思维导图 / 图谱 / 学习路线。
        </div>
      )}
    </div>
  );
}

function RelGroup({
  title, items, idx, onSelect, empty,
}: {
  title: string; items: string[]; idx: ProjectIndex; onSelect: (id: string) => void; empty: string;
}) {
  return (
    <div className="rel-group">
      <div className="rel-title">{title} <span className="rel-count">{items.length}</span></div>
      {items.length === 0 ? (
        <div className="rel-empty">{empty}</div>
      ) : (
        <div className="rel-chips">
          {items.slice(0, 30).map((id) => {
            const n = idx.byId.get(id);
            if (!n) return null;
            const b = idx.branchById.get(n.branch);
            return (
              <button key={id} className="rel-chip" onClick={() => onSelect(id)} style={{ borderColor: b?.color + '55' }}>
                <span className="rel-chip-dot" style={{ background: b?.color }} />
                {n.name}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
