/**
 * 导图页 AI 面板：逐条勾选 + 多级撤回 的端到端验证
 * 用法：先起静态服务（vite preview --port 4177），再 node scripts/verify-adjust.mjs
 */
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

// 本机 Chrome/Chromium 路径：用环境变量 CHROME 指定，留空则自动探测常见位置
const CHROME =
  process.env.CHROME ||
  ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
   'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
   '/usr/bin/google-chrome',
   '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find((p) => existsSync(p)) ||
  'chrome';
const OUT = process.env.OUT || join(tmpdir(), 'knowledge-viz-shots');
const BASE = process.env.BASE ?? 'http://localhost:4177';
const SHOT = process.env.SHOT === '1';
mkdirSync(OUT, { recursive: true });

class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map(); this.errors = [];
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
      } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
        this.errors.push((msg.params.args ?? []).map((a) => a.value ?? a.description).join(' '));
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); this.ws.send(JSON.stringify({ id, method, params })); });
  }
}

const port = 9341;
const proc = spawn(CHROME, ['--headless=new','--disable-gpu','--hide-scrollbars','--no-first-run',`--remote-debugging-port=${port}`,`--user-data-dir=${join(tmpdir(), 'chrome-prof-verify')}`,'--window-size=1920,1080','about:blank'], { stdio: 'ignore' });
let target;
for (let i = 0; i < 40; i++) { await sleep(400); try { const r = await fetch(`http://127.0.0.1:${port}/json/list`); target = (await r.json()).find((t) => t.type === 'page'); if (target) break; } catch {} }
if (!target) throw new Error('no target');

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
const cdp = new CDP(ws);
await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
const ev = async (e) => (await cdp.send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })).result?.value;
const shot = async (n) => { const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' }); writeFileSync(`${OUT}\\${n}.png`, Buffer.from(data, 'base64')); console.log('shot', n); };
const fail = (m) => { console.error('FAIL', m); process.exitCode = 1; };

await cdp.send('Page.navigate', { url: `${BASE}/#/project/ai` });
await sleep(3000);

const count = () => ev(`document.querySelectorAll('.tree-row').length`);
const mm = () => ev(`document.querySelectorAll('.mm-node').length`);
const nodeName = (id) => ev(`(() => {
  const p = JSON.parse(localStorage.getItem('ksb.projects.v1') || '[]').find(x => x.id === 'ai');
  return p?.nodes.find(n => n.id === ${JSON.stringify(id)})?.name ?? document.querySelector('[data-tree-id="' + ${JSON.stringify(id)} + '"]')?.innerText ?? null;
})()`);
const before = await count();
console.log('nodes before:', before, 'mm:', await mm());

await ev(`document.querySelector('.mm-ai-fab').click()`);
await sleep(300);
if (!(await ev(`!!document.querySelector('.mm-ai')`))) fail('面板没打开');
await ev(`[...document.querySelectorAll('.tree-row')].find(x => x.textContent.includes('自动推理'))?.click()`);
await sleep(300);
await ev(`(() => { const ta = document.querySelector('.mm-ai-input textarea'); Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set.call(ta, '把这个分支拆细'); ta.dispatchEvent(new Event('input',{bubbles:true})); ta.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true})); })()`);
for (let i = 0; i < 30; i++) { if (await ev(`!!document.querySelector('.mm-ai-plan')`)) break; await sleep(400); }
if (!(await ev(`!!document.querySelector('.mm-ai-plan')`))) fail('没有出改动清单');

const boxes = await ev(`document.querySelectorAll('.mm-ai-step input[type=checkbox]').length`);
console.log('checkbox count:', boxes);
if (SHOT) await shot('aj-05-checklist');

// 只勾前 2 条
await ev(`(() => {
  const cbs = [...document.querySelectorAll('.mm-ai-step input[type=checkbox]')];
  for (let i = 2; i < cbs.length; i++) { if (cbs[i].checked) cbs[i].click(); }
  return cbs.filter(c => c.checked).length;
})()`);
await sleep(600);
const pickedLabel = await ev(`document.querySelector('.mm-ai-apply')?.innerText`);
console.log('apply button:', pickedLabel);
if (!/应用选中的 2 条/.test(pickedLabel ?? '')) fail('按钮文案未反映勾选数量');
const headText = await ev(`document.querySelector('.mm-ai-plan-head')?.innerText`);
console.log('plan head after uncheck:', headText);

// 点「全选」
await ev(`document.querySelector('.mm-ai-selall')?.click()`);
await sleep(400);
console.log('after select-all:', await ev(`document.querySelector('.mm-ai-apply')?.innerText`));
// 再取消第 3 条之后，只留 2 条
await ev(`(() => {
  const cbs = [...document.querySelectorAll('.mm-ai-step input[type=checkbox]')];
  for (let i = 2; i < cbs.length; i++) if (cbs[i].checked) cbs[i].click();
})()`);
await sleep(400);
await ev(`document.querySelector('.mm-ai-apply')?.click()`);
await sleep(1500);

const after = await count();
console.log('nodes after:', after, 'delta:', after - before, 'mm:', await mm());
if (after - before !== 2) fail(`应用条数不对：期望 +2，实际 +${after - before}`);
if (!(await ev(`!!document.querySelector('.mm-ai-undo')`))) fail('没有出现撤回条');
if (SHOT) await shot('aj-06-applied-2');

// 再走一次另一句（改名），验证撤回栈 2 步
await ev(`(() => { const ta = document.querySelector('.mm-ai-input textarea'); Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set.call(ta, '把「自动推理」改名为「自动推理与规划」'); ta.dispatchEvent(new Event('input',{bubbles:true})); ta.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true})); })()`);
for (let i = 0; i < 20; i++) { if (await ev(`document.querySelectorAll('.mm-ai-plan').length > 1`)) break; await sleep(300); }
await ev(`(() => { const btns = [...document.querySelectorAll('.mm-ai-apply')]; btns[btns.length - 1]?.click(); })()`);
await sleep(1200);
const renamed = await ev(`JSON.parse(localStorage.getItem('ksb.projects.v1')||'[]').find(p=>p.id==='ai').nodes.find(n=>n.id==='b1_l2_infer')?.name`);
console.log('renamed node:', renamed);
if (renamed !== '自动推理与规划') fail('改名未生效');
const undoText = await ev(`document.querySelector('.mm-ai-undo')?.innerText`);
console.log('undo bar:', undoText);
if (!/可撤回 2 步/.test(undoText ?? '')) fail('撤回栈不是 2 步');
if (SHOT) await shot('aj-07-undo-2');

// 连撤两次
await ev(`document.querySelector('.mm-ai-undo-btn')?.click()`);
await sleep(900);
console.log('after undo1:', await count(), await ev(`JSON.parse(localStorage.getItem('ksb.projects.v1')||'[]').find(p=>p.id==='ai').nodes.find(n=>n.id==='b1_l2_infer')?.name`));
await ev(`document.querySelector('.mm-ai-undo-btn')?.click()`);
await sleep(900);
const final = await count();
console.log('after undo2:', final);
if (final !== before) fail(`两次撤回后应回到 ${before}，实际 ${final}`);

console.log('console errors:', cdp.errors.slice(0, 3));
console.log(process.exitCode ? 'RESULT: FAIL' : 'RESULT: ALL PASS');
ws.close(); proc.kill();
