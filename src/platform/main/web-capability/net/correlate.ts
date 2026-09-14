/**
 * 请求关联 —— webRequest 的 requestId ↔ CDP 的 requestId(`04` §4;V1 已解决的难题)
 *
 * ⚠️ **两套编号**:webRequest 给一个 id,CDP 给另一个,同一次请求在两边号不一样。
 * V1 `network-event-bus.ts` 用 **URL + method + resourceType + 10s 内时间就近**配对,
 * 并做了 `xhr→fetch`、`mainframe/subframe→document` 的类型归一。
 *
 * ⭐ **这是踩出来的经验,照搬,不自己发明**(prompt §4.4)。
 * 自己写必然重踩:少了类型归一,CDP 报 `xhr` 而 webRequest 报 `fetch`,同一请求配不上;
 * 少了时间窗,页面反复请求同一个 URL 时会配到很久以前那次。
 *
 * 本文件是**纯函数**,零依赖,可完全单测。
 */

/**
 * resourceType 归一(V1 字面移植)。
 * 两侧对同一种请求的叫法不同,不归一就配不上。
 */
export function normalizeResourceType(resourceType: string | undefined): string | undefined {
  if (!resourceType) return undefined;
  const value = resourceType.toLowerCase();
  if (value === 'mainframe' || value === 'subframe') return 'document';
  if (value === 'xhr') return 'fetch';
  return value;
}

/**
 * 类型是否算匹配。
 *
 * ⚠️ 任一侧缺失时算**匹配**(V1 行为)—— 因为缺类型信息不该导致配对失败,
 * 那会让「配不上」这个结果失去区分力。URL+method+时间窗仍然在把关。
 */
export function resourceTypesMatch(left: string | undefined, right: string | undefined): boolean {
  const a = normalizeResourceType(left);
  const b = normalizeResourceType(right);
  if (!a || !b) return true;
  return a === b;
}

/** 配对时间窗(V1 字面:10 秒) */
export const CORRELATION_WINDOW_MS = 10_000;

export type CorrelationCandidate = {
  readonly id: string;
  readonly url: string;
  readonly method: string;
  readonly resourceType?: string;
  readonly startedAt: string;
};

export type CorrelationQuery = {
  readonly url: string;
  readonly method: string;
  readonly resourceType?: string;
  readonly startedAt: string;
};

/**
 * 在候选里找**时间最近**的那一个。
 *
 * 规则(V1 字面):URL 全等 + method 全等 + 类型归一后匹配 + 时间差 ≤ 10s,
 * 多个满足时取时间差最小的。
 *
 * ⚠️ 配不上返回 `null` —— 这不是兜底,是**如实说配不上**。
 * 调用方据此走 degradation 留痕,而不是硬塞给一个不相干的请求。
 */
export function findClosestMatch(
  candidates: readonly CorrelationCandidate[],
  query: CorrelationQuery,
): string | null {
  const queryAt = Date.parse(query.startedAt);
  if (Number.isNaN(queryAt)) return null;

  let best: { id: string; delta: number } | null = null;
  for (const candidate of candidates) {
    if (candidate.url !== query.url) continue;
    if (candidate.method !== query.method) continue;
    if (!resourceTypesMatch(candidate.resourceType, query.resourceType)) continue;
    const candidateAt = Date.parse(candidate.startedAt);
    if (Number.isNaN(candidateAt)) continue;
    const delta = Math.abs(candidateAt - queryAt);
    if (delta > CORRELATION_WINDOW_MS) continue;
    if (!best || delta < best.delta) {
      best = { id: candidate.id, delta };
    }
  }
  return best?.id ?? null;
}
