/**
 * ⭐ 抽查请求(renderer 侧)—— X 网页轮询到的最新一条,运营面板订阅它弹卡片(2026-10-16)
 * ⚠️ 按 ws 分开:两个 ws 各抽各的,不串。
 */
export type SpotReq = {
  readonly seq: number; readonly wsId: string; readonly kind: 'tweet' | 'person';
  readonly tweetId?: string; readonly handle?: string; readonly text?: string; readonly why?: string;
  readonly url: string; readonly at: string;
};

const byWs = new Map<string, SpotReq | null>();
const listeners = new Set<() => void>();

export function setSpot(wsId: string, r: SpotReq | null): void {
  byWs.set(wsId, r);
  for (const l of listeners) l();
}
export function getSpot(wsId: string): SpotReq | null { return byWs.get(wsId) ?? null; }
export function subscribeSpot(l: () => void): () => void { listeners.add(l); return () => listeners.delete(l); }
