/**
 * X 时间线通用采集器 —— **一个函数,把某个页面上 X 会显示的推文全部拿下**。
 *
 * 用户 2026-09-02 定的做法:
 * 「先做好网页自动滚动,获取全部 X 上显示的推文的函数吧,**包含校验方法**。
 *   这个函数过关再考虑其他的问题。也就是点开那个菜单,
 *   都能够获取完整的 X 显示的推文及元数据。」
 *
 * ── 为什么要单独抽出来 ──────────────────────────────────────────
 * 滚动逻辑此前散在三个文件里(reply-collector / payload-inspector /
 * author-timeline-spike),同样的 bug 要修三遍,而且**每次都以为修好了**。
 * 实测代价:用户拿官网点击数据一核对 —— 10 天 433 条回复,库里只有 81 条(19%)。
 *
 * ── 踩过的坑,全部固化在这里(改动前先读)────────────────────────
 * ① `behavior:'smooth'` 是**异步**的:调用立刻返回、滚动尚未发生,
 *    在那之后读 scrollY 读到的是**滚动前**的值 → 等于没测量。
 *    ⇒ 必须同步 scrollBy,且**滚动之后**才回读。
 * ② X 用**虚拟列表**:滚过去的 article 会被从 DOM 删除,
 *    所以「当前 DOM 条数」不是进度 —— 实测出现过 +0 / -1(不涨反降)。
 *    ⇒ 进度只看**跨轮累计的去重 id 数**。
 * ③ 「没有新数据」≠「到底了」:时间线里夹着别人的推很正常,
 *    急着停是漏数据的元凶。
 *    ⇒ 只有 scrollY **连续多轮不变**才算真到底。
 * ④ 「见过的最旧一条」≠ 覆盖深度:X 把置顶/热门旧推排在前面,
 *    一条 3 月的推就让判据误以为已覆盖 166 天。
 *    ⇒ 日期只做**显示**,绝不做停止判据。
 *
 * ── 校验(用户要求「包含校验方法」)──────────────────────────────
 * 每次采集返回 HarvestReport,自带三层校验,**任何一层不通过都如实标红**:
 *  A. 滚动确实发生了(scrollY 单调增长 / 最终 stuck)
 *  B. 抓到的条数 vs 页面声称的总数(有基线时)
 *  C. 时间连续性 —— 抓到的日期有没有大洞(洞 = 漏采信号)
 */

import { webContents as allWebContents } from 'electron';
import { IPC_CHANNELS } from '@shared/ipc/channel-names';
import { resolveXWebContents } from './x-webcontents';

/** 一条采集到的原始推文(字段照搬 X 载荷,不做业务解释) */
export interface HarvestedTweet {
  tweetId: string;
  authorHandle?: string;
  /**
   * 作者的数字 id(core.user_results.result.rest_id)。
   * 契约要求「有就务必给」—— OAuth 拿到的也是这个,按它匹配最稳
   * (username 会改名,rest_id 不会)。实测 131/131 条都有。
   */
  authorRestId?: string;
  /**
   * 这条推**自己**带了图片或视频。
   *
   * ⚠️ 契约的定义很窄(§2.1),三个不算:
   *  · 链接预览卡(card)不算 —— 那是 X 给外链生成的,不是用户上传的
   *  · 引用的原文里的图不算 —— 那是别人的图
   *  · 回复里 @ 到的推的图不算
   * 故只认 legacy.extended_entities.media,不下钻 quoted_status_result、
   * 不看 card。活动判定「有效留言」直接依赖这个字段,宽了会误发奖励。
   */
  hasMedia: boolean;
  /** 媒体类型(photo/video/animated_gif),便于运营核对;判定只用 hasMedia */
  mediaTypes?: string[];
  text: string;
  createdAt?: string;
  lang?: string;
  inReplyToStatusId?: string;
  inReplyToScreenName?: string;
  conversationId?: string;
  quotedStatusId?: string;
  isLongText: boolean;
  metrics: {
    likes?: number; retweets?: number; replies?: number;
    quotes?: number; bookmarks?: number; views?: number;
  };
  /** 登录用户自己对这条推的状态 —— 登录态 webview 独有,零额外请求 */
  self: { favorited?: boolean; retweeted?: boolean; bookmarked?: boolean };

