/**
 * Electron 真实生成链路验证：新建项目 → 真模型生成 → 进入工作台
 * 用法：先启动 Electron（带 --remote-debugging-port=9444），再 node scripts/verify-electron-gen.mjs
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const OUT = process.env.OUT || join(tmpdir(), 'knowledge-viz-shots');
mkdirSync(OUT, { recursive: true });
const list = await (await fetch('http://127.0.0.1:9444/json/list')).json();
const target = list.find((t) => t.type === 'page');
if (!target) throw new Error('no page');

class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map(); this.errors = [];
    ws.addEventListener('message', (e) => {
      const m = JSON.parse(e.data);
      if (m.id && this.pending.has(m.id)) { const p = this.pending.get(m.id); this.pending.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); }
      else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') this.errors.push((m.params.args ?? []).map((a) => a.value ?? a.description).join(' '));
    });
  }
  send(method, params = {}) { const id = ++this.id; return new Promise((res, rej) => { this.pending.set(id, { res, rej }); this.ws.send(JSON.stringify({ id, method, params })); }); }
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
const cdp = new CDP(ws);
await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
const ev = async (e) => (await cdp.send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })).result?.value;
const shot = async (n) => { const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' }); writeFileSync(`${OUT}\\${n}.png`, Buffer.from(data, 'base64')); console.log('shot', n); };

const NAME = `数据治理${Date.now().toString().slice(-4)}`;
await ev(`location.hash = '#/create'`);
await sleep(2200);
await ev(`(() => {
  const ins = [...document.querySelectorAll('.create-wrap input.input')];
  const ta = document.querySelector('.create-wrap textarea.input');
  const setV = (el, v) => { Object.getOwnPropertyDescriptor(el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };
  setV(ins[0], ${JSON.stringify(NAME)});
  setV(ta, '构建一个企业数据治理知识体系，覆盖数据标准、数据质量、元数据、主数据、数据安全与数据生命周期，面向数据治理从业者与转岗人员，用于企业数据治理体系落地。');
  return ins[0].value;
})()`);
await sleep(400);
console.log('form filled for:', NAME);
await shot('gen-00-form');

const t = Date.now();
await ev(`[...document.querySelectorAll('.create-wrap button')].find(b => b.innerText.includes('开始生成'))?.click()`);
await sleep(1500);

let lastStage = '';
for (let i = 0; i < 480; i++) {
  const st = await ev(`(() => ({ path: location.hash, genTitle: document.querySelector('.gen-title')?.innerText ?? '', step: document.querySelector('.gen-meta')?.innerText ?? '', err: document.querySelector('.form-err')?.innerText ?? '' }))()`);
  if (st.step && st.step !== lastStage) { lastStage = st.step; console.log(`  [${((Date.now() - t) / 1000).toFixed(0)}s] ${st.step.replace(/\n/g, ' ')}`); }
  if (st.path.includes('/project/')) { console.log('  -> entered workspace at', ((Date.now() - t) / 1000).toFixed(0), 's'); break; }
  if (st.err) { console.log('  ERROR:', st.err); break; }
  if (i % 20 === 0) await shot(`gen-01-progress-${Math.floor(i / 20)}`);
  await sleep(1000);
}

await sleep(3000);
console.log('hash:', await ev(`location.hash`));
console.log('project name:', await ev(`document.querySelector('.ws-proj-name')?.innerText`));
console.log('status:', (await ev(`document.querySelector('.ws-status')?.innerText`))?.replace(/\n/g, ' '));
console.log('mm nodes:', await ev(`document.querySelectorAll('.mm-node').length`));
console.log('tree rows:', await ev(`document.querySelectorAll('.tree-row').length`));
await shot('gen-02-workspace');
console.log('elapsed:', ((Date.now() - t) / 1000).toFixed(0), 's');
console.log('errors:', cdp.errors.slice(0, 3));
ws.close();
