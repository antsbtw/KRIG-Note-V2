/**
 * 采集监视器 —— **被动**观察:你在左边浏览 X,我在右边实时显示抓到了什么。
 *
 * 用户 2026-09-02 定的验证方式:
 * 「建议增加一个采集验证页,左边是原推文页,右边是采集显示页,我在左边操作,
 *   你在右边显示抓取的 item 内容,如果我切换任何页面,都能保证抓取这些内容,
 *   这个函数就算大概过关。理论上应该加上统计,共滚动过多少个推文,
 *   成功采集了多少条才算。」
 *
 * 为什么这比我原来的「跑一遍然后报 ✅」强:
 *  · 我那个是**自己给自己打分** —— 校验逻辑和采集逻辑同源,一起错就一起瞎
 *  · 这个是**人眼对照**:屏幕上有什么、右边抓到什么,一眼看得出差异
 *  · 换任何页面都要能抓 —— 顺带证明它不是只对某一个页面调好的
 *
 * ⭐ 关键指标是**分母**:
 *   「滚过多少条」(DOM 里出现过的 article,按 tweetId 去重)
 *   vs「采到多少条」(从 GraphQL 载荷解析出来的)
 *   只有采集率接近 100% 才算过关。没有分母时,「抓到 81 条」根本说明不了问题
 *   —— 用户正是拿官网 433 次点击当分母,才发现我漏了 80%。
 */

import { webContents as allWebContents } from 'electron';
import { IPC_CHANNELS } from '@shared/ipc/channel-names';
import { resolveXWebContents } from './x-webcontents';
import { extractTweetsFrom, type HarvestedTweet } from './x-timeline-harvester';
import { TWEET_SCRAPE_FN_BODY } from '../tweet-fetcher/extract-script';

/** 原始载荷保留策略 —— 够验证用,又不至于撑爆内存/IPC */
const RAW_PAYLOAD_KEEP_COUNT = 8;
const RAW_PAYLOAD_KEEP_CHARS = 200_000;

interface MonitorState {
  wcId: number;
  /** 从 GraphQL 载荷采到的(权威数据) */
  captured: Map<string, HarvestedTweet>;
  /** DOM 里出现过的 tweetId —— **分母**:屏幕上滚过的 */
  seenInDom: Set<string>;
  /**
   * **当前屏幕上**的 id,按页面从上到下的顺序。
   * ⚠️ 不能拿 captured(Map 按「首次发现」排序)当展示顺序 ——
   * 那样右侧列的是「最近发现的」而不是「现在看到的」,与左侧完全对不上
   * (2026-09-02 实测:左边第一条在右边排到了最后)。
   */
  onScreen: string[];
  /** 最近一轮跳过的非推文元素数(广告) */
  lastSkipped: number;
  payloads: number;
  /**
   * ⭐ 最近几条**原始载荷** —— 验证用户说「这个数据明明有」时的唯一凭据。
   *
   * ⚠️ 此前 body 解完就扔,于是「X 压根没返回」与「返回了但我们没解出来」
   * **分不开** —— 而这两者的修法完全相反(去补采集 vs 去修解析器)。
   *
   * ⚠️ 只留最近 N 条、每条截断:一次 timeline 载荷可达几百 KB,
   * 全留会把内存和 IPC 都撑爆。
   */
  rawPayloads: Array<{ op: string; url: string; body: string; at: number; bytes: number }>;
  /**
   * ⭐ CDP 通道状态 —— **必须进快照,不能只进 console.log**。
   *
   * ⚠️ 用户 2026-09-18 遇到「载荷 0、右边没反应」,而真实状态
   * (attach 成没成、是不是共用别人的消息流、Network.enable 成没成)
   * 全在 console 里 —— 用户看不见、我也读不到,只能靠猜。
   * 用户定过的那条:「在后台能 log 这些操作,而不是靠我口头描述」。
   */
  cdpNote: string;
  /** ⭐ 用户在 X 上的操作流(最近 N 条)—— 与载荷对照才看得出因果 */
  actions: Array<{ t: number; kind: string; detail: string }>;
  /** ⭐ 悬浮卡采到的画像(按 handle 去重)*/
  hoverProfiles: Record<string, Record<string, unknown>>;
  /** 见过多少条 graphql 请求(区分「没请求」与「请求了但取不到 body」) */
  graphqlSeen: number;
  startedAt: number;
  domTimer: ReturnType<typeof setInterval> | null;
  onMessage: (e: unknown, method: string, params: any) => void;
  pending: Map<string, string>;
  attached: boolean;
}

let monitor: MonitorState | null = null;

