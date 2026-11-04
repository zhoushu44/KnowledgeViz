import { useState } from 'react';
import { IconClose, IconCheck, IconRefresh } from './Icons';
import { loadLlmConfig, saveLlmConfig, LLM_PRESETS, type LlmConfig } from '../lib/llm';

/** 模型设置：可改接口地址 / key / 模型名，写入 localStorage（不影响内置默认值） */
export default function ModelSettingsModal({ onClose }: { onClose: () => void }) {
  const [cfg, setCfg] = useState<LlmConfig>(() => loadLlmConfig());
  const [saved, setSaved] = useState(false);
  const [testing, setTesting] = useState<'idle' | 'running' | 'ok' | 'fail'>('idle');
  const [testMsg, setTestMsg] = useState('');

  const patch = (p: Partial<LlmConfig>) => {
    setCfg((c) => ({ ...c, ...p }));
    setSaved(false);
  };

  const save = () => {
    saveLlmConfig(cfg);
    setSaved(true);
    setTimeout(() => setSaved(false), 1600);
  };

  const test = async () => {
    setTesting('running');
    setTestMsg('');
    const t0 = Date.now();
    try {
      const res = await fetch(`${cfg.baseUrl.replace(/\/$/, '')}/models`, {
        headers: { Authorization: `Bearer ${cfg.apiKey}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setTesting('ok');
      setTestMsg(`连通正常 · ${Date.now() - t0}ms`);
    } catch (e: any) {
      setTesting('fail');
      setTestMsg(`连接失败：${String(e?.message ?? e)}（浏览器预览受 CORS 限制，桌面版不受影响）`);
    }
  };

  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal" style={{ width: 560 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span>内置大模型设置</span>
          <button className="modal-x" onClick={onClose}><IconClose size={16} /></button>
        </div>
        <div className="modal-body">
          <p className="modal-tip">
            生成知识体系时调用 OpenAI 兼容接口。默认使用内置代理与 deepseek-v4-flash；如需换模型，可在下方修改或点选预设。
            该代理会丢弃 system 消息，程序已自动把系统指令并入 user 消息。
          </p>

          <label className="flabel">接口地址（baseURL）</label>
          <input className="input" value={cfg.baseUrl} onChange={(e) => patch({ baseUrl: e.target.value })} placeholder="http://host:port/v1" />

          <label className="flabel" style={{ marginTop: 14 }}>API Key</label>
          <input className="input" type="password" value={cfg.apiKey} onChange={(e) => patch({ apiKey: e.target.value })} placeholder="sk-…" />

          <label className="flabel" style={{ marginTop: 14 }}>模型</label>
          <input className="input" value={cfg.model} onChange={(e) => patch({ model: e.target.value })} placeholder="model id" />
          <div className="preset-row">
            {LLM_PRESETS.map((p) => (
              <button
                key={p.model}
                className={`preset-chip${cfg.model === p.model ? ' on' : ''}`}
                onClick={() => patch({ model: p.model })}
              >
                {p.label}
              </button>
            ))}
          </div>

          <div className="preset-grid">
            <label>
              <span className="flabel">temperature</span>
              <input
                className="input"
                type="number"
                step="0.1"
                min="0"
                max="1"
                value={cfg.temperature}
                onChange={(e) => patch({ temperature: Number(e.target.value) })}
              />
            </label>
            <label>
              <span className="flabel">max_tokens</span>
              <input
                className="input"
                type="number"
                step="1000"
                min="1000"
                max="32000"
                value={cfg.maxTokens}
                onChange={(e) => patch({ maxTokens: Number(e.target.value) })}
              />
            </label>
          </div>

          <label className="preset-check">
            <input
              type="checkbox"
              checked={cfg.stream !== false}
              onChange={(e) => patch({ stream: e.target.checked })}
            />
            流式返回（代理较慢时建议关闭）
          </label>

          {testMsg && (
            <div className={`model-test${testing === 'ok' ? ' ok' : testing === 'fail' ? ' fail' : ''}`}>{testMsg}</div>
          )}
        </div>
        <div className="modal-foot">
          <button className="btn btn-ghost" style={{ marginRight: 'auto' }} onClick={() => void test()} disabled={testing === 'running'}>
            <IconRefresh size={15} /> {testing === 'running' ? '测试中…' : '测试连接'}
          </button>
          <button className="btn btn-ghost" onClick={onClose}>关闭</button>
          <button className="btn btn-primary" onClick={save}>
            {saved ? <IconCheck size={15} /> : null} {saved ? '已保存' : '保存'}
          </button>
        </div>
      </div>
    </div>
  );
}
