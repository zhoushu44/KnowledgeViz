/**
 * 节点定义可信度核验。
 *
 * 把一个知识点的「定义」当作待核查说法，走多票 deep judge，把结论落回节点：
 *   · 结论为 true   → 定义与主流资料一致，可信度高
 *   · 结论为 false  → 定义与资料冲突，标红提醒（很可能是 AI 编的或旧认知）
 *   · uncertain     → 资料不足，不构成错误但也不背书
 *
 * 并发设计：一批节点同时核验（每条内部再 N 票并发），但总并发受 research 闸门限制，
 * 所以「50 个节点一次核验」实际是按 6 路排队跑，不会把网关打挂。
 */
import { stableJudge, type JudgeResult } from './net';
import type { KnowledgePoint } from './types';

export interface NodeVerifyResult {
  nodeId: string;
  claim: string;
  judge: JudgeResult;
}

/** 把节点定义拼成一句可核查的说法 */
export function claimOf(node: Pick<KnowledgePoint, 'name' | 'definition'>): string {
  const def = String(node.definition ?? '').trim();
  if (!def) return `${node.name}`;
  // 「XX：说明」这种前缀去掉，避免把节点名重复当主体
  const body = def.replace(new RegExp(`^${escapeRe(node.name)}\\s*[:：]\\s*`), '');
  return body.startsWith(node.name) ? body : `${node.name}：${body}`;
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 批量核验节点定义。
 * @param nodes 待核验节点
 * @param opts.samples 每条几票（默认 2：核验只做筛查，重要结论再手动加票）
 * @param opts.limit   最多核验多少个（默认 12，避免一次跑太久）
 * @param opts.onEach   每完成一条回调（用于 UI 增量渲染）
 */
export async function verifyNodes(
  nodes: KnowledgePoint[],
  opts: { samples?: number; limit?: number; onEach?: (r: NodeVerifyResult) => void } = {}
): Promise<NodeVerifyResult[]> {
  const list = nodes.slice(0, opts.limit ?? 12);
  const samples = opts.samples ?? 2;

  // 外层并发控制在 4：每条内部还有 samples 票，乘起来约 8 路，正好撞上 research 闸门
  const width = 4;
  const out: NodeVerifyResult[] = [];
  let cursor = 0;

  async function worker() {
    while (cursor < list.length) {
      const node = list[cursor++];
      try {
        const judge = await stableJudge(claimOf(node), { samples, mode: 'deep' });
        const r = { nodeId: node.id, claim: claimOf(node), judge };
        out.push(r);
        opts.onEach?.(r);
      } catch (e: any) {
        const r: NodeVerifyResult = {
          nodeId: node.id,
          claim: claimOf(node),
          judge: {
            claim: claimOf(node),
            verdict: 'uncertain',
            confidence: 0,
            agreement: 0,
            votes: {},
            samples: 0,
            reason: `核验失败：${String(e?.message ?? e)}`,
            evidence: [],
            status: 'failed',
          },
        };
        out.push(r);
        opts.onEach?.(r);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(width, list.length) }, () => worker()));
  return out;
}

/** 可信度徽标：从核验结果推出一个简短标记 */
export function verifyBadge(r?: NodeVerifyResult): { text: string; color: string; title: string } | null {
  if (!r) return null;
  const j = r.judge;
  if (j.status === 'failed') return { text: '未核验', color: 'var(--text-4)', title: j.reason };
  if (j.verdict === 'true' && j.confidence >= 0.7) {
    return { text: '已核验', color: 'var(--success)', title: `与主流资料一致（${j.confidence}）` };
  }
  if (j.verdict === 'false') {
    return { text: '存疑', color: 'var(--danger)', title: `与资料冲突：${j.reason}` };
  }
  return { text: '待定', color: 'var(--warning)', title: j.reason || '证据不足' };
}
