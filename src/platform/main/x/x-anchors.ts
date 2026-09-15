/**
 * X 的锚点表 —— **adapter 的活**(`01-contract.md` §14)
 *
 * ⭐ 底座(`web.input` / `web.page`)**不认识任何 selector**。
 * 它只认语义锚点名,由这张表翻译成 selector。站点改版时**只改一处**。
 *
 * ── ⚠️ 写方向 selector **从 `X_PROFILE.selectors` 派生,不另抄一份** ──
 *
 * 初版我在这里手写了一张 11 条的表,结果:
 *  ① **漏掉了输入框**(`composeBox`)—— 于是控制台「输入」页无锚点可选,
 *    我还据此断言「这项做不了、要等真机读 testid」。
 *    ⚠️ 而用户当场指出:note 点发推填进输入框**早就实现过** ——
 *    能力(`focusInputBox`)与 selector(`composeBox`)一直都在,是我另立了弱表。
 *  ② `compose.sendButton` 写成单候选 `tweetButton`,而 profile 是
 *    `tweetButtonInline, tweetButton` **双候选** —— 内联回复框用的正是前者。
 *    也就是说我抄出来的那份**比原件弱**。
 *
 * 同一份 selector 两处并存 = 改一处漏一处,而现象是「点不动 / 找不到」,
 * 与「元素真不在页面上」长得一模一样。所以写方向一律 `X_PROFILE.selectors` 取值。
 *
 * ── 读方向为什么还留在本文件 ──
 *
 * profile 的读方向只有 `tweetElement` 一条;`tweetText` / `like` / `reply` 这些
 * 是本仓 extract-script 长期在用、但**没有进 profile** 的。它们留在这里,
 * 并且**只写有生产代码佐证的**(见文件末「不猜 selector」)。
 */

import type { AnchorResolver } from '../web-capability/input';
import { X_SERVICE_PROFILES } from '@shared/types/x-service-types';

/** 唯一的 X profile(`X_SERVICE_PROFILES` 目前只有一个,取第一个即可) */
const X_PROFILE = X_SERVICE_PROFILES[0];

/**
 * 语义锚点名 → selector。
 *
 * 命名约定:`区域.元素`,与 X 的 DOM 结构无关 —— 它是**我们的**词汇表,
 * 站点改版改的是右边的值,左边的名字不动(这才是「改版只改一层」)。
 */
export const X_ANCHORS: Readonly<Record<string, string>> = {
  // ── 写方向:⭐ 全部来自 profile,本文件不写死任何 selector 字面量 ──
  'compose.box': X_PROFILE.selectors.composeBox ?? '',
  'compose.replyBox': X_PROFILE.selectors.replyBox ?? X_PROFILE.selectors.composeBox ?? '',
  // ⚠️ 仅用于**定位校验**内容落进了正确的框 —— 写方向红线:绝不程序 click
  'compose.sendButton': X_PROFILE.selectors.publishButton ?? '',
  'compose.fileInput': X_PROFILE.selectors.fileInput ?? '',
  'compose.uploadedThumb': X_PROFILE.selectors.uploadedMediaThumb ?? '',

  // ── 读方向:profile 只有 tweetElement,其余是 extract-script 长期在用的 ──
  'tweet.article': X_PROFILE.selectors.tweetElement,
  'tweet.text': '[data-testid="tweetText"]',
  'tweet.row': '[data-testid="cellInnerDiv"]',
  'tweet.replyButton': '[data-testid="reply"]',
  'tweet.likeButton': '[data-testid="like"]',
  'tweet.unlikeButton': '[data-testid="unlike"]',
  'tweet.socialContext': '[data-testid="socialContext"]',
  'tweet.userName': '[data-testid="User-Name"]',

  // ── 左栏导航 ──
  //
  // ⭐ 2026-09-15 **真页面读出来的**(控制台 readTabBar,留痕 `x.tabbar-read`):
  //   11 个节点,8 个带 testid。以下全部有实测依据,不是猜的。
  'nav.home': '[data-testid="AppTabBar_Home_Link"]',
  'nav.explore': '[data-testid="AppTabBar_Explore_Link"]',
  'nav.notifications': '[data-testid="AppTabBar_Notifications_Link"]',
  'nav.follow': '[data-testid="AppTabBar_Follow_Link"]',
  'nav.messages': '[data-testid="AppTabBar_DirectMessage_Link"]',
  'nav.profile': '[data-testid="AppTabBar_Profile_Link"]',
  'nav.more': '[data-testid="AppTabBar_More_Menu"]',
  // ⚠️ 命名体系与其它不同(不是 AppTabBar_*),照实抄,不强行统一
  'nav.premium': '[data-testid="premium-signup-tab"]',
  //
  // ⚠️⚠️ 下面三个**真页面上就没有 testid**(readTabBar 实测 testid=null),
  //   只有 href。**不给它们编一个 testid** —— 编出来的 selector 找不到元素时,
  //   与「这个 tab 不存在」长得一模一样(本文件开头那条教训)。
  //   href 是 X 自己的路由,比 testid 更稳;`a[href="..."]` 是合法 CSS。
  'nav.grok': 'a[href="/i/grok"]',
  'nav.history': 'a[href="/i/history"]',
  'nav.creatorStudio': 'a[href="/i/jf/creators/studio"]',
  //
  // 账号切换器:来自 `x-self-account.ts`,不在 tabbar 里
  'nav.accountSwitcher': '[data-testid="SideNav_AccountSwitcher_Button"]',
};

/**
 * 生产版锚点解释器。
 *
 * ⚠️ 查不到返回 null —— 调用方据此 Failed,**不返回空串、不原样回显**。
 * 原样回显会让「锚点名打错了」表现为「查了个空,什么也没找到」,
 * 与「元素不在页面上」混成同一个失败。
 *
 * ⚠️ 值为空串的条目(profile 里该字段没配)同样返回 null ——
 * 空 selector 会让 `querySelector('')` 抛,表现成「注入失败」而不是「没配」。
 */
export class XAnchorResolver implements AnchorResolver {
  constructor(private readonly table: Readonly<Record<string, string>> = X_ANCHORS) {}

  resolve(anchor: string): string | null {
    const sel = this.table[anchor];
    return sel ? sel : null;
  }

  /** 已登记且**真有值**的锚点名 —— 验收台列给人看,免得选到空条目 */
  names(): string[] {
    return Object.keys(this.table).filter((k) => this.table[k]);
  }
}

/**
 * ⚠️ **左栏 tab 的真实 testid 尚未采集齐** —— 这不是遗漏,是刻意留白。
 *
 * 截图上左栏有 ~12 个 tab(首页/搜索/通知/社区/消息/Grok/书签/职位/认证/个人资料/更多/发帖),
 * 但全仓只验证过 `AppTabBar_Profile_Link`。要补齐,应当在**真页面上读**:
 * 控制台「输出」页跑 `readTabBar`,把结果填进 `X_ANCHORS`。
 *
 * ⭐ 这正是控制台存在的意义之一:**先看见事实,再写进代码**,
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
