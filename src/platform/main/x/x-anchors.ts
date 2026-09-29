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
/**
 * ⭐ 在**真页面**上量蓝V徽章的 DOM 结构。
 *
 * ── 为什么要量而不是猜(用户 2026-09-18 实机验证发现缺蓝V)──
 *
 * 蓝V的 selector **全仓没有任何实测记录** —— 只有「抓画像」那条路
 * 从**载荷**里解过(`x-author-profile.ts:93`)。DOM 这边一片空白。
 *
 * ⚠️ 与 X 左栏 12 个 tab 那次同理:凭记忆写 selector 会写出
 * 「看着对、其实不存在」的东西,而且**采集恒空且不报错**。
 * 实测过的才敢写进锚点表 —— 那 12 个里就有 3 个压根没有 testid。
 *
 * 用法:面板 →「输出」→ 读蓝V结构 → 把真实结构贴回来再写提取代码。
 */
/**
 * ⭐⭐ 探 X 页面**内存里**的 user 数据 —— 用户 2026-09-18 的判断:
 *
 * > 「我一直认为数据缓存在内存或者硬盘了。」
 *
 * 磁盘已排除(实测):
 *  · IndexedDB 9.5MB —— localforage 存的是 UI 偏好(主题/自动播放/提示已读),
 *    外加 15 万个数字 id(曝光去重之类),**画像字段一个都搜不到**
 *  · HTTP Cache 287MB —— X 的 API 响应带 no-store,**不进磁盘缓存**
 *
 * 所以数据在**页面 JS 的内存**里(React/Redux store),进程一关就没。
 * 而内存里的东西,唯一的拿法是**在页面上下文执行 JS 去读**。
 *
 * ⚠️ 本脚本**只探不取**:先回答「数据在哪个全局变量下」,
 * 拿到真实结构再写提取 —— 与蓝V那次同理,**量出来再写,不猜**。
 */
export const PROBE_X_MEMORY = `
(function () {
  var found = [];
  var seen = new Set();

  // 在一个对象里找「像 user 的东西」:有 screen_name 或 legacy.screen_name
  function looksLikeUser(o) {
    if (!o || typeof o !== 'object') return false;
    if (typeof o.screen_name === 'string') return true;
    if (o.legacy && typeof o.legacy.screen_name === 'string') return true;
    if (o.core && typeof o.core.screen_name === 'string') return true;
    return false;
  }

  function walk(node, path, depth) {
    if (depth > 6 || found.length > 12) return;
    if (!node || typeof node !== 'object') return;
    if (seen.has(node)) return;
    seen.add(node);

    if (looksLikeUser(node)) {
      var u = node.legacy || node.core || node;
      found.push({
        path: path,
        screenName: u.screen_name || null,
        hasBio: typeof (u.description) === 'string',
        hasFollowers: typeof (u.followers_count) === 'number',
        hasRelationship: !!(node.relationship_perspectives || typeof u.followed_by === 'boolean'),
        keys: Object.keys(node).slice(0, 12)
      });
      return;
    }

    var ks = Object.keys(node);
    for (var i = 0; i < ks.length && i < 40; i++) {
      try { walk(node[ks[i]], path + '.' + ks[i], depth + 1); } catch (e) {}
    }
  }

  // 候选入口:X 常用的几个全局
  var roots = [];
  for (var k in window) {
    if (!/^__|store|STORE|state|STATE|initial|Initial/.test(k)) continue;
    try { roots.push({ name: k, v: window[k] }); } catch (e) {}
  }

  for (var r = 0; r < roots.length && found.length < 12; r++) {
    try { walk(roots[r].v, 'window.' + roots[r].name, 0); } catch (e) {}
  }

  return {
    globalCandidates: roots.map(function (x) { return x.name; }).slice(0, 25),
    userObjectsFound: found
  };
})()
`.trim();

export const READ_VERIFIED_BADGE = `
(function () {
  var out = [];
  var arts = document.querySelectorAll('article[data-testid="tweet"]');
  for (var i = 0; i < arts.length && i < 8; i++) {
    var art = arts[i];
    var un = art.querySelector('[data-testid="User-Name"]');
    if (!un) { out.push({ __noUserName: true }); continue; }

    // 把 User-Name 区域里所有**非文本节点**的特征全列出来,让人看见有什么
    var svgs = [];
    var nodes = un.querySelectorAll('svg, img, [data-testid]');
    for (var j = 0; j < nodes.length; j++) {
      var el = nodes[j];
      svgs.push({
        tag: el.tagName.toLowerCase(),
        testid: el.getAttribute('data-testid') || null,
        ariaLabel: el.getAttribute('aria-label') || null,
        cls: (el.getAttribute('class') || '').slice(0, 60) || null,
        // SVG 的 path d 前 40 字符 —— 不同徽章图形不同,可据此区分蓝V/金V/灰V
        pathHead: el.tagName.toLowerCase() === 'svg'
          ? ((el.querySelector('path') || {}).getAttribute
              ? (el.querySelector('path').getAttribute('d') || '').slice(0, 40) : null)
          : null,
      });
    }

    var handle = '';
    var sp = un.querySelectorAll('span');
    for (var k = 0; k < sp.length; k++) {
      var t = (sp[k].textContent || '').trim();
      if (t.indexOf('@') === 0) { handle = t; break; }
    }

    out.push({ handle: handle, userNameHtml: un.innerHTML.slice(0, 300), marks: svgs });
  }
  return out;
})()
`.trim();

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