/**
 * 扫当前 DOM:既取「滚过多少」(分母),也**顺带把内容抓下来**。
 *
 * ⚠️ 为什么不能只靠 CDP 拦截 GraphQL(2026-09-02 实测暴露):
 *   用户开始监视时页面**已经加载过**(scrollY=4884),那些推文是监视之前
 *   到达的 —— 不会再有新的 GraphQL 响应带它们。结果就是
 *   「滚过 14 / 采到 0 / 响应 0」,看着像彻底坏了,其实是时机问题。
 *   → DOM 这一路:屏幕上有什么就能抓什么,与何时开始监视无关。
 *
 * ── ⚠️ 一句被误记成「用户要求」的注释(2026-09-18 纠正)──
 *
 * 这里原本写着「载荷是**首选**,DOM 只补 CDP 没覆盖到的那部分」,
 * 而代码照此写成 `if (!captured.has(id))` —— 载荷抓到过就**整条不看 DOM**。
 *
 * 用户当时(2026-09-02)的原话是「**都能保证抓取这些内容**」,
 * 没说过谁优先谁兜底。「载荷优先」是 AI 自己的实现取舍,
 * 却以既定方针的口吻写进了注释,后来读的人(包括我)就当成用户定的了。
 *
 * ⭐ 用户 2026-09-18 纠正:「**我们需要的是并集哦**」。
 * 现在是**逐字段并集**:谁有值用谁,两边都有时载荷优先
 * (DOM 是渲染结果,会截断/本地化/省略成「1.2万」)。
 *
 * ⚠️ 教训:**别把自己的实现取舍写成「用户要求」**。
 * 注释里凡是写"用户定的",必须是原话;自己的判断要标明是自己的判断。
 */
/**
 * ⭐⭐ 屏幕扫描 —— **复用完整提取器**,不自己写精简版。
 *
 * ── 用户 2026-09-18 实机验证发现(截图为证)──
 *
 * 右侧只显示 `metrics: {"likes":51}` 与 `lang: —`,而左边页面上
 * **102 回复 / 1 转推 / 51 赞 / 2.5K 阅读** 四个数字都在,正文也明显是中文。
 *
 * 真因:这段脚本此前**自己只取 5 个字段**(id/handle/text/createdAt/likes)——
 * 不是「X 没给」,是我们压根没取。而仓里 `TWEET_SCRAPE_FN_BODY`
 * **早就抓全了**(lang / metrics 四项 / authorName / avatar / media),
 * 且已被 `x-timeline-scan` 复用 —— 唯独监视器另写了一份精简的。
 *
 * ⚠️ 与 `x-navigate` 那次同族:**仓里已有更好的实现,却另造了一份差的**。
 * 改法不是给精简版补字段,是**换成那份现成的**。
 *
 * ⚠️ 广告跳过计数必须保留:广告没有 <time>/status 链接,不是推文;
 * 但要**报出数字**,否则用户看到左边有右边没有,会以为漏采
 * (2026-09-02 实测:HubSpot 广告就是这种情况)。
 */
/**
 * ⭐⭐ 用户操作记录器 —— **后台要看得见人在 X 上做了什么**。
 *
 * ── 用户 2026-09-18 ──
 *
 * > 「我建议你在后台也能够观察到我在 x 上的操作以及操作结果才对呀。
 * >   否则那叫什么数据采集?」
 *
 * ⚠️ 此前监视器只做两件事:每 1.5s 扫 DOM、被动等 CDP 消息。
 * **用户点了什么、悬停了什么、页面怎么变的,全都不知道** ——
 * 于是每次都只能回头问「你点了吗」「有没有反应」,
 * 那正是用户定过的「靠口头描述,不健康」。
 *
 * ⭐ 关键价值不是"记录动作"本身,是**把动作与随后的网络请求对上** ——
 * 「悬停头像 → 没有任何请求」才证明得了「数据本来就在本地」。
 *
 * ⚠️ 幂等:重复注入不重复挂监听(靠 window.__xActLog 存在与否判断),
 * 否则每轮扫描挂一次,一分钟后同一个点击会被记 40 遍。
 * ⚠️ 用 capture 阶段 + passive:不干扰页面自身的事件处理。
 */
