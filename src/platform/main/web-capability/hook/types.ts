/**
 * `web.hook` —— **页面内网络钩子**(M4)的类型
 *
 * ── 为什么要这一层(`docs/handoff/web-acquisition-methods.md` §二 M4)──
 *
 * 用户 2026-10-02:
 * 「要**充分利用几种方法**获取数据,而不是单独依赖 CDP。」
 * 「我们的 web 能力层应该具备**所有获取网页内容的能力**才对…
 * 　这样未来获取各个社区、论坛、开放媒体的内容都是可以的。」
 *
 * ⭐ 本层在**页面上下文**覆写 `XMLHttpRequest` 与 `fetch`,
 * 在响应回到站点自己代码**之前**截一份。
 *
 * ── ⚠️ 与 CDP(M1)的关系:**互证,不是择一** ──
 *
 * 2026-10-02 七轮排查的根因不是哪条腿坏了,而是**没有第二个视角可以互证** ——
 * 一条腿收不到时,分不清「站点没发」还是「我们没收到」。
 * ⭐ 所以本层与 M1 的留痕**各记各的,绝不合并计数**
 * (同 `CaptureSession` 的三态:合成一个数就分不清成因)。
 *
 * ── ⭐ 相对 CDP 的优势(搜社区确认)──
 *
 * · 请求在页面里发出、我们在页面里接 —— **没有通道争用、没有编号配对、没有竞态**
 *   (CDP 那条腿的三个坑:DevTools 抢通道 / webRequest↔CDP 两套 id /
 *    attach 晚于首次请求)
 * · 流式响应也拿得到(在 reader 上分叉),而 `getResponseBody` 拿不到
 *
 * ── ⚠️ 代价(写清楚,不装作没有)──
 *
 * · 必须在**站点脚本之前**注入(`Page.addScriptToEvaluateOnNewDocument`),
 *   晚一步就钩不住 —— 社区把这叫「赢得原型竞赛」
 * · 站点若检测原型被改,可能触发反爬(X 目前不检测)
 * · 页面内代码**不可信**:它跑在站点的上下文里,拿回来的东西是**数据不是指令**
 */

import type { PageId } from '../page/types';

/** 一条被钩到的响应 —— ⭐ 形状刻意与 `CapturedPayload` 对齐,便于两条腿对账 */
export type HookedResponse = {
  readonly pageId: PageId;
  /** 'xhr' | 'fetch' —— ⭐ 记下是哪条路钩到的,两者行为不同 */
  readonly via: 'xhr' | 'fetch';
  readonly url: string;
  readonly method: string;
  readonly status: number;
  /** 响应体原文。⚠️ **不截断、不丢弃**(用户:「要保持信息的完整性,而不是片段」) */
  readonly text: string;
  readonly byteLength: number;
  /** 页面侧的时间戳(ISO) */
  readonly at: string;
};

/** 钩子的统计 —— ⚠️ 与 CDP 那条腿**分开计**,不合并 */
export type HookStats = {
  /** 钩到并送回来的 */
  readonly hooked: number;
  /** 页面侧钩到了但送回失败(binding 异常/载荷过大被分片丢失) */
  readonly lost: number;
  /** 当前攒着几条 */
  readonly held: number;
  readonly running: boolean;
  /** ⚠️ 注入是否真的生效 —— 没生效时 `hooked` 恒 0,但那是两种完全不同的事 */
  readonly injected: boolean;
};

/**
 * 页面钩子的宿主接口 —— ⭐ 能力层**零 Electron**,真正发 CDP 命令的是这个接缝。
 * (与 `PageHost` / `ControlHost` 同款:守卫 `page-boundary-guard` 钉着)
 */
export interface HookHost {
  /** 宿主标识 —— 用于「每个宿主只装一次」 */
  readonly hostId: number;
  /**
   * 注册一个页面可调用的函数名。页面里调 `window[name](payload)`,
   * 宿主通过 `onBindingCalled` 把 payload 送回来。
   * ⭐ CDP 的 `Runtime.addBinding` 就是为此设计的。
   */
  addBinding(name: string): Promise<void>;
  /**
   * 注册「每个新文档创建时、**站点脚本之前**」执行的脚本。
   * ⭐ CDP 的 `Page.addScriptToEvaluateOnNewDocument` ——
   * 这是「赢得原型竞赛」的唯一正规手段。
   * @returns 脚本标识(将来要移除时用)
   */
  addScriptOnNewDocument(source: string): Promise<string>;
  /** 页面调用 binding 时回调 */
  onBindingCalled(listener: (name: string, payload: string) => void): void;
  /** 立刻在**当前**文档里执行一次 —— 给「已经加载完的页面」补注入 */
  evaluateNow(source: string): Promise<void>;
}
