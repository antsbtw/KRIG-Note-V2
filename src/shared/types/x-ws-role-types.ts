/**
 * X per-ws 角色 —— **一个 ws 只干一件事**。
 *
 * 用户 2026-09-03 拍板:
 * 「把任务分开,停掉 x 中的爬虫任务,而专注在这个任务上」
 * 「按照方案 A(开第二个 ws),然后如果对方想触发提取也可以通过 ws 的配置项构建」
 *
 * 为什么需要角色:一个 ws 里只有一个 X webview,而定时搜索采集、活动核验、
 * 载荷勘查都要导航它。互相打断的后果是**谁都做不好** ——
 * 搜索导航到搜索页,活动这边正在抓的 conversation 就断了。
 *
 * 隔离基础已就绪:X webview 的 partition 是 `persist:webview-${wsId}`
 * (x-extraction/Host.tsx),所以**两个 ws 可以各自登录同一个 X 账号**,
 * 登录态互不干扰 —— 这是方案 A 可行的前提。
 *
 * ── 架构原则(用户 2026-09-03 定)────────────────────────────────
 * 「不同的 ws 要可以不同的用户登录,做不同的操作。可以同时多个 ws 在不同的
 *   账号下做不同的操作,也可以同一个账号下做不同的操作,这才是架构合理的地方。」
 *
 * 即 **ws × 账号 × 角色 三者自由组合**,四种都要成立:
 *   ① 不同账号 + 不同角色(A 号搜索,B 号活动)
 *   ② 同一账号 + 不同角色(同号开两窗,一个搜索一个活动)
 *   ③ 不同账号 + 相同角色(两个号各自搜索)
 *   ④ 同一账号 + 相同角色(同号两窗分担同类工作)
 *
 * ⚠️ 支撑它的关键约束:**唯一性只建在 ws_id 上,绝不建在 handle 上**。
 *    给 handle 加 UNIQUE 会让 ②④ 立刻不成立,而现象是「第二个 ws 存不进去」,
 *    排查时容易误判成写入 bug。守卫见 tests/x/ws-account-matrix.test.ts。
 *
 * ⚠️ 唯一的全局性约束是 `servesRefresh`(接口 B 的端口只能有一个占用者),
 *    它按 ws 排他,与账号无关。
 */

/** ws 在 X 模块里承担的角色 */
export type XWsRole =
  /** 定时搜索采集(现有行为):跑 search_recipes、AI 判断 */
  | 'search'
  /** 活动核验:只抓指定文章的 conversation,供 campaign-tasks 契约用 */
  | 'campaign'
  /** 未声明 —— 不参与任何**定时**任务,但仍可手动操作(右键提取等) */
  | 'idle';

export interface XWsRoleConfig {
  wsId: string;
  role: XWsRole;
  /**
   * role='campaign' 时:要盯的文章 id。
   *
   * ⚠️ 留空则自动识别「最新一篇 Article」(载荷里的 `article` 字段,已实测可取)。
   * 但**活动指定的是某一篇** —— 你发了新 Article 后自动识别会跟着漂,
   * 所以正式活动务必显式钉死 id,别让程序猜。
   */
  articleId?: string;
  /**
   * role='campaign' 时:是否由本 ws 承接接口 B(POST /refresh)。
   * 用户 2026-09-03:「如果对方想触发提取也可以通过 ws 的配置项构建」——
   * 即「谁来响应外部触发」是配置决定的,不写死。
   * 多个 campaign ws 时只允许一个为 true(否则端口冲突)。
   */
  servesRefresh?: boolean;
  /** 主动抓取间隔(分钟);留空用默认 3 分钟 */
  intervalMinutes?: number;
}

export const DEFAULT_X_WS_ROLE: XWsRole = 'idle';

/** 主动抓取默认间隔:太密撞风控,太疏用户等得久(有接口 B 兜底,不必激进) */
export const DEFAULT_CAMPAIGN_INTERVAL_MINUTES = 3;