  /**
   * ── ⭐ DOM 路独有的字段(载荷里没有)──
   *
   * 用户 2026-09-18 实机验证时发现右侧缺这几项。它们**只有 DOM 拿得到**:
   * 载荷里作者名要另查 user 结构、头像 url 与 media 的实际 url 都是渲染后才定的。
   * 而「取并集」的要求是 —— **一路独有的也不能丢**。
   *
   * ⚠️ 载荷路解出来的对象**不会有**这几项(保持 undefined),
   * 面板上会标 ⚠️。那是诚实的:这条推来自载荷,本来就没这几项 ——
   * 不是「漏采」,是「这一路拿不到」。两者必须看得出区别。
   */
  /**
   * ⭐ 蓝V —— 用户 2026-09-18 实机验证时指出缺这项。
   *
   * ⚠️ 载荷里**有两个位置**都可能放它(画像那条路 `x-author-profile.ts:93`
   * 实测过):`result.is_blue_verified` 与 `result.verification.is_blue_verified`。
   * 只读一个会漏 —— 那正是 x_author 里蓝V只有 2% 的成因之一。
   */
  /**
   * ⭐ 我与这个人的关系 —— 用户 2026-09-18 问「following 能直接拿到吗」。
   *
   * ⚠️ **时间线载荷里带不带,要看真实载荷**(面板上「原始载荷」可以翻)。
   * 悬浮卡上那些(Following 按钮/Follows you/粉丝数)来自**悬停时另发的
   * UserByScreenName 请求**,时间线载荷未必有。
   *
   * 带了就有值,没带就是 undefined —— **不猜、不兜底**:
   * 「没关注」与「不知道关注没」是两件事,混起来会让追踪名单判错人。
   *
   * ⚠️ 与画像路同口径,**两个位置都看**(x-author-profile.ts:95):
   * `relationship_perspectives.following` 与 `legacy.following`。
   */
  iFollow?: boolean;
  followsMe?: boolean;
  /**
   * ⭐ 作者 bio —— 用户 2026-09-18 问「bio 采集到了吗」,答案曾是**没有**:
   * 类型里没有、解析器没解、而 `authorsWithBio` 却一直报 0 ——
   * 那是个**说谎的字段**(看着像「没采到」,其实是「根本没采」)。
   *
   * ⚠️ 与蓝V/关系同样是**两个位置**(x-author-profile.ts:89 实测):
   * `profile_bio.description`(新形态)与 `legacy.description`(旧形态)。
   *
   * ⭐ 这一项的价值:盘点实测 bio 覆盖率仅 155/8021 = 2%,
   * 因为此前只有「导航到那人主页 + 等 12 秒」这一条路。
   * 时间线载荷里本来就带,等于白拿。
   */
  authorBio?: string;
  /** ⭐ iFollow 是靠哪个 testid 判出来的(如 `123-unfollow`)—— 判错要查得到 */
  followEvidence?: string;
  isBlueVerified?: boolean;
  /** ⭐ 蓝V是靠哪一条判出来的 —— 判错了要查得到,不是只给 true/false */
  verifiedEvidence?: string;
  authorName?: string;
  authorAvatar?: string;
  tweetUrl?: string;
  media?: Array<{ type: string; url: string; thumbUrl?: string }>;

  /**
   * true = 从 DOM 兜底抓的(字段较少:没有会话根/自身互动状态/长推全文)。
   * 用于监视页区分数据来源 —— 载荷是首选,DOM 只补 CDP 没覆盖到的部分。
   */
  fromDom?: boolean;
}

