/**
 * Electron 真实链路验证：连 9444 的 Electron 渲染进程，走真模型（deepseek-v4-flash）
 * 用法：先 node scripts/debug-launch.cjs，再 node scripts/verify-electron-ai.mjs
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const OUT = process.env.OUT || join(tmpdir(), 'knowledge-viz-shots');
const PORT = 9444;
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
const shot = async (n) => { const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' }); writeFileSync(`${OUT}\\${n}.png`, Buffer.from(data, 'base64')); console.log('shot', n); };

// 进项目
await ev(`location.hash = '#/project/ai'`);
await sleep(2500);
console.log('desktop?', await ev(`Boolean(window.ksb && window.ksb.isDesktop)`));
console.log('cfg:', await ev(`localStorage.getItem('ksb.llm.v1')`));

const treeCount = () => ev(`document.querySelectorAll('.tree-row').length`);
const before = await treeCount();
console.log('nodes before:', before);
if (!before) throw new Error('项目没加载');

await ev(`document.querySelector('.mm-ai-fab')?.click()`);
await sleep(400);

const started = Date.now();
async function ask(q) {
  const t = Date.now();
  await ev(`(() => {
    const ta = document.querySelector('.mm-ai-input textarea');
    Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set.call(ta, ${JSON.stringify(q)});
    ta.dispatchEvent(new Event('input',{bubbles:true}));
    ta.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
  })()`);
  for (let i = 0; i < 180; i++) {
    if (await ev(`!!document.querySelector('.mm-ai-plan') || !!document.querySelector('.mm-ai-err')`)) break;
    await sleep(1000);
  }
  const sec = ((Date.now() - t) / 1000).toFixed(1);
  const err = await ev(`document.querySelector('.mm-ai-err')?.innerText ?? ''`);
  const head = await ev(`document.querySelector('.mm-ai-plan-head')?.innerText ?? ''`);
  const items = await ev(`[...document.querySelectorAll('.mm-ai-plan-list .mm-ai-step')].map(x => x.innerText).join(' | ')`);
  console.log(`\n[${q}]  ${sec}s`);
  console.log('  head:', head);
  console.log('  items:', items.slice(0, 400));
  if (err) console.log('  ERR:', err.slice(0, 200));
  return { err, head, items };
}

// 1) 模糊指令 —— 只有模型能处理
const r1 = await ask('机器学习这块讲得太笼统了，帮我把线性回归拆细一点，再把「知识表示与推理」这个名字改得更准确');
await shot('el-01-plan');

// 应用
if (!r1.err) {
  await ev(`document.querySelector('.mm-ai-apply')?.click()`);
  await sleep(1800);
  console.log('  applied:', await ev(`document.querySelector('.mm-ai-flash')?.innerText ?? ''`));
  console.log('  nodes after:', await treeCount());
  await shot('el-02-applied');
}

// 2) 第二句：改名（本地规则应秒回）
const r2 = await ask('把「自动推理」改名为「自动推理与规划」');
await ev(`document.querySelector('.mm-ai-apply')?.click()`);
await sleep(1200);
console.log('  rename ok:', await ev(`[...document.querySelectorAll('.tree-row')].some(r => r.innerText.includes('自动推理与规划'))`));
await shot('el-03-rename');

console.log('\ntotal elapsed:', ((Date.now() - started) / 1000).toFixed(1), 's');
console.log('console errors:', cdp.errors.slice(0, 3));
ws.close();
