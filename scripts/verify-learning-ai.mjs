/**
 * 针对真实项目的「学习」页 AI 生成验证（默认：营销神经学 / 营销神经学实践）
 * 用法：node scripts/verify-learning-ai.mjs   （需要 Electron 已起在 9444）
 * 可用 PROJECT_ID / NODE_NAME 环境变量改目标
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const OUT = process.env.OUT || join(tmpdir(), 'knowledge-viz-shots');
const PORT = Number(process.env.PORT || 9444);
const PROJECT_ID = process.env.PROJECT_ID || '营销神经学';
const NODE_NAME = process.env.NODE_NAME || '营销神经学实践';
mkdirSync(OUT, { recursive: true });

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const target = list.find((t) => t.type === 'page');
if (!target) throw new Error('no electron page target');

class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map(); this.errors = [];
    ws.addEventListener('message', (e) => {
      const m = JSON.parse(e.data);
      if (m.id && this.pending.has(m.id)) {
        const p = this.pending.get(m.id); this.pending.delete(m.id);
        m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result);
      } else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
        this.errors.push((m.params.args ?? []).map((a) => a.value ?? a.description).join(' '));
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((res, rej) => { this.pending.set(id, { res, rej }); this.ws.send(JSON.stringify({ id, method, params })); });
  }
}

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
const cdp = new CDP(ws);
await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
const ev = async (e) => (await cdp.send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })).result?.value;
const shot = async (n) => { const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(OUT, `${n}.png`), Buffer.from(data, 'base64')); console.log('shot', n); };

await cdp.send('Page.reload', { ignoreCache: true });
await sleep(3000);
await ev(`location.hash = '#/project/' + encodeURIComponent(${JSON.stringify(PROJECT_ID)})`);
await sleep(2500);
console.log('desktop?', await ev(`Boolean(window.ksb && window.ksb.isDesktop)`));

const picked = await ev(`(() => {
  const r = [...document.querySelectorAll('.tree-row')].find(x => x.textContent.trim().startsWith(${JSON.stringify(NODE_NAME)}));
  r?.click();
  return r?.textContent?.trim().slice(0, 40) ?? null;
})()`);
console.log('picked:', picked);
if (!picked) throw new Error('没找到节点 ' + NODE_NAME);
await sleep(800);
await ev(`[...document.querySelectorAll('.detail-tab')].find(t => t.textContent.includes('学习'))?.click()`);
await sleep(500);

const scoreBefore = await ev(`document.querySelector('.learn-quality-score')?.textContent`);
const srcBefore = await ev(`document.querySelector('.learn-quality-src')?.textContent`);
console.log('before:', scoreBefore, '|', srcBefore);

const t0 = Date.now();
await ev(`[...document.querySelectorAll('.learn-btn')].find(b => b.textContent.includes('AI 重写'))?.click()`);

let state = null;
for (let i = 0; i < 300; i++) {
  await sleep(1000);
  state = await ev(`(() => ({
    busy: !!document.querySelector('.learn-progress'),
    editing: !!document.querySelector('.learn-edit'),
    err: document.querySelector('.learn-err')?.innerText ?? '',
    score: document.querySelector('.learn-quality-score')?.textContent ?? '',
  }))()`);
  if (!state.busy && (state.editing || state.err)) break;
}
console.log(`生成耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s →`, JSON.stringify(state));

const content = await ev(`(() => {
  const secs = [...document.querySelectorAll('.learn-sec-edit')].map(d => ({
    title: d.querySelector('.learn-input')?.value,
    body: d.querySelector('textarea')?.value,
  }));
  const areas = [...document.querySelectorAll('.learn-textarea')].map(t => t.value);
  return { goals: areas[0] ?? '', secs, practice: areas[areas.length - 3] ?? '', pitfalls: areas[areas.length - 2] ?? '', further: areas[areas.length - 1] ?? '' };
})()`);
console.log('\n=== 学完能做到 ===\n' + content.goals);
for (const s of content.secs ?? []) console.log(`\n=== ${s.title} (${s.body.length} 字) ===\n${s.body}`);
console.log('\n=== 动手练习 ===\n' + content.practice);
console.log('\n=== 常见误区 ===\n' + content.pitfalls);
console.log('\n=== 下一步 ===\n' + content.further);

const sug = await ev(`document.querySelector('.learn-suggest')?.innerText ?? ''`);
console.log('\n=== 建议定义 ===\n' + sug.slice(0, 400));

const issues = await ev(`(() => {
  const d = document.querySelector('.learn-issues');
  return d ? d.innerText.slice(0, 400) : null;
})()`);
console.log('\n=== 质检问题 ===\n' + (issues ?? '无'));

await shot('mn-learning-editing');

await ev(`[...document.querySelectorAll('.learn-btn')].find(b => b.textContent.includes('保存'))?.click()`);
await sleep(1200);
console.log('\nafter save:', await ev(`document.querySelector('.learn-quality-score')?.textContent`), '|', await ev(`document.querySelector('.learn-quality-src')?.textContent`));
await shot('mn-learning-saved');
console.log('console errors:', cdp.errors.slice(0, 3));
ws.close();