const INSTALL_ACT_RECORDER = `(function () {
  if (window.__xActLog) return { already: true };
  window.__xActLog = [];
  var push = function (kind, detail) {
    try {
      window.__xActLog.push({ t: Date.now(), kind: kind, detail: String(detail).slice(0, 120) });
      if (window.__xActLog.length > 200) window.__xActLog.shift();
    } catch (e) {}
  };

  // 描述一个元素:优先 testid,其次 aria-label,再次文字
  var describe = function (el) {
    if (!el || !el.closest) return '?';
    var t = el.closest('[data-testid]');
    var id = t ? t.getAttribute('data-testid') : null;
    var art = el.closest('article[data-testid="tweet"]');
    var who = '';
    if (art) {
      var un = art.querySelector('[data-testid="User-Name"]');
      if (un) {
        var sp = un.querySelectorAll('span');
        for (var i = 0; i < sp.length; i++) {
          var s = (sp[i].textContent || '').trim();
          if (s.indexOf('@') === 0) { who = ' @' + s.slice(1); break; }
        }
      }
    }
    var label = el.getAttribute && el.getAttribute('aria-label');
    var text = (el.textContent || '').trim().slice(0, 30);
    return (id || label || text || el.tagName.toLowerCase()) + who;
  };

  document.addEventListener('click', function (e) {
    push('click', describe(e.target));
  }, true);

  // 悬停:只记进入「头像/用户名」这类会弹卡片的区域,否则会刷屏
  var lastHover = 0;
  document.addEventListener('mouseover', function (e) {
    var el = e.target;
    if (!el || !el.closest) return;
    var hot = el.closest('[data-testid="User-Name"], [data-testid^="UserAvatar"], a[href^="/"][role="link"]');
    if (!hot) return;
    var now = Date.now();
    if (now - lastHover < 400) return;   // 同一次移动会触发很多次
    lastHover = now;
    push('hover', describe(hot));
  }, true);

  var lastY = window.scrollY, lastScroll = 0;
  window.addEventListener('scroll', function () {
    var now = Date.now();
    if (now - lastScroll < 600) return;
    lastScroll = now;
    var dy = window.scrollY - lastY;
    lastY = window.scrollY;
    if (Math.abs(dy) < 50) return;
    push('scroll', 'y=' + Math.round(window.scrollY) + ' (' + (dy > 0 ? '+' : '') + Math.round(dy) + ')');
  }, { passive: true, capture: true });

  return { installed: true };
})()`;

/**
 * ⭐⭐ 扫**悬浮卡** —— 一张卡 = 一份完整画像,零网络请求。
 *
 * ── 用户 2026-09-18 的洞察 ──
 *
 * > 「关键这里还有 bio 数据呀?这样就不一定逐个翻页就可以获取 bio 数据了。」
 *
 * 对。悬浮卡上有 bio / 粉丝数 / 关注数 / 关注状态 / 蓝V / 共同关注 ——
 * 与 `harvestAuthorProfile` 拿到的几乎一样,而后者要**导航到那人主页 + 等 12 秒**。
 * 盘点里 bio 只有 155/8021(2%),正是因为那条路太贵。
 *
 * ⭐ 而且实测证实(用户的操作流):**悬停弹卡片零网络请求** ——
 * 数据本来就在前端内存里,悬停只是把它渲染出来。所以这是白拿的。
 *
 * ⚠️ 卡片的 DOM 结构**仓里零记录**,所以这里:
 *  ① 用**宽判据**找卡片(HoverCard 没有稳定 testid,靠「浮层里有 Follow 按钮」定位)
 *  ② **把原始结构一并带回**(rawHtml 截断),量不准时能当场看清该怎么改
 *  ③ 解不出来就**不返回**,绝不编一个空壳
 */
const SCAN_HOVER_CARD = `(function () {
  // 卡片没有稳定 testid;靠特征找:含 -follow/-unfollow 按钮、且不是 article 内部
  var btns = document.querySelectorAll('[data-testid$="-follow"], [data-testid$="-unfollow"]');
  for (var i = 0; i < btns.length; i++) {
    var btn = btns[i];
    if (btn.closest('article[data-testid="tweet"]')) continue;   // 那是推文里的,不是卡片

    // 往上找到卡片容器:带阴影的浮层。取按钮的第 4~8 层祖先里最像卡片的
    var card = btn;
    for (var up = 0; up < 8 && card.parentElement; up++) {
      card = card.parentElement;
      if (card.querySelector && card.querySelectorAll('a[href^="/"]').length >= 2
          && (card.textContent || '').length > 40) break;
    }
    if (!card) continue;

    var ftid = btn.getAttribute('data-testid') || '';
    var restId = ftid.replace(/-(un)?follow$/, '');

    // handle:卡片里以 @ 开头的 span
    var handle = '';
    var sp = card.querySelectorAll('span');
    for (var j = 0; j < sp.length; j++) {
      var t = (sp[j].textContent || '').trim();
      if (t.indexOf('@') === 0) { handle = t.slice(1); break; }
    }
    if (!handle) continue;

    // 关注/粉丝数:找 href 以 /following /verified_followers /followers 结尾的链接
    var following = null, followers = null;
    var links = card.querySelectorAll('a[href]');
    for (var k = 0; k < links.length; k++) {
      var href = links[k].getAttribute('href') || '';
      var num = (links[k].textContent || '').replace(/[^0-9.KMkm]/g, '');
      if (!num) continue;
      if (/\/following$/.test(href)) following = num;
      else if (/followers$/.test(href)) followers = num;
    }

    // bio:卡片里最长的那段文字,且不是链接、不含数字统计
    var bio = '';
    var divs = card.querySelectorAll('div[dir]');
    for (var m = 0; m < divs.length; m++) {
      var txt = (divs[m].textContent || '').trim();
      if (txt.length > bio.length && txt.length < 400
          && txt.indexOf('@') !== 0 && !/Following\s|Followers/.test(txt)) bio = txt;
    }

    return {
      handle: handle,
      restId: /^[0-9]+$/.test(restId) ? restId : null,
      iFollow: /-unfollow$/.test(ftid),
      followingText: following,
      followersText: followers,
      bio: bio,
      isBlueVerified: !!card.querySelector('[data-testid="icon-verified"]'),
      rawHtml: card.innerHTML.slice(0, 600)
    };
  }
  return null;
})()`;

