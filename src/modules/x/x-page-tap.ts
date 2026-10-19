/**
 * ⭐ 逐页账的旁路 —— 每记一页账,把这一页的原始载荷递给挂上来的监听(P2 2026-10-19,存基线样本用)
 *
 * 为什么放在 `ledgerFor`:搜索滚动 / 人卡 / 后台三条路径都经过它,一处挂上三条都有。
 * ⚠️ 纯模块,不碰 fs —— `ledgerFor` 在 renderer(操作台)里也跑。
 * ⚠️⚠️ 模块级状态每进程一份(记忆 feedback-per-process-module-state):只有主进程的 dev 收件箱会挂,
 * renderer 那份永远没人挂、什么也不做 —— 操作台的采集不会被存样本,这是预期。
 */
export type TappedPage = {
  readonly page: number;
  readonly label: string;
  readonly items: readonly { readonly url: string; readonly status?: number; readonly text: string }[];
};

let tap: ((p: TappedPage) => void) | null = null;

/** 挂 / 摘(传 null)。同时只有一个 */
export function setPageTap(fn: ((p: TappedPage) => void) | null): void {
  tap = fn;
}

export function tapPage(p: TappedPage): void {
  if (!tap) return;
  try { tap(p); } catch (e) {
    /** 旁路坏了不能拖垮采集,但要响 */
    console.error(`[x.page-tap] 监听出错:${e instanceof Error ? e.message : String(e)}`);
  }
}
