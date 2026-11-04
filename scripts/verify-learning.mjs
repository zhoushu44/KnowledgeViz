/**
 * 「学习」标签页 v2 端到端验证：质检条 / 体检单 / 定义缺口 / 编辑态问题清单
 * 用法：先起静态服务（vite preview --port 4173），再 node scripts/verify-learning.mjs
 */
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const CHROME =
  process.env.CHROME ||
  ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
   'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
   '/usr/bin/google-chrome',
   '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find((p) => existsSync(p)) ||
  'chrome';
const OUT = process.env.OUT || join(tmpdir(), 'knowledge-viz-shots');
const BASE = process.env.BASE ?? 'http://localhost:4173';
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

const port = 9343;
const proc = spawn(CHROME, ['--headless=new','--disable-gpu','--hide-scrollbars','--no-first-run',`--remote-debugging-port=${port}`,`--user-data-dir=${join(tmpdir(), 'chrome-prof-learning')}`,'--window-size=1920,1080','about:blank'], { stdio: 'ignore' });
let target;
for (let i = 0; i < 40; i++) { await sleep(400); try { const r = await fetch(`http://127.0.0.1:${port}/json/list`); target = (await r.json()).find((t) => t.type === 'page'); if (target) break; } catch {} }
if (!target) throw new Error('no target');

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
const cdp = new CDP(ws);
await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
const ev = async (e) => (await cdp.send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })).result?.value;
const shot = async (n) => { const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(OUT, `${n}.png`), Buffer.from(data, 'base64')); console.log('shot', n); };
const fail = (m) => { console.error('FAIL', m); process.exitCode = 1; };
const ok = (m) => console.log('PASS', m);

await cdp.send('Page.navigate', { url: `${BASE}/#/project/ai` });
await sleep(1500);
// 每次跑都用干净数据：清掉上一轮保存过的项目，再硬刷新（同 URL 只有 hash 变化不会重载）
await ev(`(() => { try { localStorage.clear(); return true; } catch { return false; } })()`);
await cdp.send('Page.reload', { ignoreCache: true });
await sleep(3000);

// 点一个 L2 节点
const picked = await ev(`(() => {
  const rows = [...document.querySelectorAll('.tree-row')];
  const r = rows.find(x => x.textContent.includes('自动推理')) || rows[3];
  r?.click();
  return r?.textContent?.trim().slice(0, 30) ?? null;
})()`);
await sleep(600);
console.log('picked node:', picked);

// 1) 质检条存在且判为占位
const q = await ev(`(() => {
  const el = document.querySelector('.learn-quality');
  if (!el) return null;
  return { cls: el.className, score: el.querySelector('.learn-quality-score')?.textContent, title: el.querySelector('.learn-quality-title')?.textContent, src: el.querySelector('.learn-quality-src')?.textContent };
})()`);
console.log('quality:', JSON.stringify(q));
if (!q) fail('没有质检条'); else {
  if (!/q-filler/.test(q.cls)) fail('模板态未被判为 filler');
  if (Number(q.score) > 40) fail(`模板态分数应 ≤40，实际 ${q.score}`);
  else ok(`质检条生效：${q.score} 分 · ${q.title}`);
}

// 2) 模板横幅
if (!(await ev(`!!document.querySelector('.learn-banner')`))) fail('缺少「这是体检单不是学习材料」横幅');
else ok('模板横幅存在');

// 3) 体检单内容：必须引用真实结构，不能出现旧模板套话
const bodyText = await ev(`document.querySelector('.learn-read')?.innerText ?? ''`);
console.log('learn body (head):', bodyText.slice(0, 260).replace(/\n/g, ' | '));
if (/关键一环|承上启下|无法落地/.test(bodyText)) fail('仍出现旧模板套话');
else ok('无旧模板套话');
if (!/缺口清单/.test(bodyText)) fail('没有缺口清单小节');
else ok('缺口清单存在');
if (!/下级|前置|层级/.test(bodyText)) fail('没有结构位置信息');
else ok('结构位置信息存在');

// 4) 编辑态：问题清单可见
await ev(`[...document.querySelectorAll('.learn-btn')].find(b => b.textContent.includes('编辑'))?.click()`);
await sleep(400);
const issues = await ev(`(() => {
  const d = document.querySelector('.learn-issues');
  if (!d) return null;
  return { open: d.open, count: d.querySelectorAll('li').length, text: d.textContent.slice(0, 160) };
})()`);
console.log('issues:', JSON.stringify(issues));
if (!issues || issues.count < 1) fail('编辑态没有质检问题清单');
else ok(`问题清单 ${issues.count} 条，默认展开=${issues.open}`);
await shot('learn-01-edit');

await ev(`[...document.querySelectorAll('.learn-btn')].find(b => b.textContent.trim() === '取消')?.click()`);
await sleep(300);

// 5) 换一个「描述=定义」的节点，验证定义缺口卡片
const degNode = await ev(`(() => {
  const proj = JSON.parse(localStorage.getItem('ksb.projects.v1') || '[]').find(p => p.id === 'ai');
  const n = proj?.nodes.find(n => n.description && n.definition && n.description.trim() === n.definition.trim());
  return n ? { id: n.id, name: n.name } : null;
})()`);
console.log('degenerate node:', JSON.stringify(degNode));
if (degNode) {
  await ev(`document.querySelector('[data-tree-id="${degNode.id}"]')?.click()`);
  await sleep(600);
  const card = await ev(`document.querySelector('.learn-defgap-head')?.textContent ?? ''`);
  console.log('defgap:', card);
  if (!card) fail('定义退化节点没有提示卡片');
  else ok('定义缺口卡片存在');
} else {
  console.log('SKIP 没有找到 description==definition 的节点');
}

// 6) 手动编辑后保存，质检分随之变化
await ev(`[...document.querySelectorAll('.learn-btn')].find(b => b.textContent.includes('编辑'))?.click()`);
await sleep(300);
await ev(`(() => {
  const ta = [...document.querySelectorAll('.learn-textarea')].find(t => t.placeholder?.includes('机制'));
  if (!ta) return false;
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
  setter.call(ta, '认知负荷理论（Sweller, 1988）指出工作记忆一次只能处理约 4 个信息块；当页面同时呈现价格、规格、赠品与分期四组数字时，用户会把精力花在比较而不是判断价值上。做法：一屏只留一个决策变量。');
  ta.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
})()`);
await sleep(300);
const editScore = await ev(`document.querySelector('.learn-quality-score')?.textContent`);
await ev(`[...document.querySelectorAll('.learn-btn')].find(b => b.textContent.includes('保存'))?.click()`);
await sleep(500);
const savedScore = await ev(`document.querySelector('.learn-quality-score')?.textContent`);
console.log('score while editing:', editScore, '→ after save:', savedScore);
if (savedScore === q?.score) fail('保存后质检分没有变化');
else ok(`质检分随内容变化：${q?.score} → ${savedScore}`);
if (!(await ev(`document.querySelector('.learn-handle-src')`))) {
  /* 校验来源标签变为「手动编辑」 */
  const src = await ev(`document.querySelector('.learn-quality-src')?.textContent ?? ''`);
  if (!/手动编辑/.test(src)) fail(`来源标签未更新：${src}`);
  else ok('来源标签更新为手动编辑');
}

await shot('learn-02-read');
console.log('console errors:', cdp.errors.slice(0, 3));
console.log(process.exitCode ? 'RESULT: FAIL' : 'RESULT: ALL PASS');
ws.close(); proc.kill();
