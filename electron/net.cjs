/**
 * 内置联网调研引擎（TavilyMux 网关，零依赖，全部并发）
 *
 * 为什么放在主进程：
 *   · 浏览器渲染进程直连会撞 CORS，且长轮询会卡 UI；
 *   · research 是「提交 → 轮询」两段式，主进程持有 request_id 才能取消；
 *   · 并发闸门必须全局唯一，否则多窗口叠加把上游 QPS 打爆。
 *
 * 实测参数（2026-11-04，自建 TavilyMux 网关）：
 *   · search  advanced 32 路并发 4.3s，零失败
 *   · research mini 13–23s/条；8 路并发 17.8s 全成功；16 路出现 no_available_key
 *   · research pro  160s+，只适合后台任务
 *   · 模型自报 confidence 无区分度（对错都是 0.90–0.99）→ 必须用票型后验校准
 */
const http = require('node:http');
const https = require('node:https');

/**
 * 网关地址与密钥：不写死在源码里，按优先级读取
 *   1. electron/net.local.cjs（本地私密配置，已 gitignore；结构见 net.local.example.cjs）
 *   2. 环境变量 KSB_NET_BASE / KSB_NET_KEY
 * 都未配置时联网调研相关功能会直接报错，其余功能不受影响。
 */
function loadLocalConfig() {
  try {
    // 用 require 而非 fs 读取：文件不存在时直接抛错，交给下方兜底
    return require('./net.local.cjs');
  } catch {
    return {};
  }
}

const localCfg = loadLocalConfig();

const NET = {
  base: String(localCfg.base || process.env.KSB_NET_BASE || '').replace(/\/$/, ''),
  key: String(localCfg.key || process.env.KSB_NET_KEY || ''),
};

function assertConfigured() {
  if (!NET.base || !NET.key) {
    throw new Error(
      '联网调研未配置：请复制 electron/net.local.example.cjs 为 net.local.cjs 并填入网关地址与 key，或设置环境变量 KSB_NET_BASE / KSB_NET_KEY 后重启应用'
    );
  }
}

/** 并发闸门：search / research 分开，因为两者上游上限不同 */
function makeGate(n) {
  let active = 0;
  const queue = [];
  const release = () => {
    active--;
    const next = queue.shift();
    if (next) next();
  };
  return async function run(fn) {
    if (active >= n) await new Promise((r) => queue.push(r));
    active++;
    try {
      return await fn();
    } finally {
      release();
    }
  };
}
const searchGate = makeGate(16);
const researchGate = makeGate(6);

