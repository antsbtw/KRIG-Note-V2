/**
 * X 的 webview 句柄登记处 —— ⭐ **模块自带,不借 capability**
 *
 * ── 要解决的问题 ──
 *
 * Console 在**右栏**,而 webview 在**左栏**:右栏要调 `goto` 得知道
 * 左栏那个 guest 的 `wcId`。两个 view 是独立的,互相拿不到对方的 ref。
 *
 * ⭐ 做法:左栏 webview 一就绪就把 wcId 登记在这里,右栏订阅取用。
 * ⚠️ Mail 把这件事放进 `capability`,X **不跟** —— 那会让模块多依赖一个
 * capability,而本模块的原则是「删一个目录就卸载干净」。
 * 这张表是 X 自己的,跟着模块走。
 *
 * ── ⚠️ 按 ws 分 ──
 *
 * 多窗口/多 workspace 下每个 ws 各有一个 X webview。
 * 不分 ws 的话,右栏会拿到**别的 ws** 的 wcId ——
 * 现象是「在 A 窗口点 goto,B 窗口的页面跳了」
 * (记忆 `project-host-broadcast-multi-ws-fanout` 的同族)。
 */

type Listener = () => void;

const wcIdByWs = new Map<string, number>();
const listeners = new Set<Listener>();

function notify(): void {
  for (const l of listeners) l();
}

/** 左栏 webview 就绪时登记。⚠️ 同 ws 重复登记会覆盖(重建 webview 时是对的) */
export function setXHostWcId(wsId: string, wcId: number): void {
  if (wcIdByWs.get(wsId) === wcId) return;   // 幂等,免得白白通知
  wcIdByWs.set(wsId, wcId);
  notify();
}

/** 左栏卸载时清掉 —— ⚠️ 不清的话右栏会拿着一个已销毁的 wcId 反复失败 */
export function clearXHostWcId(wsId: string): void {
  if (!wcIdByWs.has(wsId)) return;
  wcIdByWs.delete(wsId);
  notify();
}

/** 取某个 ws 的 wcId。⚠️ 没有就返回 null,**不兜底到别的 ws** */
export function getXHostWcId(wsId: string): number | null {
  return wcIdByWs.get(wsId) ?? null;
}

/** 订阅变化(给 `useSyncExternalStore` 用);返 unsubscribe */
export function subscribeXHost(cb: Listener): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
