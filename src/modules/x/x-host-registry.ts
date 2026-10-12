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
 *
 * ── ⭐ 2026-10-02:连 **URL** 一起登记(对称性所需)──
 *
 * 用户:「在左边操作,右边自动识别行为并填写上参数?」
 * 右栏要认出左栏在哪一页,就得知道左栏**当前 URL**。
 * ⭐ 走**这同一条通路**,不新开第二条 ——
 * 两条通路会漂,而漂的表现是「wcId 是这个页的、URL 是上一页的」,
 * 于是右栏按旧 URL 填参数、按新 wcId 发操作,**自动填的和实际采的不是同一页**
 * (`control-types.ts` 的 `identify` 注释原话就警告了这一条)。
 */

type Listener = () => void;

/** 左栏当前状态 —— ⭐ wcId 与 url **同一条记录**,不许分两张表 */
export type XHostState = {
  readonly wcId: number;
  /** 左栏 webview 当前显示的 URL;还没导航过时为 '' */
  readonly url: string;
};

const stateByWs = new Map<string, XHostState>();
const listeners = new Set<Listener>();

function notify(): void {
  for (const l of listeners) l();
}

/**
 * 左栏 webview 就绪 / 导航时登记。
 * ⚠️ 同 ws 重复登记会覆盖(重建 webview、以及每次导航时都是对的)。
 */
export function setXHostState(wsId: string, wcId: number, url: string): void {
  const prev = stateByWs.get(wsId);
  // 幂等,免得白白通知(两个字段都没变才算没变)
  if (prev && prev.wcId === wcId && prev.url === url) return;
  stateByWs.set(wsId, { wcId, url });
  notify();
}

/** 左栏卸载时清掉 —— ⚠️ 不清的话右栏会拿着一个已销毁的 wcId 反复失败 */
export function clearXHostState(wsId: string): void {
  if (!stateByWs.has(wsId)) return;
  stateByWs.delete(wsId);
  notify();
}

/** 取某个 ws 的状态。⚠️ 没有就返回 null,**不兜底到别的 ws** */
export function getXHostState(wsId: string): XHostState | null {
  return stateByWs.get(wsId) ?? null;
}

/** 订阅变化(给 `useSyncExternalStore` 用);返 unsubscribe */
export function subscribeXHost(cb: Listener): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/**
 * ⭐⭐ X 网页「正忙」—— 2026-10-08 运营的人页加了「点人 → X 网页跳到他主页」。
 *
 * ⚠️ 操作台正在用这个 webview 采集时,跳走会**打断采集**(载荷监听挂在当前页上)。
 * 所以采集方登记「忙」,想导航的一方先问一句;忙就不跳,并且**说出来**为什么没跳。
 * 按 wcId 记 —— 忙的是那个 webview,不是哪个 ws。
 */
const busyByWc = new Map<number, string>();

export function setXHostBusy(wcId: number, reason: string | null): void {
  if (reason === null) {
    if (!busyByWc.delete(wcId)) return;
  } else {
    if (busyByWc.get(wcId) === reason) return;
    busyByWc.set(wcId, reason);
  }
  notify();
}

/** 返回忙的原因;不忙返回 null */
export function getXHostBusy(wcId: number): string | null {
  return busyByWc.get(wcId) ?? null;
}
