/**
 * 验证 AI 学习路线（RouteView 「AI 重排路线」）
 * 用法：node scripts/verify-ai-route.mjs
 */
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import path from 'node:path';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = process.cwd();
const electronBin = require(path.join(root, 'node_modules', 'electron'));
const PORT = 9463;
const userData = path.join(root, '.verify-ai');
await fs.rm(userData, { recursive: true, force: true });
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electronBin, [root, `--remote-debugging-port=${PORT}`, `--user-data-dir=${userData}`], { env, stdio: 'ignore' });

const ok = [];
const check = (n, c, e = '') => {
  const l = `${c ? 'PASS' : 'FAIL'} ${n}${e ? ' · ' + e : ''}`;
  ok.push(l);
  console.log(l);
};

let ws;
try {
  let target = null;
  for (let i = 0; i < 60; i++) {
    await sleep(500);
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === 'page' && t.url.includes('index.html'));
      if (target) break;
    } catch {}
  }
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  });
  const send = (method, params = {}, t = 45000) =>
    new Promise((res, rej) => {
      const i = ++id;
      pending.set(i, res);
      ws.send(JSON.stringify({ id: i, method, params }));
      setTimeout(() => { if (pending.has(i)) { pending.delete(i); rej(new Error('timeout ' + method)); } }, t);
    });
  const ev = async (expr, { retries = 3, timeout = 45000 } = {}) => {
    for (let a = 0; a <= retries; a++) {
      try {
        const m = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, timeout);
        if (m.result?.exceptionDetails) return { __exc: String(m.result.exceptionDetails.exception?.description ?? '').slice(0, 250) };
        return m.result?.result?.value;
      } catch (e) {
        if (a === retries) throw e;
        await sleep(1000);
      }
    }
  };
  const waitFor = async (expr, { secs = 200, every = 1500 } = {}) => {
    const t0 = Date.now();
    let last = null;
    while (Date.now() - t0 < secs * 1000) {
      last = await ev(expr);
      if (last === true || (typeof last === 'number' && last > 0)) return last;
      await sleep(every);
    }
    return last;
  };

  await sleep(1500);

  // 打开第一个项目 → 学习路线视图
  await ev(`location.hash = '#/'`);
  await sleep(1200);
  await ev(`document.querySelector('.pcard')?.click()`);
  await waitFor(`Boolean(document.querySelector('.tree-row'))`, { secs: 40 });
  await sleep(1500);

  await ev(`document.querySelectorAll('.ws-tabs .seg-item')[3]?.click()`);
  await waitFor(`Boolean(document.querySelector('.rt-toolbar'))`, { secs: 30 });
  await sleep(1200);

  check('学习路线视图打开', await ev(`Boolean(document.querySelector('.rt-svg'))`));
  check('有 AI 重排按钮', await ev(`[...document.querySelectorAll('.rt-controls button')].some(b=>b.textContent.includes('AI 重排'))`));

  const stagesBefore = await ev(`document.querySelectorAll('.rt-ai-stage').length`);
  check('初始无 AI 面板', stagesBefore === 0, `stages=${stagesBefore}`);

  const t0 = Date.now();
  await ev(`[...document.querySelectorAll('.rt-controls button')].find(b=>b.textContent.includes('AI 重排')).click()`);
  await sleep(1200);
  check('点击后显示进度', await ev(`Boolean(document.querySelector('.rt-ai-busy'))`));

  await waitFor(`document.querySelectorAll('.rt-ai-stage').length`, { secs: 240 });
  const secs = Math.round((Date.now() - t0) / 1000);
  const nStages = await ev(`document.querySelectorAll('.rt-ai-stage').length`);
  check('AI 排出阶段', nStages >= 2, `${secs}s stages=${nStages}`);

  const nodeCount = await ev(`document.querySelectorAll('.rt-ai-chip').length`);
  check('阶段里有节点', nodeCount > 0, `chips=${nodeCount}`);

  const whys = await ev(`[...document.querySelectorAll('.rt-ai-why')].filter(e=>e.textContent.trim().length>4).length`);
  check('每阶段有排序理由', whys === nStages, `${whys}/${nStages}`);

  const meta = await ev(`document.querySelector('.rt-ai-meta')?.textContent?.trim() ?? ''`);
  check('显示耗时/阶段数/联网源', /阶段/.test(meta), meta);

  const srcCount = await ev(`document.querySelectorAll('.rt-ai-src').length`);
  check('带联网来源', srcCount > 0, `sources=${srcCount}`);

  // 保存（只统计第一个 select，也就是「路线」那个，避免把「关系/难度」下拉算进来）
  const routeOpts = `document.querySelector('.rt-controls select')?.querySelectorAll('option').length ?? 0`;
  const before = await ev(routeOpts);
  const beforeNames = await ev(`[...document.querySelectorAll('.rt-controls select')[0].querySelectorAll('option')].map(o=>o.textContent)`);
  await ev(`[...document.querySelectorAll('.rt-ai-foot button')].find(b=>b.textContent.includes('保存为新路线'))?.click()`);
  await sleep(2200);
  const afterNames = await ev(`[...document.querySelectorAll('.rt-controls select')[0].querySelectorAll('option')].map(o=>o.textContent)`);
  check('保存后路线列表变化', Array.isArray(afterNames) && JSON.stringify(afterNames) !== JSON.stringify(beforeNames) || afterNames.length > before, `${before} → ${afterNames?.length}`);

  const selected = await ev(`document.querySelector('.rt-controls select')?.value ?? ''`);
  check('自动切到新路线', String(selected).includes('_route_') || String(selected).includes('ai'), selected);

  // 截图
  await sleep(600);
  const shot = await send('Page.captureScreenshot', { format: 'png' }, 30000);
  if (shot.result?.data) {
    await fs.writeFile(path.join(root, 'scripts', 'shot-ai-route.png'), Buffer.from(shot.result.data, 'base64'));
    console.log('截图: scripts/shot-ai-route.png');
  }
} catch (e) {
  console.error('ERROR:', e?.message ?? e);
  ok.push(`FAIL 运行异常 · ${e?.message ?? e}`);
} finally {
  try { ws?.close(); } catch {}
  child.kill('SIGKILL');
  await sleep(600);
  const failed = ok.filter((x) => x.startsWith('FAIL')).length;
  console.log(`\n通过 ${ok.length - failed}/${ok.length}`);
  process.exit(failed ? 1 : 0);
}
