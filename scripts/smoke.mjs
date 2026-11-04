/**
 * 最终冒烟：首页 → 打开生成项目 → 四视图 → 设置/搜索/筛选/导入 → 回首页
 * 只做 DOM 断言，不截图（Electron 的 captureScreenshot 在本机偶发超时）。
 */
import { setTimeout as sleep } from 'node:timers/promises';

const PORT = 9444;
const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const target = list.find((t) => t.type === 'page');
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
let id = 0;
const pending = new Map();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
});
const send = (method, params = {}, timeout = 20000) =>
  new Promise((res, rej) => {
    const i = ++id;
    pending.set(i, res);
    ws.send(JSON.stringify({ id: i, method, params }));
    setTimeout(() => { if (pending.has(i)) { pending.delete(i); rej(new Error('timeout ' + method)); } }, timeout);
  });
const ev = async (expr) => {
  const m = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (m.result?.exceptionDetails) throw new Error(JSON.stringify(m.result.exceptionDetails));
  return m.result?.result?.value;
};
const ok = [];
const check = (name, cond, extra = '') => {
  ok.push(`${cond ? 'PASS' : 'FAIL'} ${name}${extra ? ' · ' + extra : ''}`);
};

await ev(`location.hash = '#/'`);
await sleep(1800);
check('首页渲染', await ev(`Boolean(document.querySelector('.home-title'))`));
check('模型设置入口', await ev(`[...document.querySelectorAll('.home-actions button')].some(b=>b.textContent.includes('模型设置'))`));
const cards = await ev(`document.querySelectorAll('.pcard').length`);
check('项目卡片数量', cards > 0, `cards=${cards}`);

// 打开刚生成的项目
await ev(`location.hash = '#/project/' + encodeURIComponent('企业架构知识体系')`);
await sleep(2600);
check('工作台顶栏', await ev(`Boolean(document.querySelector('.ws-top, .ws-tabs'))`));
check('树节点', (await ev(`document.querySelectorAll('.tree-row').length`)) > 20, `rows=${await ev(`document.querySelectorAll('.tree-row').length`)}`);
check('思维导图节点', (await ev(`document.querySelectorAll('.mm-node').length`)) > 5);

const viewChecks = [];
for (const [i, label] of [[1, '矩阵'], [2, '图谱'], [3, '学习路线']]) {
  await ev(`document.querySelectorAll('.ws-tabs .seg-item')?.[${i}]?.click()`);
  await sleep(i === 2 ? 2600 : 1200);
  const n = await ev(`document.querySelectorAll('.mxv-table, .mx-table, .gv-svg, .rt-svg').length`);
  viewChecks.push(`${label}:${n > 0 ? 'ok' : 'empty'}`);
}
check('四视图可切换', viewChecks.every((v) => v.endsWith('ok')), viewChecks.join(','));

// 全局搜索
await ev(`document.querySelectorAll('.ws-tabs .seg-item')[0].click()`);
await sleep(900);
await ev(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }))`);
await sleep(700);
check('Ctrl+K 搜索浮层', await ev(`Boolean(document.querySelector('.gsearch'))`));
await ev(`document.querySelector('.gsearch input').value = '数据'`);
await ev(`document.querySelector('.gsearch input').dispatchEvent(new Event('input', { bubbles: true }))`);
await sleep(500);
const hits = await ev(`document.querySelectorAll('.gsearch-item').length`);
check('搜索结果', hits > 0, `hits=${hits}`);
await ev(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
await sleep(400);

// 筛选降透明度
await ev(`document.querySelectorAll('.filter-values .filter-value')[0]?.click()`);
await sleep(700);
check('筛选产生 dim 节点', (await ev(`document.querySelectorAll('.mm-node[opacity="0.12"]').length`)) > 0);
check('筛选写入 URL', (await ev(`location.hash`)).includes('f='));
await ev(`document.querySelector('.filter-reset')?.click()`);
await sleep(400);

// 项目设置弹窗
await ev(`[...document.querySelectorAll('.ws-iconbtn')].find(b=>b.title?.includes('项目设置'))?.click()`);
await sleep(700);
check('项目设置弹窗', await ev(`Boolean(document.querySelector('.modal'))`));
await ev(`document.querySelector('.modal-x')?.click()`);
await sleep(300);

// 导入弹窗
await ev(`location.hash = '#/'`);
await sleep(1200);
await ev(`[...document.querySelectorAll('.home-actions button')].find(b=>b.textContent.includes('导入YAML'))?.click()`);
await sleep(700);
check('导入弹窗', await ev(`Boolean(document.querySelector('.modal'))`));
check('模板下载入口', await ev(`document.body.textContent.includes('下载 5 文件模板')`));

console.log(ok.join('\n'));
console.log('\nFAILED:', ok.filter((x) => x.startsWith('FAIL')).length);
ws.close();
process.exit(0);