export interface RoundTrace {
  round: number;
  scrollY: number;
  docHeight: number;
  domArticles: number;
  cumulative: number;
  newThisRound: number;
  stuck: number;
}

export interface HarvestReport {
  url: string;
  ok: boolean;
  /** 不通过的校验项 —— 空数组才算过关 */
  problems: string[];
  rounds: number;
  payloads: number;
  tweets: HarvestedTweet[];
  /** 抓到的日期跨度与空洞 */
  dateSpan: { oldest?: string; newest?: string; days: number; gaps: string[] };
  stopReason: string;
  trace: RoundTrace[];
}

/**
 * 递归抽取所有推文对象 —— 只认 legacy 里的权威字段,不做 DOM 推断。
 * 导出给 x-capture-monitor 复用:**同一份抽取逻辑**,避免两处实现漂移
 * (滚动逻辑散成三份、同一 bug 修三遍的教训就在眼前)。
 */
export function extractTweetsFrom(node: unknown, out: Map<string, HarvestedTweet>): void {
  if (node === null || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const it of node) extractTweetsFrom(it, out);
    return;
  }
  const o = node as Record<string, unknown>;
  const lg = o.legacy as Record<string, unknown> | undefined;

  if (lg && typeof lg === 'object' && typeof lg.id_str === 'string') {
    const s = (k: string): string | undefined =>
      typeof lg[k] === 'string' && lg[k] ? (lg[k] as string) : undefined;
    const n = (k: string): number | undefined =>
      typeof lg[k] === 'number' ? (lg[k] as number) : undefined;

    // 作者:core.user_results.result.core.screen_name
    const core = o.core as Record<string, unknown> | undefined;
    const urr = (core?.user_results as Record<string, unknown> | undefined)
      ?.result as Record<string, unknown> | undefined;
    const ucore = urr?.core as Record<string, unknown> | undefined;

    // ⚠️ 长推 legacy.full_text **会被截断**,真全文在 note_tweet
    const note = o.note_tweet as Record<string, unknown> | undefined;
    const nres = (note?.note_tweet_results as Record<string, unknown> | undefined)
      ?.result as Record<string, unknown> | undefined;
    const noteText = nres && typeof nres.text === 'string' ? nres.text : undefined;

    // ⚠️ views.count 是**字符串**,且 state=Enabled 时没有数字
    const views = o.views as Record<string, unknown> | undefined;
    const viewCount = views && typeof views.count === 'string'
      ? Number(views.count) : undefined;

    // x_uid:rest_id 挂在 user_results.result 上(不是 core 里)
    const authorRestId = urr && typeof urr.rest_id === 'string'
      ? urr.rest_id : undefined;

    // has_media:**只认自己的** extended_entities.media(见类型注释的三个「不算」)
    const extEnt = lg.extended_entities as Record<string, unknown> | undefined;
    const mediaArr = Array.isArray(extEnt?.media) ? extEnt!.media as Array<Record<string, unknown>> : [];
    const mediaTypes = mediaArr
      .map((m) => (typeof m.type === 'string' ? m.type : undefined))
      .filter((t): t is string => !!t);

    const id = lg.id_str as string;
    if (!out.has(id)) {
      out.set(id, {
        tweetId: id,
        authorHandle: ucore && typeof ucore.screen_name === 'string'
          ? ucore.screen_name : undefined,
        authorRestId,
        // ⭐ bio:两个位置都看(与 x-author-profile.ts:89 同口径)
        authorBio: (() => {
          if (!urr) return undefined;
          const pb = urr.profile_bio as Record<string, unknown> | undefined;
          const ulg2 = urr.legacy as Record<string, unknown> | undefined;
          const v = pb?.description ?? ulg2?.description;
          return typeof v === 'string' && v.trim() ? v : undefined;
        })(),
        // ⭐ 关系:两个位置都看(与 x-author-profile.ts:95 同口径)
        //    ⚠️ 只在**明确为 true/false** 时给值;字段不在就 undefined ——
        //    「没关注」与「载荷里没这个字段」必须分得开
        ...(() => {
          const persp = urr?.relationship_perspectives as Record<string, unknown> | undefined;
          const ulg = urr?.legacy as Record<string, unknown> | undefined;
          const pick = (a: unknown, b: unknown): boolean | undefined =>
            a === true || b === true ? true
              : a === false || b === false ? false : undefined;
          return {
            iFollow: pick(persp?.following, ulg?.following),
            followsMe: pick(persp?.followed_by, ulg?.followed_by),
          };
        })(),
        // ⭐ 蓝V:两个位置都看(与 x-author-profile.ts:93 同口径,少看一个就会漏)
        isBlueVerified: (() => {
          if (!urr) return undefined;
          if (urr.is_blue_verified === true) return true;
          const v = urr.verification as Record<string, unknown> | undefined;
          if (v?.is_blue_verified === true) return true;
          // ⚠️ 明确的 false 也是事实(「查过了,不是蓝V」),与「没查到」不同
          if (urr.is_blue_verified === false || v?.is_blue_verified === false) return false;
          return undefined;
        })(),
        hasMedia: mediaArr.length > 0,
        mediaTypes: mediaTypes.length ? mediaTypes : undefined,
        text: noteText ?? s('full_text') ?? '',
        createdAt: s('created_at'),
        lang: s('lang'),
        inReplyToStatusId: s('in_reply_to_status_id_str'),
        inReplyToScreenName: s('in_reply_to_screen_name'),
        conversationId: s('conversation_id_str'),
        quotedStatusId: s('quoted_status_id_str'),
        isLongText: !!noteText,
        metrics: {
          likes: n('favorite_count'), retweets: n('retweet_count'),
          replies: n('reply_count'), quotes: n('quote_count'),
          bookmarks: n('bookmark_count'),
          views: Number.isFinite(viewCount) ? viewCount : undefined,
        },
        self: {
          favorited: typeof lg.favorited === 'boolean' ? lg.favorited : undefined,
          retweeted: typeof lg.retweeted === 'boolean' ? lg.retweeted : undefined,
          bookmarked: typeof lg.bookmarked === 'boolean' ? lg.bookmarked : undefined,
        },
      });
    }
  }

  for (const v of Object.values(o)) extractTweetsFrom(v, out);
}

