/**
 * 节点级联网补全：给一个知识点并发检索「权威资料 + 延伸阅读」，落成 resources / examples。
 *
 * 并发设计：
 *   · 3 个查询角度（定义/权威、实践/案例、进阶/对比）并发 search
 *   · 命中的 URL 去重后，按域名权重排序（维基/官方文档/学术优先，内容农场降权）
 *   · 只有需要正文摘要时才 extract（默认关，省 3–10s）
 */
import { searchMany, extractMany, type SearchHit } from './net';

/** 可信度加权：教科书/官方文档/百科优先，聚合站和内容农场降权 */
const DOMAIN_WEIGHT: { re: RegExp; w: number; type: 'book' | 'link' | 'course' }[] = [
  { re: /(^|\.)(wikipedia\.org|zh\.wikipedia\.org|baike\.baidu\.com)$/i, w: 9, type: 'link' },
  { re: /(^|\.)(arxiv\.org|acm\.org|ieee\.org|springer\.com|nature\.com|sciencedirect\.com|jstor\.org)$/i, w: 10, type: 'link' },
  { re: /(^|\.)(github\.com|developer\.mozilla\.org|docs\.python\.org|reactjs\.org|nodejs\.org|kubernetes\.io)$/i, w: 10, type: 'link' },
  { re: /(\.edu\.cn|\.edu|\.ac\.[a-z]{2})$/i, w: 9, type: 'course' },
  { re: /(^|\.)(coursera\.org|edx\.org|icourse163\.org|bilibili\.com)$/i, w: 8, type: 'course' },
  { re: /(^|\.)(medium\.com|juejin\.cn|zhihu\.com|csdn\.net|segmentfault\.com)$/i, w: 5, type: 'link' },
  { re: /(^|\.)(sohu\.com|163\.com|kuku\.baidu\.com|baijiahao\.baidu\.com|toutiao\.com)$/i, w: 1, type: 'link' },
];

function rankDomain(host: string): { w: number; type: 'book' | 'link' | 'course' } {
  for (const d of DOMAIN_WEIGHT) if (d.re.test(host)) return { w: d.w, type: d.type };
  return { w: 3, type: 'link' };
}

export interface NodeResource {
  title: string;
  type: 'book' | 'link' | 'course';
  url?: string;
}

export interface EnrichResult {
  resources: NodeResource[];
  /** 每条资料的可信度分（与 resources 同序，供 UI 展示） */
  scores: number[];
  /** 一句话摘要（可能为空） */
  summary: string;
  queries: string[];
  elapsedMs: number;
}

/**
 * @param nodeName 知识点名
 * @param opts.hints 额外的检索角度（如所属分支名）
 * @param opts.limit 最多保留几条资料
 * @param opts.withSummary 是否抓正文生成摘要（多花 3–10s）
 */
export async function enrichNode(
  nodeName: string,
  opts: { hints?: string[]; limit?: number; withSummary?: boolean; keywords?: string } = {}
): Promise<EnrichResult> {
  const t0 = Date.now();
  const hint = opts.hints?.filter(Boolean).slice(0, 2).join(' ') ?? '';
  const kw = opts.keywords?.trim() ? ` ${opts.keywords.trim()}` : '';
  const queries = [
    `${nodeName}${kw} 定义 原理 权威资料`,
    `${nodeName}${kw} 教程 实践 案例`,
    `${nodeName}${kw} 进阶 最佳实践 对比`,
  ].map((q) => (hint ? `${hint} ${q}` : q));

  const bundles = await searchMany(queries, { maxResults: 6, depth: 'advanced' });

  // 合并去重（按 URL 规范化）
  const pool = new Map<string, SearchHit & { score2: number; type: 'book' | 'link' | 'course' }>();
  for (const b of bundles) {
    for (const hit of b.results ?? []) {
      const key = normalize(hit.url);
      if (!key || pool.has(key)) continue;
      const rank = rankDomain(hit.domain || safeHost(hit.url));
      // 综合分 = 域名权重为主，原始相关度为辅
      pool.set(key, { ...hit, score2: rank.w * 10 + (hit.score ?? 0) * 10, type: rank.type });
    }
  }

  const ranked = [...pool.values()].sort((a, b) => b.score2 - a.score2);
  const picked = ranked.slice(0, opts.limit ?? 8);

  let summary = '';
  if (opts.withSummary && picked.length) {
    try {
      const rows = await extractMany(
        picked.slice(0, 2).map((p) => p.url),
        { batch: 2, maxChars: 1200 }
      );
      const best = rows.find((r) => (r.chars ?? 0) > 300);
      if (best) summary = firstSentences(best.content, 2);
    } catch {
      /* 摘要失败不影响资料列表 */
    }
  }

  return {
    resources: picked.map((p) => ({
      title: cleanTitle(p.title) || safeHost(p.url),
      type: p.type,
      url: p.url,
    })),
    scores: picked.map((p) => Math.round(p.score2)),
    summary,
    queries,
    elapsedMs: Date.now() - t0,
  };
}

function normalize(u: string): string {
  try {
    const url = new URL(u);
    url.hash = '';
    // 去掉常见追踪参数
    for (const k of [...url.searchParams.keys()]) {
      if (/^(utm_|spm|from|share|ref)/i.test(k)) url.searchParams.delete(k);
    }
    return url.toString().replace(/\/$/, '');
  } catch {
    return '';
  }
}

function safeHost(u: string): string {
  try {
    return new URL(u).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function cleanTitle(t: string): string {
  return String(t ?? '')
    .replace(/\s*[-|–—]\s*(百度百科|维基百科|知乎|CSDN|简书|博客园)\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

function firstSentences(text: string, n: number): string {
  const clean = String(text ?? '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/[#>*_`]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const parts = clean.split(/(?<=[。！？.!?])\s*/).filter((s) => s.length > 12);
  return parts.slice(0, n).join('').slice(0, 260);
}
