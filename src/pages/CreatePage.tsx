import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from '../store/router';
import { useProjects } from '../store/projects';
import type { Category, Project } from '../lib/types';
import { CategoryPicker } from '../components/ImportModal';
import { IconChevronLeft, IconSparkle, IconCheck, IconClose, IconFile, IconAlert, IconRefresh } from '../components/Icons';
import { PROMPT_TEMPLATE, looksLikePrompt } from '../lib/prompt';
import { generateProject } from '../lib/generate';
import { isDesktop } from '../lib/desktop';

const EXAMPLES = [
  '建立一个金融学知识体系，涵盖货币市场、投资学、公司金融、风险管理、资产定价、金融衍生品、国际金融等核心领域。面向金融专业学生和从业者。',
  '构建一个前端工程知识体系，覆盖 HTML/CSS、JavaScript、框架、工程化、性能优化、浏览器原理与跨端方案，面向 1-3 年经验的前端工程师。',
  '输出西方哲学知识体系，从古希腊到现代哲学，包括核心的哲学思想、哲学家、哲学著作，按时期作为一级分类。',
];

/** 生成阶段（真实管线：联网检索 → 领域骨架 → 知识树 → 关系网络 → 学习路线 → 校验） */
const STEPS = [
  { key: 'web', label: '联网检索', pct: 4 },
  { key: 'skeleton', label: '领域骨架', pct: 10 },
  { key: 'tree', label: '知识树', pct: 55 },
  { key: 'relation', label: '关系网络', pct: 78 },
  { key: 'route', label: '学习路线', pct: 90 },
  { key: 'validate', label: '校验', pct: 96 },
] as const;

type StepKey = (typeof STEPS)[number]['key'] | 'repair';