function request(path, payload, method = 'POST', attempt = 0) {
  assertConfigured();
  return new Promise((resolve, reject) => {
    let url;
    try {
      url = new URL(NET.base + path);
    } catch (e) {
      return reject(new Error('网关地址不合法'));
    }
    const body = payload === undefined ? null : Buffer.from(JSON.stringify(payload), 'utf8');
    const mod = url.protocol === 'https:' ? https : http;
    const req = mod.request(
      url,
      {
        method,
        headers: {
          Authorization: `Bearer ${NET.key}`,
          'Content-Type': 'application/json',
          ...(body ? { 'Content-Length': body.length } : {}),
        },
      },
      (res) => {
        let raw = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (raw += c));
        res.on('end', () => {
          let parsed = raw;
          try {
            parsed = JSON.parse(raw);
          } catch {
            /* 保留原文 */
          }
          if (res.statusCode !== 200) {
            // 池内某个上游 key 被停用 / 限流 / 5xx：网关下次会轮换到别的 key，重试通常就能过
            const msg = typeof parsed === 'string' ? parsed : JSON.stringify(parsed);
            const transient =
              [429, 500, 502, 503, 504].includes(res.statusCode) ||
              (res.statusCode === 401 && /deactivated|rate|no_available_key/i.test(msg));
            if (transient && attempt < 3) {
              const wait = Math.min(1200 * Math.pow(2, attempt), 8000) * (0.75 + Math.random() * 0.5);
              setTimeout(() => {
                request(path, payload, method, attempt + 1).then(resolve, reject);
              }, wait);
              return;
            }
            return reject(new Error(`HTTP ${res.statusCode}：${String(msg).slice(0, 200)}`));
          }
          resolve(parsed);
        });
      }
    );
    req.setTimeout(180_000, () => req.destroy(new Error('网关请求超时（180s）')));
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

/** 单次搜索 */
async function searchOnce(query, opts = {}) {
  const payload = {
    query,
    max_results: opts.maxResults ?? 8,
    search_depth: opts.depth ?? 'advanced',
    ...(opts.topic ? { topic: opts.topic } : {}),
    ...(opts.days ? { days: opts.days } : {}),
    ...(opts.domains?.length ? { include_domains: opts.domains } : {}),
  };
  const r = await searchGate(() => request('/search', payload));
  return {
    query,
    results: (r.results ?? []).map((it) => ({
      title: it.title ?? '',
      url: it.url ?? '',
      content: (it.content ?? '').slice(0, 800),
      score: it.score ?? 0,
      published: it.published_date ?? '',
      domain: safeHost(it.url),
    })),
    answer: r.answer ?? '',
    responseTime: r.response_time ?? 0,
  };
}

function safeHost(u) {
  try {
    return new URL(u).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** 多查询并发（保序） */
async function searchMany(queries, opts = {}) {
  const out = [];
  const results = await Promise.allSettled(queries.map((q) => searchOnce(q, opts)));
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') out.push(r.value);
    else out.push({ query: queries[i], results: [], answer: '', error: String(r.reason?.message ?? r.reason) });
  });
  return out;
}

/** 批量抓正文（按 batch 切片并发） */
async function extractMany(urls, opts = {}) {
  const list = urls.filter(Boolean);
  if (!list.length) return [];
  const batch = opts.batch ?? 5;
  const chunks = [];
  for (let i = 0; i < list.length; i += batch) chunks.push(list.slice(i, i + batch));
  const settled = await Promise.allSettled(
    chunks.map((c) =>
      searchGate(() =>
        request('/extract', { urls: c, extract_depth: opts.depth ?? 'advanced', format: 'markdown' })
      )
    )
  );
  const rows = [];
  settled.forEach((s, ci) => {
    if (s.status !== 'fulfilled') {
      for (const u of chunks[ci]) rows.push({ url: u, chars: 0, content: '', error: String(s.reason?.message ?? s.reason) });
      return;
    }
    const byUrl = new Map((s.value.results ?? []).map((it) => [it.url, it]));
    for (const u of chunks[ci]) {
      const it = byUrl.get(u);
      const txt = it?.raw_content ?? '';
      rows.push({
        url: u,
        title: it?.title ?? '',
        chars: txt.length,
        content: txt.slice(0, opts.maxChars ?? 12000),
        error: it ? undefined : 'no_content',
      });
    }
  });
  return rows;
}

/** research 的 sources 是 [{url,title,favicon}]，统一拍平成 URL 字符串数组 */
function sourceUrls(sources) {
  if (!Array.isArray(sources)) return [];
  const out = [];
  for (const s of sources) {
    const u = typeof s === 'string' ? s : s?.url;
    if (typeof u === 'string' && /^https?:\/\//i.test(u) && !out.includes(u)) out.push(u);
  }
  return out;
}

/** research 结果里的 sources 也带标题，前端要能显示标题 */
function sourceDetail(sources) {
  if (!Array.isArray(sources)) return [];
  const seen = new Set();
  const out = [];
  for (const s of sources) {
    const u = typeof s === 'string' ? s : s?.url;
    if (typeof u !== 'string' || !/^https?:\/\//i.test(u) || seen.has(u)) continue;
    seen.add(u);
    out.push({ url: u, title: typeof s === 'string' ? '' : (s.title ?? '') });
  }
  return out;
}

/**
 * research + 来源兜底。
 *
 * 实测：网关的 research 有相当比例不返回 sources（有时有、有时空），
 * 但结论动辄两三千字 —— 没有来源的结论不可核验。
 * 所以来源为空时，用同一问题补一次 search，把高质量命中当作「参考来源」附上。
 */
async function researchWithSources(task, opts = {}) {
  const r = await research(task, opts);
  if (r.sources?.length) return { ...r, sourcesBackfilled: false };

  // 补搜要快：只取 1 个查询、5 条、basic 深度；超过 20s 就放弃（不能因为补来源把总时长拖爆）
  try {
    const bundles = await withTimeout(
      searchMany([task], { maxResults: 5, depth: 'basic' }),
      20_000,
      '补搜来源超时'
    );
    const hits = bundles[0]?.results ?? [];
    const seen = new Set(r.sources ?? []);
    const extra = [];
    const detail = [];
    for (const h of hits) {
      if (!h.url || seen.has(h.url)) continue;
      seen.add(h.url);
      extra.push(h.url);
      detail.push({ url: h.url, title: h.title });
      if (extra.length >= 5) break;
    }
    return { ...r, sources: extra, sourceDetail: [...(r.sourceDetail ?? []), ...detail], sourcesBackfilled: true };
  } catch {
    return { ...r, sourcesBackfilled: false };
  }
}

function withTimeout(promise, ms, msg) {
  return Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => rej(new Error(msg)), ms)),
  ]);
}

