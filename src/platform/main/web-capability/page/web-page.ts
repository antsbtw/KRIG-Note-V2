/**
 * `web.page` 对外接口(`06-data-model-and-interfaces.md` §3.1)
 *
 * 本步(步 1)交付的是**纯逻辑核心**:`find` / `facts` / `lease` / `release` 已实现,
 * 因为它们纯内存、可完全单测。
 *
 * ⚠️ `goto` / `ready` / `prepare` **本步只定签名,不实现** ——
 * 它们要真 `webContents` 才能验证,按步 1 范围「凡是需要真实 Electron 运行时才能验证的,
 * 本步都先不做」。签名按 `06` §3.1 定死,接线时只填实现、不改形状。
 *
 * ⭐ 接口里**没有任何一处出现 wcId / webContents** —— 这是不变量 3
 * (`06` §1.5:应用只见页面对象,永远拿不到 wcId / webContents)的机器强制点。
 */

import type { Result } from '../result';
import type { Lease, PageFacts, PageId, PageQuery } from './types';

/**
 * `goto` 的目标是**语义**,不是 URL(`06` §3.1)。
 *
 * ⚠️ **不接受裸 URL** —— URL 是 adapter 的知识。
 * 站点改版时变的是 URL,不变的是「我要去发推页」,这是「改版只改一层」的直接兑现。
 *
 * 用 branded type 让「随手传个 URL 字符串」在类型层面就过不去,
 * 与 `06` §3.3 的 `run` 只收脚本 id 是同一手法。
 */
export type PageTarget =
  | (string & { readonly __brand: 'web.page.PageTarget' })
  | { readonly custom: string; readonly params?: Readonly<Record<string, string>> };

/** `ready` 的判据。同样是语义名,由 adapter 解释成具体探测 */
export type ReadyCriterion = string & { readonly __brand: 'web.page.ReadyCriterion' };

/** `prepare` 的加载环境改写(`06` §3.1 第四类动作:在页面加载之前改变规则)*/
export type PrepareEnvironment = {
  readonly responseHeaders?: Readonly<Record<string, string | null>>;
  readonly userAgent?: string;
  readonly referer?: string;
  /**
   * 剥 CSP。⚠️ 有安全代价(翻译现在把它限制在专用 partition)。
   * 按 `06` §0 边界:底座只提供「能改」,**改不改、改什么由应用决定**,
   * 底座不内置策略、也不替应用判断哪些站「可以」剥。
   */
  readonly stripCsp?: boolean;
};

/** `prepare` 的作用对象:一个页面,或一整个 partition */
export type PrepareTarget =
  | { readonly kind: 'page'; readonly pageId: PageId }
  | { readonly kind: 'partition'; readonly partition: string };

/**
 * `web.page` —— 控制能力:找到它、去哪儿、等它好。
 *
 * 注意所有失败路径都是三态里的 `Failed`,没有 null、没有空值假装成功(`06` §4.2)。
 */
export interface WebPage {
  /**
   * 按事实条件找页面。
   * ⭐ **如实返回全部命中,不排序、不筛选、不替调用方挑**(`06` §2.2)。
   * 恰好一个 / 零个 / 多个,都由**应用**决定怎么办。
   */
  find(query?: PageQuery): PageFacts[];

  /** 位置 + 状态快照。页面不存在时 `Failed`,不返回 null */
  facts(pageId: PageId): Result<PageFacts>;

  /**
   * 去某个语义页面。⚠️ 不接受裸 URL。
   * 【本步未实现 —— 需真 webContents】
   */
  goto(pageId: PageId, target: PageTarget): Promise<Result<PageFacts>>;

  /**
   * 等页面达到某个判据。
   * 【本步未实现 —— 需真 webContents】
   */
  ready(pageId: PageId, criterion: ReadyCriterion, timeoutMs: number): Promise<Result<PageFacts>>;

  /**
   * 占用页面。已被占用时 `Failed(retryable=true)`,**不排队、不抢占** ——
   * 「谁该让谁」是应用层判断。
   */
  lease(pageId: PageId, purpose: string, ttlMs?: number): Result<Lease>;

  /** 释放租约。不是当前持有者时 `Failed`,不静默顶掉别人的租约 */
  release(lease: Lease): Result<void>;

  /**
   * 在页面加载之前改变规则(改响应头 / UA / referer / 剥 CSP)。
   * 【本步未实现 —— 需真 session/webRequest】
   */
  prepare(target: PrepareTarget, environment: PrepareEnvironment): Promise<Result<void>>;
}
