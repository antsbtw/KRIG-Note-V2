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
import {
  extractPeopleFrom, findPagingCursor, withCursor, buildRefetchScript,
  type HarvestedPerson,
} from './x-people-harvester';
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
  /**
   * ⭐⭐ **解不出推文的载荷样本** —— 给「量结构」用。
   *
   * ── 用户 2026-09-18 要做「采人」──
   *
   * 关注者/关注中页面的载荷是 `Followers`/`Following`(人的列表),
   * 而 `extractTweetsFrom` 只认推文对象,会整个跳过 → 报 0 条。
   * 要写「采人」的解析器,得**先看真实结构** —— 与量蓝V那次同理:
   * **量出来再写,不猜**。
   *
   * ⚠️ 只在「这个载荷一条推都没解出来」时才留,且只留前几条、每条截断:
   * 正常采集时不该把几百 KB 的时间线载荷搬来搬去。
   */
  unparsedSamples: Array<{ op: string; bytes: number; body: string }>;
  /**
   * ⭐ 见过的**全部** GraphQL 操作名 + 大小 —— 样本只留 3 条,但你得知道
   * 「那个带数据的请求到底发没发生」。
   *
   * ⚠️ 用户 2026-09-18 实测:截到 18 个载荷,留下的 3 个样本全是 0KB 杂项
   * (DataSaverMode / ViewerBadgeCounts),看不出 `Followers` 有没有出现。
   * 只报样本不报全景,就答不了「是没发请求,还是发了但我没留下来」。
   */
  seenOps: Array<{ op: string; bytes: number }>;
  /**
   * ⭐⭐ 采到的**人** —— 关注者/关注中/验证关注者页面的产出。
   *
   * 用户 2026-09-18 实测:那几页的载荷是 `BlueVerifiedFollowers`
   * (12 个 × 40KB),`extractTweetsFrom` 只认推文对象会整个跳过。
   * 所以同一次采集**两种都解**:是推就进 tweets,是人就进 people。
   */
  people: HarvestedPerson[];
  /**
   * ⭐⭐ 分页游标 —— 回答「**采完了没有**」,不靠猜。
   *
   * 此前判「到底了」靠 scrollY 连续 8 轮不变,那是猜;
   * 而 X 在载荷里**明说**还有没有(TimelineTimelineCursor / cursorType=Bottom)。
   *
   * · `hasMore=false` → 真的采完了
   * · `hasMore=true` + 停在轮次上限 → **还没采完**,加轮数还能拿到更多
   * · `bottom` 的值 → 跨次增量的**断点**(下次从这里接着采)
   */
  paging: { bottom?: string; top?: string; hasMore: boolean };
  /** 游标翻页的页数;0 = 没翻(不是采人页,或抄不到请求) */
  pagedRounds: number;
  /**
   * ⭐ 最后一个 GraphQL 请求(URL + 头)—— 游标翻页**重发它**,不自己拼。
   * X 的 queryId/features 会随版本变,复刻必然过期;复用刚发过的那条不会。
   */
  lastRequest?: { url: string; headers: Record<string, string> };
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
     * ⭐ 游标翻页的页数上限(默认 40)。一页 50-100 人,
     * 40 页 ≈ 2000-4000 人 —— 够覆盖大多数账号的关注者。
     * ⚠️ 这是**闸门不是目标**:X 说没有更多了就会提前停。
     */
    pageBudget?: number;
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
  /**
   * ⭐ 解不出推文的载荷样本 —— 给「量结构」用(见 HarvestReport.unparsedSamples)。
   * ⚠️ 只留前 3 条、每条截 8000 字:够看清结构,又不至于把几百 KB 搬进 IPC。
   */
  const unparsedSamples: Array<{ op: string; bytes: number; body: string }> = [];
  /** ⭐ 采到的人 —— 与推文并行解,同一次采集两种都要 */
  const people = new Map<string, HarvestedPerson>();
  /** ⭐ 最后一次见到的分页游标 —— 「还有没有」由 X 说了算 */
  let paging: { bottom?: string; top?: string; hasMore: boolean } = { hasMore: false };
  /** ⭐ 最后一个「人的列表」请求 —— 游标翻页靠重发它(不自己拼) */
  let lastPeopleReq: { url: string; headers: Record<string, string> } | null = null;
  /** 见过的全部操作名 —— 回答「那个请求到底发没发生」 */
  const seenOps: Array<{ op: string; bytes: number }> = [];
  let payloads = 0;

  const onMessage = (_e: unknown, method: string, params: any): void => {
    if (method === 'Network.requestWillBeSent') {
      const u: string = params?.request?.url ?? '';
      if (u.includes('/i/api/graphql/')) {
        pending.set(params.requestId, u);
        /**
         * ⭐⭐ 把**完整请求**留下来 —— 游标翻页要用它重发。
         *
         * ⚠️ 不自己拼请求:X 的 GraphQL 要 queryId / features 参数
         * (`x-article-replies.ts:285` 记着「会随版本变」,那边为此放弃了重发)。
         * ⭐ 但**复用 X 刚发过的那一条**就不用知道它们是什么 ——
         * 只把 URL 里的 cursor 换掉,其余原样。
         *
         * ⚠️ 请求头(authorization / x-csrf-token)同样原样带走,
         * 不复刻鉴权逻辑。
         */
        const req = params.request as { url?: string; headers?: Record<string, string> };
        if (req?.headers) lastPeopleReq = { url: u, headers: req.headers };
      }
      return;
    }
    if (method === 'Network.loadingFinished') {
      if (!pending.has(params.requestId)) return;
      // ⚠️ 先取再删 —— 取 body 是异步的,那时 pending 里已经没有这条了
      const reqUrl = pending.get(params.requestId) ?? '';
      pending.delete(params.requestId);
      wc.debugger.sendCommand('Network.getResponseBody', { requestId: params.requestId })
        .then((r: any) => {
          if (!r?.body) return;
          payloads++;
          const before = tweets.size;
          const peopleBefore = people.size;
          seenOps.push({
            op: reqUrl.match(/\/graphql\/[^/]+\/(\w+)/)?.[1] ?? '(未知操作)',
            bytes: r.body.length,
          });
          try {
            const parsed = JSON.parse(r.body);
            extractTweetsFrom(parsed, tweets);
            // ⭐ **人也解一遍** —— 同一个载荷可能既有推也有人
            //    (如时间线里的推荐关注模块);两种都要,不二选一
            extractPeopleFrom(parsed, people);
            // ⭐ 游标以**最后一个载荷**为准 —— 它反映当前翻到哪儿了
            const cur = findPagingCursor(parsed);
            if (cur.bottom || cur.top) paging = cur;
          } catch { /* 非 JSON */ }
          /**
           * ⭐ 这个载荷**一条推都没解出来** → 留个样本给「量结构」用。
           * ⚠️ 只留前 3 条、每条截 8000 字:够看清结构,又不至于把
           * 几百 KB 的载荷搬进 IPC。
           */
          // ⚠️ 推**和**人都没解出来才算「没解出来」——
          //    否则关注者页会被误报成「解析失败」,而它其实采到人了
          if (tweets.size === before && people.size === peopleBefore) {
            /**
             * ⭐ **优先留大的** —— 用户 2026-09-18 实测踩到:
             *
             * 只留前 3 条时,拿到的全是 `DataSaverMode` / `ViewerBadgeCounts`
             * 这类 **0KB 的杂项请求**(它们发生得最早,把名额占满了),
             * 而真正带人的 `Followers` 载荷反而没留下来。
             *
             * 大小是**最好的筛子**:带数据的载荷必然大,杂项必然小。
             * 故改成:先收着,按 bytes 降序,只保留最大的 3 条。
             */
            unparsedSamples.push({
              op: reqUrl.match(/\/graphql\/[^/]+\/(\w+)/)?.[1] ?? '(未知操作)',
              bytes: r.body.length,
              body: r.body.slice(0, 8000),
            });
            unparsedSamples.sort((a, b) => b.bytes - a.bytes);
            if (unparsedSamples.length > 3) unparsedSamples.length = 3;
          }
        })
        .catch(() => { /* 响应体可能已丢弃 */ });
    }
  };

  let attached = false;
  try { wc.debugger.attach('1.3'); attached = true; }
  catch { /* 已被 attach,共用即可 */ }
  wc.debugger.on('message', onMessage);
  await wc.debugger.sendCommand('Network.enable').catch(() => {});

  /**
   * ⭐⭐ 「确保在目标页」是**一个步骤**,不是两个流程。
   *
   * ── 用户 2026-09-18 纠正 ──
   *
   * > 「这是通用的子流程,如果输入一个用户名,点击采集,
   * >   也是要先跳转到这个人的主页,对吗?」
   *
   * 对。「输入 handle 采集」与「采当前页」**只是到达方式不同**,
   * 后面的滚动/抓载荷/入库完全一样。我起初做成两个按钮,
   * 是把**到达方式**当成了**不同流程**。
   *
   * ⭐ 所以判断放在这里,不让人选:
   *  · 已经在目标页 → 不跳(省掉重新加载、不冲掉滚动位置、不白等 4.5s)
   *  · 不在 → 跳过去
   *  · 没给 url → 就采当前页
   */
  const already = (() => {
    if (!url) return true;                       // 没给目标 = 采当前页
    try {
      const nowUrl = wc.getURL();
      // ⚠️ 只比 path,不比 query/hash —— X 会往 URL 上挂 ?src= 之类,
      //    比全等会让「明明已经在这页」误判成「不在」,白跳一次
      const a = new URL(url).pathname.replace(/\/$/, '');
      const b = new URL(nowUrl).pathname.replace(/\/$/, '');
      return a === b;
    } catch { return false; }
  })();

  if (already) {
    // 仍给一点时间让 CDP 监听就位 —— 刚 attach 就滚,头几个响应会漏在监听之前
    await new Promise((r) => setTimeout(r, 300));
  } else {
    wc.loadURL(url);
    await new Promise((r) => setTimeout(r, 4500));

    /**
     * ⭐⭐ **落地校验** —— 导航完必须确认真的到了,否则在错的页面上照采不误。
     *
     * ── 用户 2026-09-18 实测踩到 ──
     *
     * 选了 x.profile 但 handle 用的是默认值 `fang_danie121`(一个**不存在的账号**,
     * 那是当天早些时候测「账号不存在」留下的)。X 对不存在的用户**弹回首页**,
     * 于是采集在首页上跑完、报告一切正常 —— 用户看到的是「点采集后弹回自己主页」。
     *
     * ⚠️ 这正是 2026-09-07 那个教训的复发:
     * 「被弹回首页时『页面上有推文』照样成立,于是把首页时间线当成搜索结果整批入库」。
     * `goto` 为此加了带 handle 的 arrival 判据,而 `harvestTimeline` 这条路
     * **一直没有任何落地校验** —— 它只管滚和抓。
     *
     * ⭐ 这里只比 path:到没到**那一页**是事实,页面上有没有推是另一回事。
     */
    const landed = wc.getURL();
    const same = (() => {
      try {
        const want = new URL(url).pathname.replace(/\/$/, '').toLowerCase();
        const got = new URL(landed).pathname.replace(/\/$/, '').toLowerCase();
        return got === want || got.startsWith(want + '/');
      } catch { return false; }
    })();
    if (!same) {
      return {
        error: `导航后没落在目标页:想去 ${url},实际在 ${landed} —— `
          + '常见成因:账号不存在/被封/改名(X 会弹回首页)。'
          + '⚠️ 已中止采集,否则会把**错误页面**的内容当成目标数据整批入库。',
      };
    }
  }

  let lastY = -1;
  let stuck = 0;
  let rounds = 0;
  let stopReason = `达到轮次上限 ${maxRounds}`;
  let emptyPages = 0;

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

  /**
   * ⭐⭐ **游标翻页** —— 滚动之后接着用,直到 X 说没有了。
   *
   * ── 用户 2026-09-18 拍板 ──
   *
   * > 「① 用游标直接翻页 —— 不滚动,直接重放 GraphQL 请求带 cursor。
   * >   快几十倍。可以使用这个方法」
   *
   * 实测滚动 30 轮 / 76 秒只拿到 **201/2604 = 7.7%**,且只触发 4 个载荷 ——
   * 时间全花在滚动动画和虚拟列表渲染上。而 X 的分页本来就是游标式的,
   * 一次请求给 50-100 人。
   *
   * ⭐ **滚动仍然要跑**,它不是被替换掉了 —— 它的作用变成
   * 「让 X 自己发一次请求,好让我们抄到 URL 和请求头」。
   * 没有这一步就得复刻 queryId/features(`x-article-replies.ts:285` 的教训),
   * 那正是我们要绕开的。
   *
   * ⚠️ 只在**采人的页面**上翻(paging.bottom 有值 && 采到过人)。
   * 推文页的游标语义不同,没验证过,不顺手捎带。
   */
  let pagedRounds = 0;
  if (lastPeopleReq && paging.hasMore && paging.bottom && people.size > 0) {
    /**
     * ⚠️ **先钉住**这条请求再进循环 —— `lastPeopleReq` 是闭包里被监听器
     * 改写的变量,循环中途它可能被别的请求覆盖掉,那样翻页就会跑到
     * 另一个列表上去(而人照样入库,看不出来)。
     */
    const baseReq = lastPeopleReq;
    const budget = opts.pageBudget ?? 40;
    const seenCursors = new Set<string>();
    while (pagedRounds < budget && paging.hasMore && paging.bottom) {
      const cursor = paging.bottom;
      /**
       * ⚠️ **游标没变就停**。
       *
       * 这是本实现最危险的失败形态:`variables` 换错了、或者 X 忽略了我们的
       * 游标,响应会是**第 1 页**,于是解析出的还是那批人(Map 去重后 size 不变),
       * 循环却会一直跑下去 —— 看上去在工作,实际原地打转 40 轮。
       * 游标重复 = 没翻动,立刻停并**如实记下**。
       */
      if (seenCursors.has(cursor)) {
        stopReason = `游标翻页:游标重复(${cursor.slice(0, 24)}…)—— 没有真的翻动,已停`;
        break;
      }
      seenCursors.add(cursor);

      const nextUrl = withCursor(baseReq.url, cursor);
      if (!nextUrl) {
        stopReason = '游标翻页:URL 里的 variables 解不开 —— 没有猜着改,已停';
        break;
      }

      let body: string;
      try {
        const res = await wc.executeJavaScript(
          buildRefetchScript(nextUrl, baseReq.headers), true,
        ) as { __body?: string; __err?: string };
        if (res?.__err) { stopReason = `游标翻页:请求失败(${res.__err})`; break; }
        if (!res?.__body) { stopReason = '游标翻页:响应是空的'; break; }
        body = res.__body;
      } catch (e) {
        stopReason = `游标翻页:注入失败(${String(e)})`;
        break;
      }

      pagedRounds++;
      payloads++;
      const peopleBefore = people.size;
      try {
        const parsed = JSON.parse(body);
        extractPeopleFrom(parsed, people);
        extractTweetsFrom(parsed, tweets);
        const cur = findPagingCursor(parsed);
        // ⚠️ 拿不到新游标就当**到底了**,不拿旧的再试一次(那必然是原地打转)
        paging = (cur.bottom || cur.top) ? cur : { hasMore: false };
      } catch {
        stopReason = '游标翻页:响应不是 JSON';
        break;
      }
      seenOps.push({ op: `翻页#${pagedRounds}`, bytes: body.length });

      /**
       * ⚠️ 翻了一页但**一个人都没多** —— 可能是这一页全是已见过的人
       * (正常),也可能是响应根本没人(不正常)。不臆断,继续翻,
       * 但连着 3 页都没新人就停:再翻也是白费。
       */
      if (people.size === peopleBefore) {
        emptyPages++;
        if (emptyPages >= 3) {
          stopReason = `游标翻页:连续 3 页没有新的人(已 ${people.size} 人)`;
          break;
        }
      } else emptyPages = 0;

      if (!paging.hasMore) {
        stopReason = `游标翻页:X 说没有更多了(共翻 ${pagedRounds} 页,${people.size} 人)`;
      }
    }
    if (paging.hasMore && pagedRounds >= (opts.pageBudget ?? 40)) {
      stopReason = `游标翻页:达到翻页上限 ${opts.pageBudget ?? 40} 页(${people.size} 人,还有更多)`;
    }
  }

  wc.debugger.off('message', onMessage);
  if (attached) { try { wc.debugger.detach(); } catch { /* 已 detach */ } }

  const list = [...tweets.values()];
  const dateSpan = analyseDates(list);

  // ── 校验:任何一条不过都记进 problems,不粉饰 ──────────────────
  /**
   * ⭐⭐ `problems` 只报**采集链路自身坏了**,不报「数据质量」。
   *
   * ── 用户 2026-09-18 定的边界 ──
   *
   * > 「我觉得我们应该忠实于页面能够获取的信息,分析数据是另外一个主题了。」
   *
   * ⚠️ 此前这里混进了两条**判断**,而且有一条判错了:
   *
   *  · 「日期有 N 处空洞(**可能漏采**)」—— 实测 x.home 报出
   *    `2024-09-18 → 2026-08-03(684天)`。那不是漏采:**首页是算法混排**,
   *    会把两年前的热门推塞进来。空洞检测建立在「时间连续」假设上,
   *    而首页根本不满足这个假设 → 对首页恒为噪音,还会掩盖真问题。
   *
   *  · 「达到轮次上限仍未滚到底 —— **结果不完整**」—— 「不完整」是判断。
   *    事实只是「滚了 30 轮,停在轮次上限」,那本来就在 `stopReason` 里。
   *
   * ⭐ 采集层的职责:**页面上有什么,忠实地拿下来,并如实说明拿的过程**。
   * 「够不够、有没有漏」是分析层拿着 `dateSpan`/`stopReason`/`rounds` 自己判断的事。
   */
  const problems: string[] = [];
  const maxY = Math.max(...trace.map((t) => t.scrollY), 0);
  // 以下三条都是**采集链路真的坏了**,不是数据质量判断
  if (maxY <= 0) problems.push('页面从未滚动(scrollY 始终为 0)—— 滚动没生效');
  if (payloads === 0) problems.push('没捕获到任何 GraphQL 响应 —— CDP 可能没挂上');
  if (list.length === 0) problems.push('一条推文都没解析出来');

  return {
    url, ok: problems.length === 0, problems,
    rounds, payloads, tweets: list, dateSpan, stopReason, trace,
    unparsedSamples, seenOps,
    people: [...people.values()],
    paging,
    /** ⭐ 游标翻了几页 —— 0 表示只靠滚动 */
    pagedRounds,
    /** ⭐ 供游标翻页重发用 —— 复用 X 刚发过的请求,不自己拼 */
    lastRequest: lastPeopleReq ?? undefined,
  };
}