/** 提交 research 并轮询到完成；onTick 用于向前端推阶段 */
async function research(task, { schema, model = 'mini', pollMs = 2000, timeoutMs = 240_000, resubmit = 1, onTick } = {}) {
  const payload = { input: task, model };
  if (schema) payload.output_schema = normalizeSchema(schema);

  let lastErr = null;
  for (let attempt = 0; attempt <= resubmit; attempt++) {
    try {
      return await researchOnce(payload, { pollMs, timeoutMs, onTick });
    } catch (e) {
      lastErr = e;
      // 401 = 池内某个上游 key 被停用；网关下次会换 key，重提通常能成功
      const msg = String(e?.message ?? e);
      const retriable = /401|deactivated|no_available_key|failed|503|timeout|超时/i.test(msg);
      if (attempt < resubmit && retriable) {
        onTick?.({ phase: 'retry', attempt: attempt + 1 });
        await new Promise((r) => setTimeout(r, 2500 + Math.random() * 2000));
        continue;
      }
      throw e;
    }
  }
  throw lastErr;
}

async function researchOnce(payload, { pollMs, timeoutMs, onTick }) {
  const created = await researchGate(() => request('/research', payload));
  const rid = created.request_id;
  const t0 = Date.now();
  onTick?.({ phase: 'queued', requestId: rid });

  while (Date.now() - t0 < timeoutMs) {
    await new Promise((r) => setTimeout(r, pollMs));
    const st = await researchGate(() => request(`/research/${rid}`, undefined, 'GET'));
    onTick?.({ phase: st.status, requestId: rid, elapsedMs: Date.now() - t0 });
    if (st.status === 'completed') {
      return {
        content: st.content,
        sources: sourceUrls(st.sources),
        sourceDetail: sourceDetail(st.sources),
        requestId: rid,
        elapsedMs: Date.now() - t0,
      };
    }
    if (st.status === 'failed') throw new Error('上游 research 失败（网关换 key 后重试通常成功）');
  }
  throw new Error('research 超时');
}