export default function CreatePage() {
  const { back, push } = useRouter();
  const { projects, addProject } = useProjects();

  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [cat, setCat] = useState<Category>('学科知识');
  const [errors, setErrors] = useState<{ name?: string; desc?: string }>({});
  const [gen, setGen] = useState<{
    running: boolean;
    step: StepKey | '';
    detail: string;
    chars: number;
  }>({ running: false, step: '', detail: '', chars: 0 });
  const [failMsg, setFailMsg] = useState('');
  const [failIssues, setFailIssues] = useState<{ file: string; message: string; line?: number }[]>([]);
  const [promptOpen, setPromptOpen] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const validate = () => {
    const e: typeof errors = {};
    if (!name.trim()) e.name = '请输入项目名称';
    else if (name.trim().length < 2 || name.trim().length > 40) e.name = '项目名称需 2–40 字';
    else if (/[\\/:*?"<>|]/.test(name)) e.name = '不能包含 \\ / : * ? " < > | 等字符';
    else if (projects.some((p) => p.name === name.trim())) e.name = '已存在同名项目';
    if (!desc.trim()) e.desc = '请描述领域范围';
    else if (desc.trim().length < 30) e.desc = `还需要 ${30 - desc.trim().length} 字（至少 30 字）`;
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const start = async () => {
    if (!validate()) return;
    setFailMsg('');
    setFailIssues([]);
    const controller = new AbortController();
    abortRef.current = controller;
    setGen({ running: true, step: 'skeleton', detail: '', chars: 0 });

    try {
      const input = { name: name.trim(), description: desc.trim(), category: cat };
      const res = await generateProject(input, {
        signal: controller.signal,
        onStage: (stage, detail) => setGen((g) => ({ ...g, step: stage, detail: detail ?? g.detail })),
        onDelta: (chars) => setGen((g) => ({ ...g, chars })),
      });
      if (res.ok && res.project) {
        const p: Project = {
          ...res.project,
          stats: {
            nodes: res.project.nodes.length,
            edges: res.project.edges.length,
            branches: res.project.branches.length,
          },
        };
        addProject(p);
        push({ name: 'workspace', projectId: p.id });
        return;
      }
      setFailIssues(res.issues);
      setFailMsg('生成失败：输出未通过校验，可重试或改用 YAML 导入');    } catch (e: any) {
      if (e?.name === 'AbortError') {
        setFailMsg('');
      } else if (String(e?.message).includes('Failed to fetch') || String(e?.message).includes('HTTP')) {
        setFailMsg(`生成失败：模型接口不可用（${e?.message}）。可在“模型设置”里改接口，或改用 YAML 导入`);
      } else {
        setFailMsg(`生成失败：${e?.message ?? e}，可重试或改用 YAML 导入`);
      }
    } finally {
      abortRef.current = null;
      setGen({ running: false, step: '', detail: '', chars: gen.chars });
    }
  };

  const cancel = () => {
    abortRef.current?.abort();
    setGen({ running: false, step: '', detail: '', chars: 0 });
  };

  const fillPrompt = () => {
    const filled = PROMPT_TEMPLATE
      .replace('{{领域名称}}', name.trim() || '（填写领域名称）')
      .replace('{{一句话定义}}', desc.trim() || '（一句话说明这个领域解决什么问题）')
      .replace('{{涵盖范围}}', '（列出 5–9 个核心主题）')
      .replace('{{目标受众}}', '（填写目标读者）')
      .replace('{{应用场景}}', '（填写使用场景）');
    setDesc(filled);
    setErrors((x) => ({ ...x, desc: undefined }));
    setPromptOpen(false);
  };

  const pct = useMemo(() => {
    if (gen.step === 'repair') return 74;
    const hit = STEPS.find((s) => s.key === gen.step);
    return hit ? hit.pct : 0;
  }, [gen.step]);

  if (gen.running) {
    return (
      <div className="create">
        <div className="create-top">
          <button className="btn-text" onClick={cancel}><IconChevronLeft size={15} /> 取消生成</button>
        </div>
        <div className="gen-wrap">
          <div className="gen-orb" style={{ ['--p' as any]: `${pct}%` }}>
            <IconSparkle size={26} />
          </div>
          <h2 className="gen-title">AI 正在构建知识体系</h2>
          <div className="gen-sub">{name}</div>

          <div className="gen-bar">
            <div className="gen-bar-fill" style={{ width: `${pct}%` }} />
          </div>
          <div className="gen-meta">
            <span>
              {gen.step === 'repair'
                ? `校验未通过，正在自修复（${gen.detail || '第 1 次'}）…`
                : `正在生成：${STEPS.find((s) => s.key === gen.step)?.label ?? '领域骨架'}…`}
            </span>
            <span className="mono">{gen.chars ? `${(gen.chars / 1000).toFixed(1)}k 字` : `${pct}%`}</span>
          </div>

          <div className="gen-steps">
            {STEPS.map((s) => {
              const done = pct > s.pct;
              const active = gen.step === s.key;
              return (
                <div key={s.key} className={`gen-step${done ? ' done' : ''}${active ? ' active' : ''}`}>
                  <span className="gen-step-dot">{done ? <IconCheck size={11} /> : null}</span>
                  {s.label}
                </div>
              );
            })}
          </div>

          <p className="gen-hint">内置大模型 + 联网检索依据 · 可随时取消，已填内容不会丢失</p>
        </div>
      </div>
    );
  }

  return (
    <div className="create">
      <div className="create-top">
        <button className="btn-text" onClick={back}><IconChevronLeft size={15} /> 返回</button>
        <span className="create-top-title">创建新项目</span>
      </div>

      <div className="create-wrap">
        <div className="create-hero">
          <div className="create-hero-icon"><IconSparkle size={26} /></div>
          <h1 className="create-hero-title">AI 生成知识体系</h1>
          <p className="create-hero-sub">输入项目名称和领域描述，AI 将自动生成完整的 KSB-YAML 知识体系文件</p>
        </div>

        <label className="flabel">项目名称</label>
        <input
          className={`input${errors.name ? ' error' : ''}`}
          value={name}
          onChange={(e) => { setName(e.target.value); setErrors((x) => ({ ...x, name: undefined })); }}
          placeholder="例如：人工智能知识体系"
          maxLength={40}
        />
        {errors.name && <div className="form-err">{errors.name}</div>}

        <div className="flabel-row">
          <label className="flabel" style={{ marginTop: 20 }}>领域描述</label>
          <button className="prompt-trigger" onClick={() => setPromptOpen(true)}>
            <IconFile size={13} /> 内置构建提示词
          </button>
        </div>
        <div className="textarea-wrap">
          <textarea
            className={`input${errors.desc ? ' error' : ''}`}
            style={{ height: 150, padding: '10px 12px', resize: 'vertical', lineHeight: 1.7 }}
            value={desc}
            onChange={(e) => { setDesc(e.target.value); setErrors((x) => ({ ...x, desc: undefined })); }}
            placeholder={`请描述您要建立的知识体系领域，包括：核心主题、涵盖范围、主要分支、目标受众、应用场景等。例如：\n${EXAMPLES[0]}`}
            maxLength={6000}
          />
          <span className="textarea-count">
            {desc.length}/6000{looksLikePrompt(desc) ? ' · 提示词模式' : ''}
          </span>
        </div>
        {errors.desc && <div className="form-err">{errors.desc}</div>}

        <div className="create-examples">
          <span className="create-examples-label">示例：</span>
          {['金融学', '前端工程', '西方哲学'].map((k, i) => (
            <button key={k} className="create-example" onClick={() => { setDesc(EXAMPLES[i]); setErrors((x) => ({ ...x, desc: undefined })); }}>
              {k}
            </button>
          ))}
        </div>

        <label className="flabel" style={{ marginTop: 24 }}>知识体系分类</label>
        <CategoryPicker value={cat} onChange={setCat} />

        <button className="btn btn-primary create-submit" onClick={() => void start()}>
          <IconSparkle size={16} /> 开始生成知识体系
        </button>

        {failMsg && <div className="form-err" style={{ textAlign: 'center' }}>{failMsg}</div>}
        {failIssues.length > 0 && (
          <div className="import-issues" style={{ marginTop: 10 }}>
            <div className="import-issues-head"><IconAlert size={14} /> 校验问题（{failIssues.length}）</div>
            <ul>
              {failIssues.slice(0, 6).map((i, k) => (
                <li key={k}><b>{i.file}</b>：{i.message}</li>
              ))}
            </ul>
          </div>
        )}

        <p className="create-foot">
          {isDesktop()
            ? '内置大模型 deepseek-v4-flash · 产出 domain / dimensions / knowledge_points / relation_types / scenarios 五个 YAML 文件并写入本地 projects 目录'
            : '浏览器预览模式：模型调用需桌面版（Electron）代理，或改用 YAML 导入'}
        </p>
      </div>

      {promptOpen && (
        <PromptModal
          name={name}
          desc={desc}
          onClose={() => setPromptOpen(false)}
          onApply={fillPrompt}
        />
      )}
    </div>
  );
}

function PromptModal({
  name, desc, onClose, onApply,
}: {
  name: string;
  desc: string;
  onClose: () => void;
  onApply: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const preview = PROMPT_TEMPLATE
    .replace('{{领域名称}}', name.trim() || '（填写领域名称）')
    .replace('{{一句话定义}}', desc.trim() || '（一句话说明这个领域解决什么问题）')
    .replace('{{涵盖范围}}', '（列出 5–9 个核心主题）')
    .replace('{{目标受众}}', '（填写目标读者）')
    .replace('{{应用场景}}', '（填写使用场景）');

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(preview);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal" style={{ width: 720 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span>知识体系构建提示词（内置）</span>
          <button className="modal-x" onClick={onClose}><IconClose size={16} /></button>
        </div>
        <div className="modal-body">
          <p className="modal-tip">
            这是产品内置的生成内核：AI 按它输出 5 个 KSB-YAML 文件。点击「套用到领域描述」会把占位符替换为当前填写内容，你也可以直接改写再生成。
          </p>
          <pre className="prompt-preview">{preview}</pre>
        </div>
        <div className="modal-foot">
          <button className="btn btn-ghost" style={{ marginRight: 'auto' }} onClick={() => void copy()}>
            {copied ? <IconCheck size={15} /> : <IconRefresh size={15} />} {copied ? '已复制' : '复制提示词'}
          </button>
          <button className="btn btn-ghost" onClick={onClose}>取消</button>
          <button className="btn btn-primary" onClick={onApply}>套用到领域描述</button>
        </div>
      </div>
    </div>
  );
}
