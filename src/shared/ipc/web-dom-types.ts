/**
 * `renderer → web.dom` 的 IPC 契约(L2 收口最后一块)
 *
 * ⚠️ 本文件在 `shared/`,**只放纯数据类型** —— renderer / preload / main 共用。
 * 不 import `@platform` / `@capabilities`(分层边界)。
 *
 * ── 为什么要这层(设计见 docs/handoff/web-dom-ipc-surface-design.md §〇)──
 *
 * renderer 侧 18 处裸注入,实测四个缺陷:
 *  ① `sync-driver` 有 **26 处静默吞异常、零日志** —— 违反可靠性纲领 §44
 *  ② `replace(/__KRIG_SIDE__/g, …)` 把运行时值**文本替换进脚本源码**,
 *     与 `project-x-inject-template-escape` 同机制,**且已经咬过一次**
 *  ③ 9 处把运行时值拼进脚本(含数字 —— `JSON.stringify(NaN)` → `null` → 浏览器当 0)
 *  ④ 零留痕:完全绕过 `trace` / `raw`,出事查不到「往页面里塞了什么」
 *
 * ⭐ 而「社区论坛自动化」会让这四条**随每个新站点线性增长** —— 这才是必要性。
 */

/**
 * ⭐ renderer 怎么指认一个页面。
 *
 * ⚠️⚠️ 用 renderer 手上的 `webview.getWebContentsId()`,**绝不让 main 侧猜**:
 * 不用 activeWs、不用「最后 navigate 的那个」。
 * `page-registry.ts:15` 记过这条血泪 ——
 * 「底座替应用做了选择,而它没资格做:它不知道业务意图。
 * 　实测后果:日志说注入成功,但右栏框是空的」。
 */
export type WebDomPageRef = {
  /** guest `<webview>` 的 webContents id */
  readonly wcId: number;
};

/** 脚本参数 —— ⚠️ 一律由 main 侧 `JSON.stringify` 绑定,renderer 给不了脚本文本 */
export type WebDomParams = Readonly<Record<string, string | number | boolean>>;

/**
 * 一次调用。⭐ **带 `op` 的单通道**,不是每个方法一条通道
 * (逐个开意味着每加能力就动通道表,而
 * `feedback-guard-hardcoded-list-never-grows` 已栽过三次)。
 *
 * ⚠️ 这里**没有** `runDynamic` —— 求值任意脚本的口子不对 renderer 开放。
 *
 * ── ⚠️ 为什么只有 `run` 一个 op(2026-09-30 实测)──
 *
 * `WebDom` 接口声明了 6 个方法(run/read/query/text/selection/runDynamic),
 * 但**全仓零实现** —— `grep "implements WebDom"` 零命中,
 * 只有 `ElectronDomRunner.run` 真的落地了。
 * 又是「**建好了没接线**」那个形态(同 `recordRequestStart` 零调用、
 * `ready`/`scrollUntil` 掉出公开面)。
 *
 * ⭐ 所以本层**只开 `run`** —— 开 `read`/`query`/`text`/`selection`
 * 就是给 renderer 一个**空头承诺**:调了必然失败,而失败原因是
 * 「底座没实现」而不是调用方的错,排查方向完全被带偏。
 * 等它们真的实现了再加 op,**那时本类型是唯一改动点**。
 */
export type WebDomInvoke =
  | { readonly op: 'run'; readonly pageRef: WebDomPageRef; readonly scriptId: string; readonly params?: WebDomParams };

/**
 * 回传的三态结果 —— 与 `web-capability/result.ts` 同构。
 *
 * ⭐ 为什么不直接复用那个类型:它在 `@platform` 下,`shared/` 不许 import。
 * 形状保持一致,main 侧原样转。
 *
 * ⚠️ **`degraded` 必须显式处理**,不许当 Ok ——
 * 那正是「点了就当成了」这类病的入口。
 */
export type WebDomResult =
  | { readonly status: 'ok'; readonly value: unknown }
  | { readonly status: 'failed'; readonly reason: string; readonly retryable: boolean }
  | { readonly status: 'degraded'; readonly value: unknown; readonly missing: readonly string[] };