/** 取走并清空已攒的操作 —— 每轮扫描调一次 */
const DRAIN_ACT_LOG = `(function () {
  if (!window.__xActLog) return [];
  var out = window.__xActLog.slice();
  window.__xActLog.length = 0;
  return out;
})()`;

const SCAN_DOM_IDS = `(function () {
  ${TWEET_SCRAPE_FN_BODY}
  var out = [];
  var skipped = 0;
  var arts = document.querySelectorAll('article[data-testid="tweet"]');
  for (var i = 0; i < arts.length; i++) {
    var art = arts[i];
    var t = art.querySelector('time');
    var a = t && t.closest('a[href*="/status/"]');
    if (!a) { skipped++; continue; }
    var m = (a.getAttribute('href') || '').match(/status\\/(\\d+)/);
    if (!m) { skipped++; continue; }

    var d = {};
    try { d = scrapeTweetArticle(art) || {}; } catch (e) { d = { __err: String(e) }; }

    out.push({
      id: m[1],
      handle: d.authorHandle || '',
      authorName: d.authorName || '',
      authorAvatar: d.authorAvatar || '',
      text: (d.text || '').slice(0, 280),
      createdAt: (d.createdAt || (t ? (t.getAttribute('datetime') || '') : '')),
      lang: d.lang || '',
      isBlueVerified: d.isBlueVerified,
      iFollow: d.iFollow,
      authorRestId: d.authorRestId || '',
      followEvidence: d.followEvidence || '',
      verifiedEvidence: d.verifiedEvidence || '',
      metrics: d.metrics || {},
      media: d.media || [],
      tweetUrl: d.tweetUrl || '',
      inReplyTo: d.inReplyTo || '',
      inReplyToUser: d.inReplyToUser || '',
      quotedTweet: d.quotedTweet || ''
    });
  }
  return { items: out, skipped: skipped, scrollY: window.scrollY,
    docH: Math.max(document.body.scrollHeight, document.documentElement.scrollHeight),
    url: location.href };
})()`;