/** Tavily 要求：顶层无 type、每个属性有 description、数组对象要标 type:object */
function normalizeSchema(schema) {
  if (!schema?.properties) throw new Error('schema 必须有 properties');
  const fix = (node, isRoot = false) => {
    const out = {};
    for (const k of ['type', 'description', 'enum', 'items', 'properties', 'required']) {
      if (node[k] !== undefined) out[k] = node[k];
    }
    if (isRoot) delete out.type;
    if (out.properties) {
      out.properties = Object.fromEntries(Object.entries(out.properties).map(([k, v]) => [k, fix(v)]));
      for (const [k, v] of Object.entries(out.properties)) {
        if (!v.description) v.description = v.type ?? k;
      }
      if (!out.type) out.type = 'object';
    }
    if (out.items && typeof out.items === 'object') {
      out.items = fix(out.items);
      if (out.items.type === 'object' && !out.items.description) out.items.description = 'item';
    }
    return out;
  };
  const fixed = { properties: Object.fromEntries(Object.entries(schema.properties).map(([k, v]) => [k, fix(v)])) };
  for (const [k, v] of Object.entries(fixed.properties)) if (!v.description) v.description = v.type ?? k;
  if (schema.required) fixed.required = schema.required;
  return fixed;
}

const JUDGE_SCHEMA = {
  properties: {
    verdict: { type: 'string', enum: ['true', 'false', 'uncertain'], description: '判定结果' },
    confidence: { type: 'number', description: '0 到 1 的置信度' },
    reason: { type: 'string', description: '判断依据，简洁中文' },
    key_evidence: { type: 'string', description: '最关键的一条证据' },
    evidence_urls: { type: 'array', items: { type: 'string' }, description: '来源链接' },
  },
  required: ['verdict', 'confidence', 'reason'],
};

/** 多角度提问：同一说法换 5 种问法，避免「同问法 × N 次」只召回同一批来源（实测 44.6s/假一致） */
const ANGLES = [
  '',
  '请查找官方声明或一手信源核实：',
  '请查找反驳证据，这条说法有没有可能是假的：',
  "请注意区分'计划'与'已发生'，核实：",
  '请核对时间、数字等细节是否准确：',
];

async function judgeDeep(claim, angleIndex = 0) {
  const prefix = ANGLES[angleIndex % ANGLES.length];
  const q = prefix ? `${prefix}${claim}` : claim;
  const r = await researchWithSources(`核实下面这个说法是否属实，给出 true / false / uncertain 判定：\n${q}`, {
    schema: JUDGE_SCHEMA,
  });
  const parsed = typeof r.content === 'string' ? extractJson(r.content) : r.content;
  return { ...(parsed ?? {}), sources: r.sources ?? [] };
}

async function judgeFast(claim) {
  const q =
    `核实这个说法是否属实：${claim}\n\n` +
    '只输出 JSON：{"verdict":"true|false|uncertain","confidence":0.0,"reason":"一句话依据","source":"关键链接"}';
  const r = await searchOnce(q, { maxResults: 6 });
  const parsed = extractJson(r.answer);
  return parsed ?? { verdict: 'uncertain', confidence: 0, reason: r.answer?.slice(0, 200) ?? '解析失败' };
}

function extractJson(text) {
  if (!text) return null;
  const s = String(text).trim().replace(/^```(?:json)?|```$/gm, '').trim();
  for (const cand of [s, s.match(/\{[\s\S]*\}/)?.[0]].filter(Boolean)) {
    try {
      return JSON.parse(cand);
    } catch {
      try {
        return JSON.parse(cand.replace(/([{,]\s*)([A-Za-z_]\w*)\s*:/g, '$1"$2":').replace(/,\s*([}\]])/g, '$1'));
      } catch {
        /* next */
      }
    }
  }
  return null;
}

/**
 * 稳定判断：N 票并发 + 票型后验置信度。
 *
 * 置信度公式（实测校准，替代无区分度的自报值）：
 *   confidence = (k+1)/(n+2) × (0.9 + 0.1 × 有信源比例)
 *   3/3 → 0.80 · 4/5 → 0.71 · 2/3 → 0.60 · 1/2 → 0.50
 */