/** 算日期跨度与空洞 —— 空洞是漏采的直接信号 */
function analyseDates(tweets: HarvestedTweet[]): HarvestReport['dateSpan'] {
  const days = [...new Set(
    tweets.map((t) => t.createdAt).filter(Boolean)
      .map((d) => new Date(d as string).toISOString().slice(0, 10)),
  )].sort();
  if (!days.length) return { days: 0, gaps: [] };

  const gaps: string[] = [];
  for (let i = 1; i < days.length; i++) {
    const prev = new Date(days[i - 1]).getTime();
    const cur = new Date(days[i]).getTime();
    const gapDays = Math.round((cur - prev) / 86_400_000);
    // 只报 >2 天的洞:单天空档可能真的没发推
    if (gapDays > 2) gaps.push(`${days[i - 1]} → ${days[i]}(${gapDays}天)`);
  }
  return {
    oldest: days[0],
    newest: days[days.length - 1],
    days: days.length,
    gaps,
  };
}

/**
 * 采集一个 X 页面上的全部推文。
 *
 * @param url        目标页(个人主页 / with_replies / 搜索结果 / 通知…都行)
 * @param targetWcId X webContents
 * @param maxRounds  安全阀;正常情况靠「真的滚不动」自然结束。
 *   ⚠️ 全量回补一个上千条的账号需要**很多轮** —— 实测每轮平均只产出 1.5 条、
 *   每 7.6 轮才触发一个 GraphQL 响应(X 越往深加载越慢)。
 *   1200 轮 ≈ 40 分钟,对应约 1200~1800 条的覆盖能力。
 *   设小了会**静默截断**(此前 300 轮就是这么把 2-7 月整段丢掉的)。
 */