export interface MonitorSnapshot {
  running: boolean;
  /** 此刻屏幕上有多少条(用于「屏幕 N 条,采到 M 条」的即时比对) */
  onScreenCount: number;
  /** 本轮跳过的非推文元素(广告等,无 time/status 链接)—— 不算漏采 */
  skippedAds: number;
  /** 屏幕上滚过的条数(去重)—— 分母 */
  seenInDom: number;
  /** 实际采到的条数 —— 分子 */
  captured: number;
  /** 采集率 = 分子/分母 */
  captureRate: number;
  /** DOM 里见过但**没采到**的 —— 这些就是漏网的,逐个列出便于定位 */
  missing: string[];
  payloads: number;
  elapsedSec: number;
  currentUrl?: string;
  scrollY?: number;
  /**
   * 最近采到的几条,供人眼与左边页面对照。
   *
   * ⚠️⚠️ **2026-09-15 补全字段**(用户:「建议补全,进一步做画像会需要的」)。
   * 此前只传 7 个字段,而载荷层 `HarvestedTweet` 有 20 多个 ——
   * `inReplyToStatusId`(回复了**哪一条**)、完整 metrics、`self`(我赞过没)
   * 全被裁掉了。**采到了但传不出来**,是「静默丢信息」的一种:
   * main 侧日志看着正常,右边面板永远显示不了这些。
   */
  recent: Array<{
    tweetId: string;
    authorHandle?: string;
    /** 作者数字 id —— username 会改名,rest_id 不会,做画像时按它匹配最稳 */
    authorRestId?: string;
    text: string;
    createdAt?: string;
    lang?: string;
    isReply: boolean;
    /** ⭐ 回复的是**哪一条**(权威字段,来自载荷 in_reply_to_status_id_str) */
    inReplyToStatusId?: string;
    /** 回复给谁 */
    inReplyToScreenName?: string;
    /** 会话根 —— 判「这条属于哪个楼」 */
    conversationId?: string;
    /** 引用了哪条 */
    quotedStatusId?: string;
    /** 这条推**自己**带图/视频(不含链接预览卡、不含引用原文里的图) */
    hasMedia: boolean;
    mediaTypes?: string[];
    isLongText: boolean;
    /** ⭐ 完整互动数 —— 此前只传了 likes */
    metrics: {
      likes?: number; retweets?: number; replies?: number;
      quotes?: number; bookmarks?: number; views?: number;
    };
    /** ⭐ 我自己对这条的状态(登录态 webview 独有,零额外请求) */
    self: { favorited?: boolean; retweeted?: boolean; bookmarked?: boolean };
    /** true = 从 DOM 兜底抓的(字段较少);false = 从 GraphQL 载荷抓的(字段全) */
    fromDom: boolean;
  }>;
  /**
   * ⭐ 最近几条**原始载荷**(截断)——「X 没给」与「我们没解出来」靠它分清。
   *
   * 用户 2026-09-18 定的验证方式:人在 X 上操作,右侧列出采到的一切,
   * 人核对哪里漏了。⚠️ 人说「这个数据明明有」时,必须能当场翻原始载荷 ——
   * 否则只能靠猜,而两种成因的修法完全相反。
   */
  rawPayloads: Array<{ op: string; url: string; body: string; at: number; bytes: number }>;
  /** ⭐ CDP 通道状态 —— 「载荷 0」时唯一能说清是哪一环断的东西 */
  cdpNote: string;
  /**
   * ⭐⭐ 用户在 X 上的操作流 —— 后台看得见人做了什么。
   * 与 rawPayloads 的时间戳对照,就能回答「这个动作触发请求了吗」。
   */
  actions: Array<{ t: number; kind: string; detail: string }>;
  /**
   * ⭐⭐ 悬浮卡采到的画像 —— **白拿的 bio / 粉丝数 / 关注状态**。
   *
   * 用户 2026-09-18:「关键这里还有 bio 数据呀?这样就不一定逐个翻页
   * 就可以获取 bio 数据了。」
   *
   * 一张卡 ≈ 一次 harvestAuthorProfile,而后者要导航到那人主页 + 等 12 秒。
   * 盘点里 bio 只有 155/8021(2%),正是因为那条路太贵。
   */
  hoverProfiles: Record<string, Record<string, unknown>>;
  /** 见过多少条 graphql 请求 */
  graphqlSeen: number;
}

function snapshot(extra?: { url?: string; scrollY?: number }): MonitorSnapshot {
  if (!monitor) {
    return { running: false, onScreenCount: 0, skippedAds: 0, seenInDom: 0, captured: 0, captureRate: 0,
      missing: [], payloads: 0, elapsedSec: 0, recent: [], rawPayloads: [], cdpNote: '(未开始)', graphqlSeen: 0, actions: [], hoverProfiles: {} };
  }
  // ⚠️ 分母只算「DOM 见过的」:GraphQL 可能返回更多(如被折叠的回复),
  //    那不算漏 —— 漏的定义是**屏幕上出现过却没采到**。
  const missing = [...monitor.seenInDom].filter((id) => !monitor!.captured.has(id));
  // ⭐ **按屏幕顺序列出**(用户 2026-09-02:「把采集到的推文显示在右侧,
  //    这样我一眼就可以比对到是否采集了」)。
  //    此前用 captured 的插入序 = 「最近发现的」,与左侧顺序完全不同,
  //    左边第一条会排到右边最后 —— 看着像"对不上",其实是排序错了。
  //    现在:先列当前屏幕上的(顺序一致),屏幕上没有的不列。
  const onScreenTweets = monitor.onScreen
    .map((id) => monitor!.captured.get(id))
    .filter((t): t is HarvestedTweet => !!t);
  /**
   * ⚠️ 正文放宽到 280 字:140 是推文的旧上限,长推(isLongText)会被腰斩,
   * 而「重点内容」正需要看全。再长的由 UI 决定折不折叠,不在这里截。
   */
  const recent = onScreenTweets.map((t) => ({
    tweetId: t.tweetId,
    authorHandle: t.authorHandle,
    authorRestId: t.authorRestId,
    text: t.text.slice(0, 280),
    createdAt: t.createdAt,
    lang: t.lang,
    isReply: !!t.inReplyToStatusId,
    inReplyToStatusId: t.inReplyToStatusId,
    inReplyToScreenName: t.inReplyToScreenName,
    conversationId: t.conversationId,
    quotedStatusId: t.quotedStatusId,
    hasMedia: t.hasMedia,
    mediaTypes: t.mediaTypes,
    isLongText: t.isLongText,
    isBlueVerified: t.isBlueVerified,
    authorBio: t.authorBio,
    iFollow: t.iFollow,
    followEvidence: t.followEvidence,
    followsMe: t.followsMe,
    verifiedEvidence: t.verifiedEvidence,
    authorName: t.authorName,
    authorAvatar: t.authorAvatar,
    tweetUrl: t.tweetUrl,
    media: t.media,
    metrics: t.metrics,
    self: t.self,
    fromDom: (t as HarvestedTweet & { fromDom?: boolean }).fromDom === true,
  }));
  return {
    running: true,
    onScreenCount: monitor.onScreen.length,
    skippedAds: monitor.lastSkipped,
    seenInDom: monitor.seenInDom.size,
    captured: monitor.captured.size,
    captureRate: monitor.seenInDom.size
      ? Math.round((monitor.seenInDom.size - missing.length) * 1000 / monitor.seenInDom.size) / 10
      : 0,
    missing: missing.slice(0, 20),
    payloads: monitor.payloads,
    rawPayloads: monitor.rawPayloads,
    cdpNote: monitor.cdpNote,
    actions: monitor.actions,
    hoverProfiles: monitor.hoverProfiles,
    graphqlSeen: monitor.graphqlSeen,
    elapsedSec: Math.round((Date.now() - monitor.startedAt) / 1000),
    currentUrl: extra?.url,
    scrollY: extra?.scrollY,
    recent,
  };
}

