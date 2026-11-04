/**
 * 功能验证（不截图，只操作 DOM + 读状态）：AI 生成 → 落盘 → 工作台渲染
 */
import { setTimeout as sleep } from 'node:timers/promises';

const PORT = 9444;
const NAME = process.argv[2] ?? '企业架构知识体系';

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const target = list.find((t) => t.type === 'page');
if (!target) throw new Error('no page target');
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
let id = 0;
const pending = new Map();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
});
const send = (method, params = {}, timeout = 25000) =>
  new Promise((res, rej) => {
    const i = ++id;
    pending.set(i, res);
    ws.send(JSON.stringify({ id: i, method, params }));
    setTimeout(() => { if (pending.has(i)) { pending.delete(i); rej(new Error('cdp timeout ' + method)); } }, timeout);
  });
const ev = async (expression) => {
  const m = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (m.result?.exceptionDetails) throw new Error(JSON.stringify(m.result.exceptionDetails));
  return m.result?.result?.value;
};

console.log('desktop', await ev('Boolean(window.ksb?.isDesktop)'), 'llm', await ev('Boolean(window.ksbLlm)'));

await ev(`location.hash = '#/create'`);
await sleep(1200);
await ev(`(() => {
  const set = (el, v) => {
    const setter = Object.getOwnPropertyDescriptor(el.__proto__, 'value').set;
    setter.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const input = document.querySelector('.create-wrap input.input');
  set(input, ${JSON.stringify(NAME)});
  const ta = document.querySelector('.create-wrap textarea');
  set(ta, '构建企业架构（EA）知识体系，覆盖业务架构、应用架构、数据架构、技术架构、架构治理与转型落地，面向转岗架构师与企业数字化从业者。');
  return Boolean(input && ta);
})()`);
await sleep(300);
await ev(`document.querySelector('.create-submit').click()`);
console.log('clicked generate');

const t0 = Date.now();
let last = '';
while (Date.now() - t0 < 16 * 60 * 1000) {
  await sleep(6000);
  const st = await ev(`JSON.stringify({
    hash: location.hash,
    running: Boolean(document.querySelector('.gen-wrap')),
    meta: document.querySelector('.gen-meta')?.textContent || '',
    err: document.querySelector('.form-err')?.textContent || '',
    issues: [...document.querySelectorAll('.import-issues li')].map(e => e.textContent).slice(0,6),
    nodes: document.querySelectorAll('.mm-node').length,
    title: document.querySelector('.ws-proj-name')?.textContent || ''
  })`);
  if (st !== last) {
    console.log(((Date.now() - t0) / 1000).toFixed(0) + 's', st);
    last = st;
  }
  if (!st.includes('"running":true')) break;
}

const final = JSON.parse(await ev(`JSON.stringify({
  hash: location.hash,
  title: document.querySelector('.ws-proj-name')?.textContent || '',
  status: document.querySelector('.ws-status')?.textContent || '',
  treeRows: document.querySelectorAll('.tree-row').length,
  mmNodes: document.querySelectorAll('.mm-node').length
})`));
console.log('FINAL', final);
ws.close();
process.exit(final.hash.startsWith('#/project/') ? 0 : 2);
