/**
 * X 的锚点表 —— **adapter 的活**(`01-contract.md` §14)
 *
 * ⭐ 底座(`web.input` / `web.page`)**不认识任何 selector**。
 * 它只认语义锚点名,由这张表翻译成 selector。站点改版时**只改这一个文件**。
 *
 * ── 为什么查不到要返回 null ──
 *
 * 原样返回锚点名会让「名字打错了」变成「一个查不到东西的 selector」——
 * 于是「锚点没登记」和「元素不在页面上」混成同一个失败,排查时分不开。
 * 返回 null 让前者变成明确的契约违反。(与 `MapAnchorResolver` 同源。)
 *
 * ── ⚠️ 这张表目前只有「已在生产代码里验证过」的 selector ──
 *
 * 左栏 tab 在真实 X 上有 ~12 个,而全仓**只出现过 `AppTabBar_Profile_Link` 一个**。
 * 其余的 testid **没有任何离线证据** —— 不写进这张表,
 * 而是留给验收台在真页面上读出来再补(见 `listAppTabBarAnchors` 的说明)。
 *
 * ⭐ **不猜 selector**:猜错的表现是 `tap` 报「未找到可点的 X」,
 * 与「这个 tab 真不存在」长得一模一样,而且会让人去改根本没坏的代码。
 */

import type { AnchorResolver } from '../web-capability/input';

/**
 * 语义锚点名 → selector。
 *
 * 命名约定:`区域.元素`,与 X 的 DOM 结构无关 —— 它是**我们的**词汇表,
 * 站点改版改的是右边的值,左边的名字不动(这才是「改版只改一层」)。
 */
export const X_ANCHORS: Readonly<Record<string, string>> = {
  // ── 左栏导航(控制:点任意 tab)──
  // ⚠️ 只有这一个有生产代码佐证(`x-self-account.ts:49`)
  'nav.profile': '[data-testid="AppTabBar_Profile_Link"]',
  'nav.accountSwitcher': '[data-testid="SideNav_AccountSwitcher_Button"]',

  // ── 推文(输出:读;输入:互动)──
  'tweet.article': 'article[data-testid="tweet"]',
  'tweet.text': '[data-testid="tweetText"]',
  'tweet.row': '[data-testid="cellInnerDiv"]',
  'tweet.replyButton': '[data-testid="reply"]',
  'tweet.likeButton': '[data-testid="like"]',
  'tweet.unlikeButton': '[data-testid="unlike"]',
  'tweet.socialContext': '[data-testid="socialContext"]',
  'tweet.userName': '[data-testid="User-Name"]',

  // ── 撰写(输入)──
  'compose.sendButton': '[data-testid="tweetButton"]',
};

/**
 * 生产版锚点解释器。
 *
 * ⚠️ 查不到返回 null —— 调用方据此 Failed,**不返回空串、不原样回显**。
 */
export class XAnchorResolver implements AnchorResolver {
  constructor(private readonly table: Readonly<Record<string, string>> = X_ANCHORS) {}

  resolve(anchor: string): string | null {
    return this.table[anchor] ?? null;
  }

  /** 已登记的锚点名 —— 验收台列给人看,免得靠记忆猜名字 */
  names(): string[] {
    return Object.keys(this.table);
  }
}

/**
 * ⚠️ **左栏 tab 的真实 testid 尚未采集** —— 这不是遗漏,是刻意留白。
 *
 * 截图上左栏有 ~12 个 tab(首页/搜索/通知/社区/消息/Grok/书签/职位/认证/个人资料/更多/发帖),
 * 但全仓只验证过 `AppTabBar_Profile_Link`。要补齐,应当在**真页面上读**:
 * 验收台的「控制」页跑一次本脚本,把结果填进 `X_ANCHORS`。
 *
 * ⭐ 这正是验收台存在的意义之一:**先看见事实,再写进代码**,
 * 而不是照着印象写一张表、再花一天查「为什么点不动」。
 */
export const READ_APP_TAB_BAR = `
(function () {
  var out = [];
  var nodes = document.querySelectorAll('[data-testid^="AppTabBar"], nav a[role="link"]');
  for (var i = 0; i < nodes.length; i++) {
    var el = nodes[i];
    out.push({
      testid: el.getAttribute('data-testid') || null,
      href: el.getAttribute('href') || null,
      label: (el.textContent || '').trim().slice(0, 20),
    });
  }
  return out;
})()
`.trim();