async function stableJudge(claim, { samples = 3, mode = 'deep', onTick } = {}) {
  const t0 = Date.now();
  const settled = await Promise.allSettled(
    Array.from({ length: samples }, (_, i) =>
      mode === 'deep' ? judgeDeep(claim, i) : judgeFast(claim)
    )
  );
  const out = [];
  const errs = [];
  for (const s of settled) {
    if (s.status !== 'fulfilled') {
      errs.push(String(s.reason?.message ?? s.reason).slice(0, 120));
      continue;
    }
    const v = String(s.value?.verdict ?? '').trim().toLowerCase();
    if (!['true', 'false', 'uncertain'].includes(v)) continue;
    // 证据来源可能是 字符串 / 对象 / 数组，统一拍平成 URL 字符串
    const evidence = [];
    const pushUrl = (x) => {
      const u = typeof x === 'string' ? x : x?.url;
      if (typeof u === 'string' && /^https?:\/\//i.test(u) && !evidence.includes(u)) evidence.push(u);
    };
    if (s.value?.source) pushUrl(s.value.source);
    if (s.value?.key_evidence) pushUrl(s.value.key_evidence);
    for (const u of s.value?.evidence_urls ?? []) pushUrl(u);
    for (const u of s.value?.sources ?? []) pushUrl(u);

    out.push({
      verdict: v,
      confidence: clamp01(s.value?.confidence ?? 0),
      reason: String(s.value?.reason ?? ''),
      evidence,
    });
  }
  if (!out.length) throw new Error(`全部 ${samples} 次采样失败${errs.length ? '：' + errs[0] : ''}`);

  const votes = { true: 0, false: 0, uncertain: 0 };
  for (const r of out) votes[r.verdict]++;
  const n = Math.max(...Object.values(votes));
  const tied = Object.keys(votes).filter((k) => votes[k] === n);
  // 平票时用自报置信度加权打破（仅用于打破平票，不直接当最终置信度）
  const verdict = tied.length === 1
    ? tied[0]
    : tied.sort((a, b) => sumConf(out, b) - sumConf(out, a))[0];
  const agreement = votes[verdict] / out.length;
  const supporters = out.filter((r) => r.verdict === verdict);
  const withSrc = supporters.filter((r) => r.evidence.length > 0).length;
  const evid = supporters.length ? withSrc / supporters.length : 0;

  let status = 'decided';
  let finalVerdict = verdict;
  if (verdict === 'uncertain') status = 'abstained';
  else if (agreement < 0.6) {
    status = 'disputed';
    finalVerdict = 'uncertain';
  }

  const confidence = round3(((supporters.length + 1) / (out.length + 2)) * (0.9 + 0.1 * Math.min(evid, 1)));
  const evidence = [...new Set(supporters.flatMap((r) => r.evidence))].slice(0, 6);

  onTick?.({ phase: 'done' });
  return {
    claim,
    verdict: finalVerdict,
    confidence,
    rawConfidence: round3(
      supporters.length ? supporters.reduce((a, r) => a + r.confidence, 0) / supporters.length : 0
    ),
    agreement: round2(agreement),
    votes,
    samples: out.length,
    failedSamples: samples - out.length,
    reason: supporters[0]?.reason ?? '',
    evidence,
    status,
    mode,
    elapsedMs: Date.now() - t0,
    confidenceBasis: 'beta-posterior',
  };
}

function sumConf(list, v) {
  return list.filter((r) => r.verdict === v).reduce((a, r) => a + r.confidence, 0);
}
const clamp01 = (x) => Math.max(0, Math.min(1, Number(x) || 0));
const round2 = (x) => Math.round(x * 100) / 100;
const round3 = (x) => Math.round(x * 1000) / 1000;

module.exports = {
  NET,
  searchOnce,
  searchMany,
  extractMany,
  research: researchWithSources,
  researchRaw: research,
  stableJudge,
  judgeFast,
  normalizeSchema,
  extractJson,
  JUDGE_SCHEMA,
  ANGLES,
};