/** 把快照推给所有 renderer(右侧面板实时刷新) */
function broadcast(snap: MonitorSnapshot): void {
  for (const wc of allWebContents.getAllWebContents()) {
    if (wc.isDestroyed()) continue;
    try { wc.send(IPC_CHANNELS.X_CAPTURE_UPDATE, snap); } catch { /* 忽略已销毁 */ }
  }
}

/**
 * 开始监视 —— **不主动滚动**,只观察用户的操作。
 * 用户换页、滚动、点开任何菜单,都应该照样采到。
 */
export async function startCaptureMonitor(
  targetWcId?: number,
): Promise<{ ok: true } | { error: string }> {
  if (monitor) return { ok: true };

  const resolved = resolveXWebContents(targetWcId);
  if ('error' in resolved) return { error: resolved.error };
  const wc = resolved.wc;

  const captured = new Map<string, HarvestedTweet>();
  const seenInDom = new Set<string>();
  // onScreen 每轮重建 —— 它反映「此刻屏幕上有什么」,不是累计
  const pending = new Map<string, string>();

  const state: MonitorState = {
    wcId: wc.id, captured, seenInDom, onScreen: [], lastSkipped: 0, payloads: 0,
    rawPayloads: [],
    cdpNote: '(未就绪)',
    actions: [],
    hoverProfiles: {},
    graphqlSeen: 0,
    startedAt: Date.now(), domTimer: null, pending, attached: false,
    onMessage: (_e, method, params) => {
      if (method === 'Network.requestWillBeSent') {
        const u: string = params?.request?.url ?? '';
        if (u.includes('/i/api/graphql/')) { pending.set(params.requestId, u); state.graphqlSeen++; }
        return;
      }
      if (method === 'Network.loadingFinished') {
        if (!pending.has(params.requestId)) return;
        const pendingUrl = pending.get(params.requestId);
        pending.delete(params.requestId);
        wc.debugger.sendCommand('Network.getResponseBody', { requestId: params.requestId })
          .then((r: any) => {
            if (!r?.body) return;
            state.payloads++;
            // ⭐ 留一份原始载荷(截断)——「X 没给」与「我们没解出来」靠它分清
            const url = pendingUrl ?? '';
            state.rawPayloads.push({
              op: url.match(/\/graphql\/[^/]+\/(\w+)/)?.[1] ?? '(未知操作)',
              url,
              bytes: r.body.length,
              body: r.body.slice(0, RAW_PAYLOAD_KEEP_CHARS),
              at: Date.now(),
            });
            if (state.rawPayloads.length > RAW_PAYLOAD_KEEP_COUNT) state.rawPayloads.shift();
            try { extractTweetsFrom(JSON.parse(r.body), captured); } catch { /* 非 JSON */ }
          })
          .catch(() => { /* 响应体可能已丢弃 */ });
      }
    },
  };

  // ⚠️ 这里曾经 `catch {}` 吞掉一切 —— 实测后果:采到 0 / 响应 0,
  //    而界面上没有任何错误,典型的静默坍缩。必须把真实状态报出来。
  let attachNote = '';
  if (wc.debugger.isAttached()) {
    // 已被别处 attach(如 AI SSE 拦截器):可以共用消息流,但不能重复 attach
    state.attached = false;
    attachNote = '(debugger 已被其他模块 attach,共用消息流)';
  } else {
    try {
      wc.debugger.attach('1.3');
      state.attached = true;
    } catch (err) {
      return { error: `CDP attach 失败,无法采集:${String(err)}` };
    }
  }

  wc.debugger.on('message', state.onMessage);
  try {
    await wc.debugger.sendCommand('Network.enable');
  } catch (err) {
    wc.debugger.off('message', state.onMessage);
    if (state.attached) { try { wc.debugger.detach(); } catch { /* ignore */ } }
    return { error: `Network.enable 失败,抓不到任何响应:${String(err)}` };
  }
  /**
   * ⭐ 把「attach 到了**哪个** webContents」写进状态。
   *
   * ⚠️ 用户 2026-09-18 实测:CDP「就绪(独占 attach)」但
   * **见过的 graphql 请求 = 0** —— attach 成功却收不到任何消息。
   * 最可能是 attach 到了**宿主页面**而不是 X 的 webview guest:
   * 那样 Network.enable 照样成功,但看不到 X 的流量。
   * 光说「就绪」没用,必须说清**就绪在谁身上**。
   */
  const wcUrl = (() => { try { return wc.getURL(); } catch { return '(取不到)'; } })();
  const wcType = (() => { try { return wc.getType(); } catch { return '?'; } })();
  state.cdpNote = `就绪${attachNote || '(独占 attach)'} · wcId=${wc.id} · type=${wcType} · ${wcUrl.slice(0, 60)}`;
  console.log(`[x-capture-monitor] CDP ${state.cdpNote}`);

  // 每 1.5s 扫一次 DOM,累计「滚过的」并推送快照
  state.domTimer = setInterval(() => {
    if (wc.isDestroyed()) { stopCaptureMonitor(); return; }

    /**
     * ⭐ 每轮都确保记录器在(幂等,已装则立即返回)。
     * ⚠️ 必须每轮装:X 是 SPA,但整页刷新/换 ws 会把注入的监听清掉,
     * 只在启动时装一次的话,刷新后操作流就**静默停止**了 ——
     * 而现象是「面板不动」,看着像功能坏了。
     */
    wc.executeJavaScript(INSTALL_ACT_RECORDER).catch(() => { /* 页面切换中 */ });
    wc.executeJavaScript(DRAIN_ACT_LOG)
      .then((acts: Array<{ t: number; kind: string; detail: string }>) => {
        if (!Array.isArray(acts) || acts.length === 0) return;
        state.actions.push(...acts);
        if (state.actions.length > 60) state.actions.splice(0, state.actions.length - 60);
      })
      .catch(() => { /* 页面切换中 */ });

    // ⭐ 顺手扫悬浮卡 —— 有就白拿一份画像(bio/粉丝数/关注状态)
    wc.executeJavaScript(SCAN_HOVER_CARD)
      .then((card: Record<string, unknown> | null) => {
        if (!card || typeof card.handle !== 'string' || !card.handle) return;
        const h = String(card.handle).toLowerCase();
        // ⚠️ 已有就不覆盖:第一次采到的最完整(卡片收起过程中会解出残缺版)
        if (!state.hoverProfiles[h]) {
          state.hoverProfiles[h] = { ...card, at: Date.now() };
        }
      })
      .catch(() => { /* 页面切换中 */ });

    wc.executeJavaScript(SCAN_DOM_IDS)
      .then((r: {
        /** ⚠️ 形状跟着 SCAN_DOM_IDS 走 —— 那边换成完整提取器后,这里必须同步,
         *  否则新抓到的字段在这一步被**默默丢掉**(改了一半比没改更难查)。*/
        items: Array<{
          id: string; handle: string; authorName?: string; authorAvatar?: string;
          text: string; createdAt: string; lang?: string;
          isBlueVerified?: boolean; verifiedEvidence?: string;
          iFollow?: boolean; authorRestId?: string; followEvidence?: string;
          metrics?: { replies?: number; retweets?: number; likes?: number; views?: number };
          media?: Array<{ type: string; url: string; thumbUrl?: string }>;
          tweetUrl?: string; inReplyTo?: string; inReplyToUser?: string; quotedTweet?: string;
        }>;
        skipped: number; scrollY: number; docH: number; url: string;
      }) => {
        state.lastSkipped = r.skipped ?? 0;
        // 每轮重建:这是「此刻屏幕上的顺序」,与左侧页面一一对应
        state.onScreen = (r.items ?? []).map((it) => it.id);
        for (const it of r.items ?? []) {
          seenInDom.add(it.id);
          // DOM 兜底:载荷没覆盖到的,用屏幕上的内容补 —— 但**不覆盖**已有的,
          // 因为载荷字段更全(会话根/自身互动状态/长推全文)
          /**
           * ⭐⭐ **逐字段并集** —— 不是「载荷有了就整条丢掉 DOM」。
           *
           * ── 用户 2026-09-18 纠正 ──
           *
           * > 「我们需要的是并集哦」
           *
           * ⚠️ 此前这里是 `if (!captured.has(it.id))` —— 载荷抓到过这条,
           * DOM 那份就**整个不看**。后果:载荷里没有的 authorName /
           * authorAvatar / media / tweetUrl **跟着一起丢**,
           * 而那几项**只有 DOM 拿得到**。
           *
           * 这条逻辑的来历(注释自述,2026-09-02):当时 DOM 是**兜底**,
           * 任务是「数分母」(滚过多少条),内容只是"顺带"抓的 ——
           * 验收标准是**采集率**,没人检查字段全不全。
           * 今天改成「列出所有数据、人来核对」,字段完整性才第一次被检查。
           *
           * ⭐ 规则:**谁有值用谁;两边都有时载荷优先**
           * (DOM 是渲染结果,会截断/本地化/省略成「1.2万」)。
           */
          const prev = captured.get(it.id);
          const domSide = {
            authorName: it.authorName || undefined,
            authorAvatar: it.authorAvatar || undefined,
            tweetUrl: it.tweetUrl || undefined,
            media: it.media?.length ? it.media : undefined,
          };

          if (!prev) {
            captured.set(it.id, {
              tweetId: it.id,
              authorHandle: it.handle.replace(/^@/, '') || undefined,
              text: it.text,
              createdAt: it.createdAt || undefined,
              isLongText: false,
              // ⚠️ DOM 路径**判不出长文**:页面上长文卡片与普通推的 DOM 一样,
              //    article 结构只在载荷里。与 has_media 同理,宁可报 false
              //    也不猜 —— 统计宁可少算,不可虚报。
              isArticle: false,
              // ⚠️ DOM 兜底**不判 has_media**:页面上分不清「用户上传的图」与
              // 「外链预览卡」,而契约明确预览卡不算。宽了会误发活动奖励,
              // 故一律 false —— 活动核验只采信载荷路径(fromDom=false)。
              hasMedia: false,
              // ⭐ 四项互动数全带上(此前只有 likes —— 用户实机验证当场看出来的:
              //    左边 102 回复/1 转推/51 赞/2.5K 阅读,右边只有 likes)
              metrics: it.metrics ?? {},
              lang: it.lang || undefined,
              isBlueVerified: it.isBlueVerified,
              iFollow: it.iFollow,
              authorRestId: it.authorRestId || undefined,
              followEvidence: it.followEvidence || undefined,
              verifiedEvidence: it.verifiedEvidence || undefined,
              inReplyToStatusId: it.inReplyTo || undefined,
              inReplyToScreenName: it.inReplyToUser || undefined,
              self: {},
              ...domSide,
              fromDom: true,
            });
          } else {
            /**
             * 已有载荷版本 —— **只补它没有的**,绝不覆盖载荷已有的值。
             * ⚠️ `fromDom` 保持原样:这条推的**主体**来自哪一路不因补字段而变,
             * 否则「这条是载荷抓的还是 DOM 抓的」就说不清了。
             */
            const merged = { ...prev };
            let changed = false;
            for (const [k, v] of Object.entries(domSide)) {
              if (v !== undefined && (merged as Record<string, unknown>)[k] === undefined) {
                (merged as Record<string, unknown>)[k] = v;
                changed = true;
              }
            }
            // DOM 能补的还有:载荷偶尔缺 lang / metrics 某几项
            if (!merged.lang && it.lang) { merged.lang = it.lang; changed = true; }
            if (it.metrics) {
              const m = { ...(merged.metrics ?? {}) } as Record<string, number | undefined>;
              let mChanged = false;
              for (const [k, v] of Object.entries(it.metrics)) {
                if (typeof v === 'number' && m[k] === undefined) { m[k] = v; mChanged = true; }
              }
              if (mChanged) { merged.metrics = m; changed = true; }
            }
            if (changed) captured.set(it.id, merged);
          }
        }
        broadcast(snapshot({ url: r.url, scrollY: r.scrollY }));
      })
      .catch(() => { /* 页面切换中,下轮再来 */ });
  }, 1500);

  monitor = state;
  console.log('[x-capture-monitor] 开始监视 —— 请在左侧自由浏览/滚动/换页');
  return { ok: true };
}

export function stopCaptureMonitor(): MonitorSnapshot {
  if (!monitor) return snapshot();
  const final = snapshot();
  if (monitor.domTimer) clearInterval(monitor.domTimer);
  const wc = allWebContents.fromId(monitor.wcId);
  if (wc && !wc.isDestroyed()) {
    wc.debugger.off('message', monitor.onMessage);
    if (monitor.attached) { try { wc.debugger.detach(); } catch { /* 已 detach */ } }
  }
  console.log(`[x-capture-monitor] 停止 —— 滚过 ${final.seenInDom} 条, `
    + `采到 ${final.captured} 条, 采集率 ${final.captureRate}%`);
  monitor = null;
  return final;
}

export function getCaptureSnapshot(): MonitorSnapshot {
  return snapshot();
}