export async function harvestTimeline(
  url: string,
  targetWcId?: number,
  maxRounds = 1200,
  opts: {
    /**
     * 时间预算(毫秒)。到点就返回已抓到的部分,stopReason 标 budget。
     * 契约 §3.1:campaign-tasks 最多等 8s,超时按未命中处理 ——
     * 所以宁可返回不完整,也不能干等。
     */
    budgetMs?: number;
    /**
     * 提前结束判据。契约 §3.1:「翻到这个人的留言就不用把整个评论区抓完」。
     * 返回 true 即停,stopReason 标 hint。
     */
    stopWhen?: (t: HarvestedTweet) => boolean;
  } = {},
): Promise<HarvestReport | { error: string }> {
  const resolved = resolveXWebContents(targetWcId);
  if ('error' in resolved) return { error: resolved.error };
  const wc = resolved.wc;

  const startedAt = Date.now();
  const tweets = new Map<string, HarvestedTweet>();
  const trace: RoundTrace[] = [];
  const pending = new Map<string, string>();
  let payloads = 0;

  const onMessage = (_e: unknown, method: string, params: any): void => {
    if (method === 'Network.requestWillBeSent') {
      const u: string = params?.request?.url ?? '';
      if (u.includes('/i/api/graphql/')) pending.set(params.requestId, u);
      return;
    }
    if (method === 'Network.loadingFinished') {
      if (!pending.has(params.requestId)) return;
      pending.delete(params.requestId);
      wc.debugger.sendCommand('Network.getResponseBody', { requestId: params.requestId })
        .then((r: any) => {
          if (!r?.body) return;
          payloads++;
          try { extractTweetsFrom(JSON.parse(r.body), tweets); } catch { /* 非 JSON */ }
        })
        .catch(() => { /* 响应体可能已丢弃 */ });
    }
  };

  let attached = false;
  try { wc.debugger.attach('1.3'); attached = true; }
  catch { /* 已被 attach,共用即可 */ }
  wc.debugger.on('message', onMessage);
  await wc.debugger.sendCommand('Network.enable').catch(() => {});

  wc.loadURL(url);
  await new Promise((r) => setTimeout(r, 4500));

  let lastY = -1;
  let stuck = 0;
  let rounds = 0;
  let stopReason = `达到轮次上限 ${maxRounds}`;

  for (let i = 1; i <= maxRounds; i++) {
    rounds = i;
    const before = tweets.size;

    // 同步滚动(**不用 smooth**:它是异步的,会让紧接着的回读全是旧值)
    const step = 0.55 + Math.random() * 0.3;
    await wc.executeJavaScript(`(function () {
      var y = window.scrollY;
      window.scrollBy(0, window.innerHeight * ${step.toFixed(3)});
      if (window.scrollY === y) {
        var all = document.querySelectorAll('div');
        for (var i = 0; i < all.length; i++) {
          var el = all[i];
          if (el.scrollHeight > el.clientHeight + 400) {
            el.scrollTop = el.scrollTop + el.clientHeight * ${step.toFixed(3)};
            break;
          }
        }
      }
    })()`).catch(() => {});

    // 随机停顿:匀速请求是风控最容易识别的特征
    await new Promise((r) => setTimeout(r, 1800 + Math.random() * 1500));

    // **滚动之后**回读 —— 这才是真实状态
    const st = await wc.executeJavaScript(`(function () {
      return { y: window.scrollY,
        docH: Math.max(document.body.scrollHeight, document.documentElement.scrollHeight),
        arts: document.querySelectorAll('article[data-testid="tweet"]').length };
    })()`).catch(() => null) as { y: number; docH: number; arts: number } | null;

    const y = st?.y ?? -1;
    if (y === lastY) stuck++; else stuck = 0;
    lastY = y;

    trace.push({
      round: i, scrollY: y, docHeight: st?.docH ?? -1, domArticles: st?.arts ?? -1,
      cumulative: tweets.size, newThisRound: tweets.size - before, stuck,
    });

    // 全量回补可能跑 40 分钟 —— 没有进度反馈的长任务等于黑箱,
    // 用户无从判断「还在跑」与「卡死了」。每 5 轮播报一次。
    if (i % 5 === 0 || stuck > 0) {
      const times = [...tweets.values()].map((t) => t.createdAt).filter(Boolean) as string[];
      const oldest = times.length
        ? times.reduce((a, b) => (new Date(a) < new Date(b) ? a : b)) : undefined;
      const progress = {
        url, round: i, maxRounds, captured: tweets.size,
        payloads, scrollY: y, stuck,
        oldest: oldest ? oldest.slice(0, 24) : undefined,
      };
      for (const w of allWebContents.getAllWebContents()) {
        if (w.isDestroyed()) continue;
        try { w.send(IPC_CHANNELS.X_HARVEST_PROGRESS, progress); } catch { /* 已销毁 */ }
      }
      if (i % 25 === 0) {
        console.log(`[harvest] 轮${i}/${maxRounds} y=${y} 累计=${tweets.size} `
          + `响应=${payloads} 最旧=${oldest ?? '?'}`);
      }
    }

    // **只有真的滚不动才算到底**(连续 3 轮位置没变)。
    // 「没有新数据」不作数 —— 时间线里夹着别人的推很正常。
    // ⚠️ 深处加载明显变慢(X 的懒加载在几百轮后经常要等好几秒),
    //    3 轮不变就判定到底会**提前截断**。放宽到 8 轮,并在中途多等一会儿,
    //    给懒加载留出补货时间 —— 宁可多花几十秒,不可漏掉整段历史。
    if (stuck > 0 && stuck % 3 === 0) {
      await new Promise((r) => setTimeout(r, 3000));   // 卡住时额外等待,催一催懒加载
    }
    if (stuck >= 8) { stopReason = `滚到底(连续 ${stuck} 轮 scrollY=${y} 未变)`; break; }

    // 时间预算到点:返回已抓到的部分(契约要求宁可 partial 也不干等)
    if (opts.budgetMs && Date.now() - startedAt >= opts.budgetMs) {
      stopReason = `budget 用尽(${opts.budgetMs}ms,已抓 ${tweets.size} 条)`;
      break;
    }
    // hint 命中:不必把整个评论区抓完
    if (opts.stopWhen) {
      const hit = [...tweets.values()].find(opts.stopWhen);
      if (hit) { stopReason = `hint 命中(${hit.tweetId}),提前结束`; break; }
    }
  }

  wc.debugger.off('message', onMessage);
  if (attached) { try { wc.debugger.detach(); } catch { /* 已 detach */ } }

  const list = [...tweets.values()];
  const dateSpan = analyseDates(list);

  // ── 校验:任何一条不过都记进 problems,不粉饰 ──────────────────
  const problems: string[] = [];
  const maxY = Math.max(...trace.map((t) => t.scrollY), 0);
  if (maxY <= 0) problems.push('页面从未滚动(scrollY 始终为 0)—— 滚动没生效');
  if (payloads === 0) problems.push('没捕获到任何 GraphQL 响应 —— CDP 可能没挂上');
  if (list.length === 0) problems.push('一条推文都没解析出来');
  if (stuck < 3 && rounds >= maxRounds) {
    problems.push(`达到轮次上限 ${maxRounds} 仍未滚到底 —— 结果不完整`);
  }
  if (dateSpan.gaps.length) {
    problems.push(`日期有 ${dateSpan.gaps.length} 处空洞(可能漏采):${dateSpan.gaps.slice(0, 3).join(' / ')}`);
  }

  return {
    url, ok: problems.length === 0, problems,
    rounds, payloads, tweets: list, dateSpan, stopReason, trace,
  };
}
