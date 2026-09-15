/**
 * pageId → 真实 `WebContents` 的反查 —— **接线层唯一的身份落地点**
 *
 * ── 为什么必须有这个文件 ──
 *
 * `ElectronControlHost` / `ElectronInputHost` 都要一个
 * `WebContentsLookup = (pageId) => WebContents | null`,但全仓**没有任何人提供它**:
 * `x-net-capture.ts` 的 `pageIdByWc` 是**单向**的(wc.id → pageId),反过来查不到。
 * 于是 `ControlEngine` / `InputEngine` 写好了、测过了、**零处 new** ——
 * 与 `recordRequestStart` 零调用是同一种形态:**建好了没接线**。
 *
 * ⚠️ **不放进 `PageRegistry`**:那一层是纯逻辑、零 Electron 依赖,
 * 有守卫(`page-boundary-guard`)锁死「除 `wiring/` 外零处 Electron」。
 * 把 `WebContents` 塞进去会破掉整层可单测的前提。
 *
 * ── ⚠️ 一条实测约束:没有人清理页面 ──
 *
 * `pageRegistry.destroy()` **全仓零调用**,`subscribeLifecycle` **零订阅者**,
 * X / AI 也都不在 wc 销毁时清 `pageIdByWc`。也就是说:
 * **登记过的页面永远不会被注销。**
 *
 * 所以本表**不能**依赖 `page-destroyed` 事件来清理 —— 那个事件根本不会来。
 * 改为**查询时验活**:拿到已销毁的 wc 就地丢弃并返回 null,
 * 让引擎翻成一个诚实的 Failed(「页面已关闭」),
 * 而不是把一个死对象交出去、在 `executeJavaScript` 里炸出无关的错。
 */

import type { WebContents } from 'electron';
import type { PageId } from '../page/types';

/** pageId → wc。⚠️ 只在 `wiring/` 内部可见,不对业务层导出 */
const hosts = new Map<PageId, WebContents>();

/**
 * 登记一个页面的真实宿主。
 *
 * ⭐ **每个 `pageRegistry.register()` 的调用点都必须跟一次本函数** ——
 * 漏掉哪家,哪家就「登记了页面但控制/输入调不动」,且**不报错**
 * (`lookup` 返回 null → 引擎 Failed「没有对应的渲染目标」,
 *  看起来像页面关了,实际是没接线)。
 *
 * 目前三个调用点:`x-net-capture.xPageId` / `ai-interceptor` 两处。
 */
export function bindPageHost(pageId: PageId, wc: WebContents): void {
  hosts.set(pageId, wc);
}

/**
 * 反查宿主。**拿不到返回 null,不抛** —— 由引擎翻成三态 Failed。
 *
 * ⚠️ 验活是必须的,不是保险:见文件头「没有人清理页面」。
 */
export function lookupWebContents(pageId: PageId): WebContents | null {
  const wc = hosts.get(pageId);
  if (!wc) return null;
  if (wc.isDestroyed()) {
    // 就地丢弃 —— 否则这张表会越积越多死对象,
    // 且每次查询都把死对象交出去,错误信息指向完全错误的方向
    hosts.delete(pageId);
    return null;
  }
  return wc;
}

/** 解绑(页面确实没了时)。目前无人调用 —— 留给将来真正接上生命周期时用 */
export function unbindPageHost(pageId: PageId): void {
  hosts.delete(pageId);
}

/**
 * 当前绑定数 —— 给验收台的「页面清单」用:
 * **屏幕上开着几个页面,这里就该是几条**。多了=有幽灵页面,少了=有页面没接线。
 */
export function boundPageCount(): number {
  return hosts.size;
}

/** 列出当前绑定(验收台用;返回 pageId 与是否仍存活) */
export function listBoundPages(): Array<{ pageId: PageId; alive: boolean }> {
  return Array.from(hosts.entries()).map(([pageId, wc]) => ({
    pageId,
    alive: !wc.isDestroyed(),
  }));
}
