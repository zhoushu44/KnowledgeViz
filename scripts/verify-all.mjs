/**
 * 隔离验证 v3：在 v2 基础上加「节点联网补全」与「批量并发」验证。
 * 用法：node scripts/verify-all.mjs
 */
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import path from 'node:path';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = process.cwd();
const electronBin = require(path.join(root, 'node_modules', 'electron'));
const PORT = 9459;
const userData = path.join(root, '.verify-profile5');
await fs.rm(userData, { recursive: true, force: true });
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electronBin, [root, `--remote-debugging-port=${PORT}`, `--user-data-dir=${userData}`], {
  env,
  stdio: 'ignore',
});

const ok = [];
const check = (name, cond, extra = '') => {
  const line = `${cond ? 'PASS' : 'FAIL'} ${name}${extra ? ' · ' + extra : ''}`;
  ok.push(line);
  console.log(line);
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
    } catch {
      /* not ready */
    }
  }
  if (!target) throw new Error('Electron 未就绪');

  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m);
      pending.delete(m.id);
    }
  });
  const send = (method, params = {}, timeout = 20000) =>
    new Promise((res, rej) => {
      const i = ++id;
      pending.set(i, res);
      ws.send(JSON.stringify({ id: i, method, params }));
      setTimeout(() => {
        if (pending.has(i)) {
          pending.delete(i);
          rej(new Error(`timeout ${method}`));
        }
      }, timeout);
    });
  const ev = async (expr, { retries = 4, timeout = 45000 } = {}) => {
    for (let a = 0; a <= retries; a++) {
      try {
        const m = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, timeout);
        if (m.result?.exceptionDetails) return { __exc: String(m.result.exceptionDetails.exception?.description ?? '').slice(0, 200) };
        return m.result?.result?.value;
      } catch (e) {
        if (a === retries) throw e;
        await sleep(1200);
      }
    }
  };
  const waitFor = async (expr, { secs = 120, every = 1200 } = {}) => {
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
  check('preload ksbNet', await ev(`Boolean(window.ksbNet)`));

  // ========== 1. 深入调研 ==========
  await ev(`location.hash = '#/research'`);
  await waitFor(`Boolean(document.querySelector('.rp-textarea'))`);
  await ev(`(() => {
    const ta = document.querySelector('.rp-textarea');
    const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    set.call(ta, '知识图谱的核心组成部分有哪些');
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await sleep(300);
  const t1 = Date.now();
  await ev(`[...document.querySelectorAll('.rp-actions button')].find(b=>b.textContent.includes('开始研究')).click()`);
  await waitFor(`document.querySelectorAll('.rp-content').length`, { secs: 150 });
  const rtext = await ev(`document.querySelector('.rp-content')?.textContent ?? ''`);
  check('深入研究返回正文', String(rtext).length > 50, `${Math.round((Date.now() - t1) / 1000)}s chars=${String(rtext).length}`);
  check('深入研究带来源', (await ev(`document.querySelectorAll('.rp-src').length`)) > 0);

  // ========== 2. 批量并发调研（2 条） ==========
  await ev(`[...document.querySelectorAll('.rp-actions button')].find(b=>b.textContent.includes('添加任务')).click()`);
  await sleep(400);
  await ev(`(() => {
    const tas = [...document.querySelectorAll('.rp-textarea')];
    const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    set.call(tas[0], '什么是向量数据库');
    tas[0].dispatchEvent(new Event('input', { bubbles: true }));
    set.call(tas[1], '什么是 RAG 检索增强生成');
    tas[1].dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await sleep(400);
  const t2 = Date.now();
  await ev(`[...document.querySelectorAll('.rp-actions button')].find(b=>b.textContent.includes('开始研究')).click()`);
  await waitFor(`document.querySelectorAll('.rp-content').length >= 2`, { secs: 200 });
  const n2 = await ev(`document.querySelectorAll('.rp-content').length`);
  const batchSecs = Math.round((Date.now() - t2) / 1000);
  check('2 个任务并发返回', n2 >= 2, `${batchSecs}s（串行需 ≥2×单次）`);

  // ========== 3. 事实核查（多说法并发） ==========
  await ev(`[...document.querySelectorAll('.rp-tab')].find(b=>b.textContent.includes('事实核查')).click()`);
  await waitFor(`Boolean(document.querySelector('.rp-note'))`);
  await ev(`[...document.querySelectorAll('.rp-actions button')].find(b=>b.textContent.includes('添加说法')).click()`);
  await sleep(400);
  await ev(`(() => {
    const tas = [...document.querySelectorAll('.rp-textarea')];
    const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    set.call(tas[0], '太阳从西边升起');
    tas[0].dispatchEvent(new Event('input', { bubbles: true }));
    set.call(tas[1], '水的化学式是 H2O');
    tas[1].dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await sleep(400);
  const t3 = Date.now();
  await ev(`[...document.querySelectorAll('.rp-actions button')].find(b=>b.textContent.includes('开始核查')).click()`);
  await waitFor(`document.querySelectorAll('.rp-verdict').length >= 2`, { secs: 220 });
  const verdicts = await ev(`[...document.querySelectorAll('.rp-verdict')].map(e=>e.textContent.trim())`);
  const confs = await ev(`[...document.querySelectorAll('.rp-conf-val')].map(e=>e.textContent)`);
  check('2 条说法并发核查', Array.isArray(verdicts) && verdicts.length >= 2, `${Math.round((Date.now() - t3) / 1000)}s ${JSON.stringify(verdicts)}`);
  check('置信度均为票型后验', confs.every((c) => Number(c) > 0 && Number(c) <= 0.86), JSON.stringify(confs));
  const decided = await ev(`document.querySelectorAll('.rp-status.decided').length`);
  check('status 正常', decided >= 1, `decided=${decided}`);

  // ========== 4. 节点资源联网补全 ==========
  await ev(`location.hash = '#/'`);
  await sleep(1000);
  const card = await ev(`document.querySelectorAll('.pcard').length`);
  check('项目卡片', card > 0, `cards=${card}`);
  await ev(`document.querySelector('.pcard')?.click()`);
  await waitFor(`Boolean(document.querySelector('.tree-row'))`, { secs: 30 });
  await sleep(1200);
  // 选中一个知识点
  await ev(`document.querySelectorAll('.tree-row')[1]?.click()`);
  await sleep(900);
  const hasDetail = await ev(`Boolean(document.querySelector('.detail-name'))`);
  check('节点详情打开', hasDetail, await ev(`document.querySelector('.detail-name')?.textContent ?? ''`));
  // 切到资源 tab
  await ev(`[...document.querySelectorAll('.detail-tab')].find(b=>b.textContent.includes('资源'))?.click()`);
  await sleep(600);
  const hasBtn = await ev(`[...document.querySelectorAll('.res-bar button')].some(b=>b.textContent.includes('联网补全'))`);
  check('资源页有「联网补全」', hasBtn);
  if (hasBtn) {
    const t4 = Date.now();
    await ev(`[...document.querySelectorAll('.res-bar button')].find(b=>b.textContent.includes('联网补全')).click()`);
    await waitFor(`document.querySelectorAll('.res-preview').length`, { secs: 120 });
    const items = await ev(`document.querySelectorAll('.res-preview .detail-res').length`);
    const scores = await ev(`[...document.querySelectorAll('.res-score')].map(e=>Number(e.textContent))`);
    check('补全返回资料', items > 0, `${Math.round((Date.now() - t4) / 1000)}s items=${items}`);
    check('按可信度排序', Array.isArray(scores) && scores.length === items && scores.every((v, i) => i === 0 || scores[i - 1] >= v), JSON.stringify(scores));

    await ev(`[...document.querySelectorAll('.res-preview-foot button')].find(b=>b.textContent.includes('采纳')).click()`);
    await sleep(900);
    const saved = await ev(`!document.querySelector('.res-preview')`);
    check('采纳后写入 resources', saved);
  }

  // ========== 5. 联网扩展子节点（思维导图） ==========
  await ev(`[...document.querySelectorAll('.detail-tab')].find(b=>b.textContent.includes('关联'))?.click()`);
  await sleep(600);
  const expandBtn = await ev(`[...document.querySelectorAll('.expand button')].some(b=>b.textContent.includes('联网扩展'))`);
  check('关联页有「联网扩展」', expandBtn);
  if (expandBtn) {
    const before = await ev(`document.querySelectorAll('.tree-row').length`);
    const t5 = Date.now();
    await ev(`[...document.querySelectorAll('.expand button')].find(b=>b.textContent.includes('联网扩展')).click()`);
    await waitFor(`document.querySelectorAll('.expand-item').length`, { secs: 180 });
    const cands = await ev(`document.querySelectorAll('.expand-item').length`);
    check('联网扩展出候选节点', cands > 0, `${Math.round((Date.now() - t5) / 1000)}s cands=${cands}`);

    const defs = await ev(`[...document.querySelectorAll('.expand-item-def')].filter(e=>e.textContent.trim().length>4).length`);
    check('候选带一句话定义', defs === cands, `defs=${defs}/${cands}`);

    await ev(`[...document.querySelectorAll('.expand-foot button')].find(b=>b.textContent.includes('并入')).click()`);
    await sleep(1600);
    const after = await ev(`document.querySelectorAll('.tree-row').length`);
    check('并入后树节点增加', after > before, `${before} → ${after}`);
  }

  // ========== 6. 定义可信度核验 ==========
  await ev(`[...document.querySelectorAll('.detail-tab')].find(b=>b.textContent.includes('学习'))?.click()`);
  await sleep(500);
  const verifyBtn = await ev(`[...document.querySelectorAll('.verify-chip-btn')].some(b=>b.textContent.includes('核验定义'))`);
  check('定义旁有核验按钮', verifyBtn);
  if (verifyBtn) {
    const t6 = Date.now();
    await ev(`[...document.querySelectorAll('.verify-chip-btn')].find(b=>b.textContent.includes('核验定义')).click()`);
    await waitFor(`document.querySelectorAll('.verify-chip').length`, { secs: 150 });
    const chip = await ev(`document.querySelector('.verify-chip')?.textContent?.trim() ?? ''`);
    check('核验返回结论徽标', /已核验|存疑|待定|未核验/.test(chip), `${Math.round((Date.now() - t6) / 1000)}s "${chip}"`);
  }

  // 截图（研究页）
  await ev(`location.hash = '#/research'`);
  await sleep(1200);
  const shot = await send('Page.captureScreenshot', { format: 'png' }, 20000);
  if (shot.result?.data) {
    await fs.writeFile(path.join(root, 'scripts', 'shot-research.png'), Buffer.from(shot.result.data, 'base64'));
    console.log('截图: scripts/shot-research.png');
  }
} catch (e) {
  console.error('ERROR:', e?.message ?? e);
  ok.push(`FAIL 运行异常 · ${e?.message ?? e}`);
} finally {
  try {
    ws?.close();
  } catch {
    /* ignore */
  }
  child.kill('SIGKILL');
  await sleep(600);
  const failed = ok.filter((x) => x.startsWith('FAIL')).length;
  console.log(`\n通过 ${ok.length - failed}/${ok.length}`);
  process.exit(failed ? 1 : 0);
}
