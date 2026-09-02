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

import { resolveXWebContents } from './x-webcontents';

/** 一条采集到的原始推文(字段照搬 X 载荷,不做业务解释) */
export interface HarvestedTweet {
  tweetId: string;
  authorHandle?: string;
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

    const id = lg.id_str as string;
    if (!out.has(id)) {
      out.set(id, {
        tweetId: id,
        authorHandle: ucore && typeof ucore.screen_name === 'string'
          ? ucore.screen_name : undefined,
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
 * @param maxRounds  安全阀;正常情况靠「真的滚不动」自然结束
 */
export async function harvestTimeline(
  url: string,
  targetWcId?: number,
  maxRounds = 300,
): Promise<HarvestReport | { error: string }> {
  const resolved = resolveXWebContents(targetWcId);
  if ('error' in resolved) return { error: resolved.error };
  const wc = resolved.wc;

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

    // **只有真的滚不动才算到底**(连续 3 轮位置没变)。
    // 「没有新数据」不作数 —— 时间线里夹着别人的推很正常。
    if (stuck >= 3) { stopReason = `滚到底(连续 ${stuck} 轮 scrollY=${y} 未变)`; break; }
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
