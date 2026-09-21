/**
 * ⭐⭐ 无人工采集 —— **不用点击就能拿到**
 *
 * ── 用户 2026-09-18 定的要求 ──
 *
 * > 「我的建议是不用点击就有办法拿到蓝V关系,这是我们反复调试的。
 * >   而不是我点击推文进来才可以拿。」
 *
 * 实测确认过的事实链:
 *  · 关注关系/蓝V **在时间线载荷里就有**(`relationship_perspectives`),零额外请求
 *  · 但**要有新载荷**才截得到 —— 页面早就渲染好的推不会重新请求
 *  · 悬停弹卡片零网络请求(用户的操作流证实)→ 数据在前端内存,磁盘上没有
 *
 * ⭐ 所以正解不是"等人操作",是**主动导航一次** ——
 * 导航必然触发 HomeTimeline/UserTweets 载荷,字段自然全。
 *
 * ── 与既有采集路径的分工 ──
 *
 * | | 走哪条 | 字段 |
 * |---|---|---|
 * | `x-timeline-scan`(配方采集) | DOM 提取 | 少(无关系/会话串/restId) |
 * | **本文件** | **载荷** | 全 |
 *
 * ⚠️ 本文件**不替换**配方采集,只补「作者维度」这一块 ——
 * 那正是盘点里最缺的(bio 2%、关系 2%、会话串 11%)。
 *
 * ── 纪律 ──
 *
 * ⚠️ **采集层无条件全收**(用户既定铁律:「丢掉的永远查不回来」)——
 * 本文件不做任何内容过滤,判断是后面编排的事。
 * ⚠️ **只写库,不判断**:它是取数执行者,不是判决者。
 */

import { harvestTimeline, type HarvestedTweet } from './x-timeline-harvester';
import { upsertTweet, readBackTweets } from '../db/tweet-inbox-repo';
import {
  saveAuthorCounts, registerSeenAuthor, getAuthorCounts,
  saveListSnapshot, recentSnapshotRuns, diffSnapshots, orderingStability,
  countBlueVerifiedInFollowers, knownHandlesOfLastRun,
} from '../db/x-author-repo';
import { normalizeHandle, type TweetInboxRecord } from '@shared/types/x-timeline-types';

export interface AutoCollectReport {
  url: string;
  /** 采到多少条推(载荷 + DOM 并集后) */
  tweets: number;
  /** 其中真从载荷来的(字段全) */
  fromPayload: number;
  /** 入库成功的条数 */
  saved: number;
  /** ⭐ 采到关系数据的作者数 —— 这正是「不用点击就能拿到」的成果 */
  authorsWithRelation: number;
  /** 采到 bio 的作者数 */
  authorsWithBio: number;
  /**
   * ⭐⭐ 「采人」的产出 —— 关注者/关注中页面采到的**人**。
   *
   * 用户 2026-09-18 实测:那几页的载荷是 `BlueVerifiedFollowers`,
   * 只认推文的解析器会整个跳过 → 报 0 条。现在两种都解。
   *
   * ⭐ 这正是盘点缺口的正解:bio 与关系覆盖率此前只有 2%,
   * 因为唯一的路是「导航到每个人主页 + 等 12 秒」。
   */
  people: number;
  /** 其中带 bio 的 */
  peopleWithBio: number;
  /** 其中带关系(iFollow/followsMe)的 */
  peopleWithRelation: number;
  /**
   * ⭐ 长推(Show more)统计 —— 用户 2026-09-18 问「show more 的内容
   * 是否被取回来?或者漏失了?」
   *
   * 载荷路**是处理了的**:`note_tweet.note_tweet_results.result.text`
   * 优先于会被截断的 `legacy.full_text`。入库也不截(schema 无长度限制)。
   * 但「理论上没丢」不够 —— 这里给出**可验证的数字**:
   * 有几条长推、最长多少字、平均多少字。
   *
   * ⚠️ 若 `longText > 0` 而 `maxChars` 只有 280 上下,那就是**真截断了**。
   */
  longText: { count: number; maxChars: number; avgChars: number };
  /** 载荷条数;0 说明导航没触发请求(页面可能用了缓存) */
  payloads: number;
  /**
   * ⚠️ 只报**采集链路自身坏了**(滚动没生效 / 零响应 / 零解析),
   * **不报数据质量** —— 用户 2026-09-18:
   * 「我们应该忠实于页面能够获取的信息,分析数据是另外一个主题。」
   */
  problems: string[];
  /**
   * ⭐⭐ 解不出推文的载荷样本 —— 给「量结构」用。
   *
   * 用户 2026-09-18 要做「采人」:关注者/关注中页面的载荷是
   * Followers/Following(人的列表),extractTweetsFrom 只认推文对象会跳过。
   * 要写解析器得**先看真实结构** —— 与量蓝V那次同理:量出来再写,不猜。
   */
  unparsedSamples: Array<{ op: string; bytes: number; body: string }>;
  /** ⭐ 见过的全部 GraphQL 操作 —— 回答「那个带数据的请求到底发没发生」 */
  seenOps: Array<{ op: string; bytes: number }>;
  /**
   * ⭐ 事实性说明(不是故障)—— 如「这一页没有推文」。
   * ⚠️ 与 problems 分开:那是**链路坏了**,这是**如实解释一个数字**。
   */
  notes: string[];
  stopReason: string;
  /** 实际滚了几轮 —— 事实,不判断「够不够」 */
  rounds: number;
  /** ⭐ 游标翻了几页 —— 0 表示只靠滚动(不是采人页,或抄不到请求) */
  pagedRounds: number;
  /** ⭐ 没翻页的话,是四个入口条件里哪一条不成立 —— 四种断法必须分得开 */
  pagingSkipped?: string;
  /**
   * ⭐⭐ **解析率** —— 「X 给的我都接住了吗」(用户 2026-09-20 的要求:
   * 每个页面都要正确、完整地提取)。
   *
   * ⚠️ 与游标是**两个问题**:游标答「X 那边还有没有」,
   * 这个答「我这边接没接住」。两者都过才叫完整。
   */
  parseRate?: { entries: number; parsed: number; rate?: number };
  /**
   * ⭐⭐⭐ **入库回读** —— 「存对了吗」,不是「解析对了吗」。
   *
   * ⚠️ 与 `coverage` 是两件事:
   * · coverage = 解析出来的内存对象,字段全不全
   * · dbCheck  = **真的写进库了吗**(中间隔着 toRecord 转换)
   * 实测 conversation_id 就是「解析有值、类型没声明、库里恒空」。
   */
  dbCheck?: {
    /** 抽查了几条 */
    sampled: number;
    /** 本来要查几条(sampled < asked = 有的没写进去) */
    asked: number;
    /** 哪些字段在库里是空的 —— 只算**采集该负责**的,业务后填的不算 */
    gaps: Array<{ field: string; empty: number; of: number }>;
    error?: string;
  };
  failedUrl?: string;
  /**
   * ⭐ **增量结果** —— 与上一次快照比,新增/取关了谁。
   *
   * ⚠️ `ordering` 曾是「X 的列表按什么排序」的**待答问题**,
   * 2026-09-19 已由它给出结论:**严格按关注时间倒序**
   * (2770 人实测,相邻逆序对 0 / 2769)。
   * 「遇到采过的就停」因此解锁 —— 见 `fast`。
   *
   * ⭐ 它仍然每次都算:排序是 X 的行为,X 改版就会变,
   * 而那种变**在数据里看不出来**,只有持续盯着这个指标才发现得了。
   */
  incremental?: {
    firstRun?: boolean;
    prevRunId?: string;
    added: number;
    removed: number;
    kept: number;
    addedSample?: string[];
    removedSample?: string[];
    ordering?: {
      common: number; maxShift: number; medianShift: number;
      newcomersAtFront: number; newcomersTotal: number;
    };
    error?: string;
  } | { error: string };
  /**
   * ⭐⭐ **快速增量的成果与边界** —— 只在 `fastIncremental` 模式下有。
   *
   * ⚠️ 三件事必须一起说,少一件都会被误读:
   * ① 新增了谁(它能回答的)
   * ② **取关看不见**(它答不了的 —— 取关者从名单中间消失)
   * ③ 距上次全量多久(该不该补一次全量)
   */
  fast?: {
    /** 上次全量的名单有多大 */
    knownBaseline: number;
    /** ⭐ 真追上了吗 —— false = 新人可能没翻完,数字不能当全部 */
    caughtUp: boolean;
    /** 这次新发现的人(不在上次全量名单里的) */
    newcomers: string[];
    /** 上次全量是什么时候 */
    lastFullRunAt?: string;
    /** 距上次全量多少天 —— 报告据此提醒「该跑全量了」 */
    daysSinceFullRun?: number;
  };
  capturedUrl?: string;
  /**
   * ⭐⭐ 采完了没有 —— **X 说的,不是我们猜的**。
   *
   * 用户 2026-09-18 问全量/增量。此前判「到底了」靠 scrollY 连续 8 轮不变,
   * 那是猜;而载荷里带 `TimelineTimelineCursor / cursorType=Bottom`,
   * X **明说**还有没有。
   *
   * · `hasMore=false` → 这一页真的采完了(全量到手)
   * · `hasMore=true` + 停在轮次上限 → **还没采完**,加轮数/预算能拿到更多
   * · `cursor` → 跨次增量的断点(⚠️ 目前只报出来,**还没用它做断点续采**)
   */
  paging: { hasMore: boolean; cursor?: string };
  /**
   * ⭐⭐ **基准对账** —— 采到的 vs X 自己报的总数。
   *
   * ── 用户 2026-09-18 ──
   *
   * > 「首页有一个多少人关注、多少人未关注,这个就是基准,
   * >   出入不超过 10% 即可。」
   *
   * ⭐ 这是把「采够了没有」从猜变成算 —— 与用户 2026-09-02 定的
   * 「tweet_count 是采集完整度的分母」同一个思路。
   *
   * ⚠️ 三件事要说清:
   * ① **分母未必拿得到** —— 要库里存过这个人的 followers_count。
   *    拿不到时 `baseline` 为 undefined,**不编一个数**。
   * ② **Verified Followers 没有分母** —— X 不单独报「多少个蓝V关注者」,
   *    所以那一页只能靠游标判断采完没有。
   * ③ **分母是活的** —— 采集这几分钟里就可能有人关注/取关,
   *    而且 X 自己的计数有延迟。所以是「差不多」不是「精确相等」。
   */
  reconcile?: {
    /** X 报的总数(库里存的) */
    baseline?: number;
    /** 实际采到 */
    got: number;
    /** got/baseline;baseline 缺失时 undefined */
    rate?: number;
    /** 人能读懂的结论 */
    note: string;
  };
  /**
   * ⭐ 抓到的日期跨度与空洞 —— **事实交给分析层,采集层不下判断**。
   *
   * ⚠️ 此前采集层把它解释成「可能漏采」并报成 problem,而那判错了:
   * x.home 实测报出 684 天空洞,那不是漏采,是**首页算法混排**
   * (会把两年前的热门推塞进来)。空洞检测建立在「时间连续」假设上,
   * 首页不满足 → 对首页恒为噪音。
   * 换成某人主页(真时间序)时,同一份数据才有判断价值 ——
   * 而**那个判断该由分析层做**,它知道自己在看什么页面。
   */
  dateSpan: { oldest?: string; newest?: string; days: number; gaps: string[] };
  elapsedMs: number;

  /**
   * ⭐⭐ **字段级覆盖率** —— 用户 2026-09-18:
   * 「我关注的是采集数据的完整性,每一条数据都是完整的吗?」
   *
   * ⚠️ 总数不等于完整:77 条里可能条条缺字段,而「采到 77 条」照样好看。
   * 所以要按**字段**报,不是按条数报。
   */
  coverage: Array<{ field: string; have: number; total: number; rate: number }>;

  /**
   * ⭐ 逐条明细 —— 人要能**逐条检查**,不是只看一个百分比。
   * ⚠️ 只带回前 N 条(IPC 不适合搬运整批),但覆盖率是**全量**算的。
   */
  sample: Array<{
    tweetId: string;
    handle?: string;
    /** 这一条缺了哪些字段 —— 空数组 = 完整 */
    missing: string[];
    fromDom: boolean;
  }>;
}

/**
 * 一条推「该有什么」。
 *
 * ⚠️ 分三类,因为**缺失的含义不同**:
 *  · `always` —— 任何推都该有,缺了就是采集坏了
 *  · `payloadOnly` —— 只有载荷路有;DOM 兜底的推缺了是正常的
 *  · `conditional` —— 本来就可能没有(不是回复就没有 inReplyTo),
 *    **不算缺**,所以不进覆盖率分母
 */
const FIELD_SPEC: ReadonlyArray<{
  readonly field: string;
  readonly kind: 'always' | 'payloadOnly' | 'conditional';
  readonly get: (t: HarvestedTweet) => unknown;
}> = [
  { field: 'tweetId', kind: 'always', get: (t) => t.tweetId },
  { field: 'text', kind: 'always', get: (t) => t.text },
  { field: 'authorHandle', kind: 'always', get: (t) => t.authorHandle },
  { field: 'createdAt', kind: 'always', get: (t) => t.createdAt },
  { field: 'lang', kind: 'always', get: (t) => t.lang },
  { field: 'metrics.likes', kind: 'always', get: (t) => t.metrics?.likes },
  { field: 'metrics.replies', kind: 'always', get: (t) => t.metrics?.replies },
  { field: 'metrics.views', kind: 'always', get: (t) => t.metrics?.views },
  { field: 'authorRestId', kind: 'payloadOnly', get: (t) => t.authorRestId },
  { field: 'conversationId', kind: 'payloadOnly', get: (t) => t.conversationId },
  { field: 'iFollow', kind: 'payloadOnly', get: (t) => t.iFollow },
  { field: 'followsMe', kind: 'payloadOnly', get: (t) => t.followsMe },
  { field: 'isBlueVerified', kind: 'payloadOnly', get: (t) => t.isBlueVerified },
  { field: 'self', kind: 'payloadOnly', get: (t) => t.self && Object.keys(t.self).length > 0 },
  { field: 'metrics.bookmarks', kind: 'payloadOnly', get: (t) => t.metrics?.bookmarks },
  { field: 'authorBio', kind: 'payloadOnly', get: (t) => t.authorBio },
  /**
   * ⭐⭐ **这三项此前压根没量** —— 2026-09-21 用户提「先看单条完整性」时实测暴露:
   * 库里 400 条抽样 `tweet_url` 77% 空、`author_avatar` 80% 空、
   * `author_name_at_post` 78% 空,而报告显示「15/16 项 100%」——
   * **因为表里根本没有它们**。
   *
   * ⚠️ 不量的字段永远是 100%。「清单不会自己长」在覆盖率这里同样成立:
   * 加了字段不加进这张表,等于没采也看不出来。
   *
   * ⭐ 它们是 `always`(不是 payloadOnly):载荷路径现在也产出了
   * (2026-09-21 补的取值 + URL 按 handle+id 拼),两条路径都该有。
   */
  { field: 'authorName', kind: 'always', get: (t) => t.authorName },
  { field: 'authorAvatar', kind: 'always', get: (t) => t.authorAvatar },
  { field: 'tweetUrl', kind: 'always', get: (t) => t.tweetUrl },
  // ⚠️ 以下本来就可能没有 —— **不进分母**,否则覆盖率永远上不去而且是假的
  { field: 'inReplyToStatusId', kind: 'conditional', get: (t) => t.inReplyToStatusId },
  { field: 'media', kind: 'conditional', get: (t) => t.media?.length },
  { field: 'authorName', kind: 'conditional', get: (t) => t.authorName },
  { field: 'authorAvatar', kind: 'conditional', get: (t) => t.authorAvatar },
];

/** 有值 = 非 undefined/null/空串/空数组。⚠️ 0 和 false **算有值** */
function has(v: unknown): boolean {
  if (v === undefined || v === null) return false;
  if (typeof v === 'string') return v.trim() !== '';
  if (Array.isArray(v)) return v.length > 0;
  return true;
}

/** `HarvestedTweet` → 入库记录。⚠️ 载荷字段**一个都不丢** */
function toRecord(t: HarvestedTweet, wsId?: string): TweetInboxRecord {
  return {
    tweet_id: t.tweetId,
    text: t.text ?? '',
    author_name: t.authorName ?? '',
    // ⚠️ 存归一化形态 —— 与 x_author.handle 一致,漂移会让关联恒查不到且不报错
    author_handle: normalizeHandle(t.authorHandle ?? ''),
    author_avatar: t.authorAvatar,
    /** ⭐ 发推当时的展示名快照 —— 人会改名,存下来才知道当时叫什么 */
    author_name_at_post: t.authorName,
    tweet_url: t.tweetUrl,
    /**
     * ⭐⭐ **会话根必须写** —— 2026-09-21 实测:schema 有这一列(带索引)、
     * 解析器也解出来了,唯独这里没写 → 库里恒空 → 回复归不到根推上。
     */
    conversation_id: t.conversationId,
    lang: t.lang,
    metrics: t.metrics ?? {},
    fetched_at: new Date().toISOString(),
    created_at: t.createdAt,
    // ⭐ 载荷独有的三样 —— 盘点里最缺的正是这些
    in_reply_to: t.inReplyToStatusId,
    in_reply_to_user: t.inReplyToScreenName,
    source: 'watchlist',
    ws_id: wsId,
    filter_score: 1.0,
    status: 'pending',
  };
}

/**
 * 跑一次无人工采集。
 *
 * @param url 目标页面。⭐ **已经在这一页就不会跳** —— 「确保在目标页」是
 *   流程的一个步骤,不是两个流程(用户 2026-09-18 纠正)。传空串 = 采当前页。
 * @param targetWcId X webview 的 wcId
 * @param opts.maxRounds 滚动轮数上限 —— **是参数不是常量**(用户定过)
 */
export async function autoCollect(
  url: string,
  targetWcId?: number,
  opts: {
    maxRounds?: number; budgetMs?: number; pageBudget?: number;
    wsId?: string; pageLabel?: string;
    /** ⭐ 这是**谁的**列表 —— 基准对账要查他的 followers_count */
    ownerHandle?: string;
    /**
     * ⭐⭐ **快速增量** —— 只翻到「遇见上次采过的人」为止。
     *
     * 17 分钟 → 十几秒。安全性来自 2026-09-19 的排序实测:
     * followers 严格按关注时间倒序,新人只会在最前面
     * (见 `knownHandlesOfLastRun` 的注释,2770 人相邻逆序对 0)。
     *
     * ⚠️ **它看不见取关**,且**不写快照** —— 两条都在下面兑现。
     */
    fastIncremental?: boolean;
  } = {},
): Promise<AutoCollectReport | { error: string }> {
  const t0 = Date.now();
  /** 这批顺序属于哪个列表 —— followers 的第 3 名 ≠ following 的第 3 名 */
  const pageLabel = opts.pageLabel ?? url;

  /**
   * ⭐⭐ **快速增量:先取上次全量的名单** —— 没有它就没有「已知」可言。
   *
   * ⚠️ **取不到就退回全量**,不是「当成一个人都不认识然后按快速模式跑」——
   * 后者会在翻满闸门后停下,报出一个**看着像增量、实则是残缺全量**的结果,
   * 而那正是本仓最常踩的「看着成功实际没有」。
   * 退回全量慢,但结果是对的;而且报告里会说清为什么退的。
   */
  let knownHandles: Set<string> | undefined;
  let lastFullRunAt: string | undefined;
  let fastFellBack: string | undefined;
  if (opts.fastIncremental) {
    try {
      const k = await knownHandlesOfLastRun(pageLabel);
      if (k.handles.size > 0) {
        knownHandles = k.handles;
        lastFullRunAt = k.takenAt;
      } else {
        fastFellBack = '快速增量退回全量:库里还没有这个列表的全量快照'
          + '(第一次采这个人?)—— 本次按全量跑,跑完就有基线了';
      }
    } catch (e) {
      fastFellBack = `快速增量退回全量:取上次名单出错(${String(e).slice(0, 120)})`;
    }
  }

  // ⭐ 导航 + 滚动 + 解析载荷,一条龙 —— 现成的,不重写
  /**
   * ⭐ 不传轮数 = **采到底为止**(停止由「连续 N 轮零新增」判据决定)。
   * ⚠️ 原默认 8 轮 —— 那只够采 ~60 人。
   */
  const r = await harvestTimeline(url, targetWcId, opts.maxRounds, {
    budgetMs: opts.budgetMs ?? 30_000,
    pageBudget: opts.pageBudget,
    knownHandles,
  });
  if ('error' in r) return { error: r.error };

  /** ⭐ 真按快速模式跑了吗 —— 退回全量时它是 false,后面的分支全看它 */
  const ranFast = !!knownHandles;

  let saved = 0;
  let authorsWithRelation = 0;
  let authorsWithBio = 0;
  const seenAuthors = new Set<string>();

  for (const t of r.tweets) {
    if (!t.tweetId) continue;

    // ── 推文入库(全收,不过滤)──
    try {
      await upsertTweet(toRecord(t, opts.wsId));
      saved += 1;
    } catch (err) {
      // ⚠️ 单条失败不拦整批 —— 但**不静默**:一条都存不进去要看得出来
      console.warn(`[x-auto-collect] 推文 ${t.tweetId} 入库失败:`, err);
    }

    // ── 作者维度:关系 / 蓝V 入库 ──
    const h = normalizeHandle(t.authorHandle ?? '');
    if (!h || seenAuthors.has(h)) continue;
    seenAuthors.add(h);

    /**
     * ⚠️ 只在**确实取到**时才写,`undefined` 一律不写 ——
     * 「载荷没带这个字段」与「查过了,是 false」含义相反,
     * 混起来会让追踪名单判错人(记忆 feedback-check-sample-contains-phenomenon)。
     */
    const hasRelation = t.iFollow !== undefined || t.followsMe !== undefined;
    const hasBio = !!t.authorBio;
    if (!hasRelation && t.isBlueVerified === undefined && !hasBio) continue;

    try {
      await saveAuthorCounts(h, {
        iFollow: t.iFollow,
        followsMe: t.followsMe,
        isBlueVerified: t.isBlueVerified,
        // ⭐ bio —— 盘点里覆盖率仅 2%,因为此前只有「导航到主页 + 等 12s」一条路
        bio: t.authorBio,
      });
      if (hasRelation) authorsWithRelation += 1;
      if (hasBio) authorsWithBio += 1;
    } catch (err) {
      console.warn(`[x-auto-collect] 作者 ${h} 入库失败:`, err);
    }
  }

  /**
   * ⭐⭐ **人入库** —— 采到的人写进 x_author。
   *
   * ⚠️ 与推文入库同一纪律:单条失败不拦整批,但**不静默**。
   * ⚠️ 只写**确实取到**的字段,undefined 一律不写 ——
   * 「载荷没带」与「查过是 false」含义相反。
   */
  let peopleWithBio = 0;
  let peopleWithRelation = 0;
  /**
   * ⭐ 采集顺序 —— 「X 的列表按什么排序」的唯一证据(migration 1.2.3)。
   * ⚠️ `r.people` 来自 Map,**顺序即载荷里的出现顺序**,也就是列表顺序。
   */
  let listSeq = 0;
  for (const person of r.people) {
    const hasBio = !!person.bio;
    const hasRel = person.iFollow !== undefined || person.followsMe !== undefined;
    if (hasBio) peopleWithBio += 1;
    if (hasRel) peopleWithRelation += 1;
    try {
      await saveAuthorCounts(person.handle, {
        bio: person.bio,
        isBlueVerified: person.isBlueVerified,
        iFollow: person.iFollow,
        followsMe: person.followsMe,
        xBlocking: person.xBlocking,
        followersCount: person.followersCount,
        followingCount: person.followingCount,
        tweetCount: person.tweetCount,
        accountCreatedAt: person.accountCreatedAt,
        // ⭐ migration 1.2.2 补了这一列(此前采到了没地方存)
        location: person.location,
        // ⭐ 顺序与来源一起写 —— 不同页面的序号不可比
        listSeq: listSeq++,
        listSource: pageLabel,
      });
      /**
       * ⚠️ 展示名/头像**不在 AuthorCounts 里** —— 那是 registerSeenAuthor 的字段。
       * 两个函数写的是同一张表的不同字段组,别硬塞。
       */
      await registerSeenAuthor(person.handle, {
        displayName: person.displayName,
        avatar: person.avatar,
      }).catch((e) => console.warn(`[x-auto-collect] 人 ${person.handle} 登记失败:`, e));
    } catch (err) {
      console.warn(`[x-auto-collect] 人 ${person.handle} 入库失败:`, err);
    }
  }

  /**
   * ⭐⭐ **列表快照 + 增量差集**(migration 1.2.5)
   *
   * ── 用户 2026-09-19 ──
   * > 「完成 follower 的增量采集吧。我自己的粉也增加到 2690 了。」
   *
   * ⭐ 用**差集**而不是「遇到采过的就停」:后者只在列表**严格按关注时间倒序**
   * 时成立,而 **X 按什么排序我们没有证据**(载荷里没有「何时关注」字段)。
   * 排序若不是时间序,新粉可能出现在任何位置,提前停会漏人 ——
   * 而那种漏在数据里**看不出来**。差集不依赖任何排序假设。
   *
   * ⚠️ 只在**采到人**时存快照。0 人那跑(比如被限流/页面没加载)若也存,
   * 下次对照会把「这次没采到」误判成「所有人都取关了」。
   */
  let incremental: AutoCollectReport['incremental'];
  /** ⭐ 快照失败要进 problems,不能只 console.warn */
  let snapshotProblem: string | undefined;
  /**
   * ⭐⭐⭐ **快速增量绝不写快照** —— 这是本次改动最要紧的一条安全约束。
   *
   * ── 不加这条会怎样 ──
   *
   * 快速增量只翻前一两页(几十人)。若把这几十人存成快照,
   * **下一次差集**会拿它当基线,于是报出:
   *   「新增 0 人,**取关 2700 人**」
   * ——一次快速采集就把 2781 人的基线毁了,而且**在数据里看不出来**
   * (表里确实有一条完整的快照记录,只是它只有 60 行)。
   *
   * ⭐ 所以:基线**只由全量维护**。快速增量照常写 `x_author`
   * (人的画像该入库还是入库),但**不碰 x_list_snapshot**。
   *
   * ⚠️ 判据用 `ranFast`(真按快速模式跑了吗),不是 `opts.fastIncremental`
   * (人想不想快)—— 退回全量那跑**是**完整列表,它必须写快照,
   * 否则第一次采一个新账号会永远建不起基线。两者差一个字,行为相反。
   */
  /**
   * ⭐⭐ **只有「稳定名单」页才该写快照** —— 2026-09-20 实测暴露。
   *
   * ── 现象 ──
   *
   * 采通知页(x.notifications)采到 374 人,**也写进了快照表**。
   * 但通知页的人**不是一个名单**:今天谁给你点赞就是谁,明天换一批。
   * 拿它做差集会报出「373 人取关」这种毫无意义的结果 ——
   * 而那种数字看起来像结论,会误导判断。
   *
   * ── 判据:这一页的人构成一个「名单」吗 ──
   *
   * · followers/following/verifiedFollowers → **是**。成员进出有意义,
   *   「谁新来、谁走了」正是差集要回答的。
   * · notifications/search/home/profile     → **否**。那是流水或单个人,
   *   两次采集之间的差额只反映「这次刷到了谁」,不是关系变化。
   *
   * ⚠️ 用**白名单**不是黑名单:将来加新页面时,默认**不写**快照
   * 才是安全的 —— 写错了要靠人看出「这个差集没意义」,
   * 而不写最多是少个功能,不会产出假结论。
   */
  const isListPage = /^x\.(followers|following|verifiedFollowers)\b/i.test(pageLabel);
  const mayWriteSnapshot = !ranFast && isListPage;
  if (r.people.length > 0 && mayWriteSnapshot) {
    const scope = pageLabel;
    const runId = new Date().toISOString();
    try {
      /** 上一次的批次 —— 要在写入本次之前取,否则取到的就是自己 */
      const prevRuns = await recentSnapshotRuns(scope, 1);
      const prev = prevRuns[0];

      /**
       * ⭐⭐ **空 handle 必须先滤掉** —— 2026-09-19 实测真因。
       *
       * 现象:采到 2753 人,快照**三跑都只写进 2493**(seq 0..2492,断点分毫不差),
       * 而把批大小从 500 改到 50 **断点纹丝不动** —— 说明不是批量大小的事。
       *
       * 真因:schema 上 `handle` 带 `ASSERT $value != ''`,
       * 而 `FOR` 里**一条 ASSERT 失败会让整批写入 0 条**(已实测:
       * 3 条里夹 1 条空 handle → 整批写进 0 条)。
       * `normalizeHandle` 对异常数据会返回空串,那一批就全灭了。
       *
       * ⭐ 先滤 + 记数:滤掉多少要**说出来**,不能静默少写
       * (铁律四:成功要对账)。
       */
      const snapRows = r.people
        .map((pp, i) => ({ handle: normalizeHandle(pp.handle), seq: i }))
        .filter((x) => x.handle !== '');
      const dropped = r.people.length - snapRows.length;
      await saveListSnapshot(scope, runId, snapRows);
      if (dropped > 0) {
        snapshotProblem = `列表快照:${dropped} 人的 handle 为空已跳过`
          + `(采到 ${r.people.length},写入 ${snapRows.length})`;
      }

      if (prev) {
        const d = await diffSnapshots(scope, runId, prev);
        const ord = await orderingStability(scope, runId, prev);
        incremental = {
          prevRunId: prev,
          added: d.added.length,
          removed: d.removed.length,
          kept: d.kept,
          addedSample: d.added.slice(0, 20),
          removedSample: d.removed.slice(0, 20),
          /**
           * ⭐ 排序证据 —— 「X 按什么排序」第一次有实测数据。
           * 新人都在最前 + 老人位移小 → 时间倒序(增量可以只翻前几页)
           * 位移乱跳 → 不是时间序(每次必须采全)
           */
          ordering: {
            common: ord.common,
            maxShift: ord.maxShift,
            medianShift: ord.medianShift,
            newcomersAtFront: ord.newcomersAtFront,
            newcomersTotal: ord.newcomersTotal,
          },
        };
      } else {
        incremental = { firstRun: true, added: r.people.length, removed: 0, kept: 0 };
      }
    } catch (e) {
      /** ⚠️ 快照失败不影响采集结果,但要说出来 —— 静默坍缩是红线 */
      console.warn('[x-auto-collect] 列表快照/差集失败:', e);
      incremental = { error: String(e) };
      /**
       * ⭐ **进 problems** —— 只放进 incremental.error 还不够醒目。
       * 实测 2026-09-19:采到 2772 人、快照只写进 2493,
       * 而面板上看不出任何异常 —— 用户是靠「感觉数字有点问题」发现的。
       * 铁律一(失败要响)+ 铁律四(成功要对账)。
       */
      snapshotProblem = `列表快照没写全 —— ${String(e).slice(0, 200)}`;
    }
  }

  /**
   * ⭐⭐ 基准对账 —— 用户 2026-09-18:「首页有一个多少人关注、多少人未关注,
   * 这个就是基准,出入不超过 10% 即可。」
   *
   * ⚠️ 只在**采人**时才有意义(采推没有这个分母)。
   * ⚠️ 分母来自库里存过的 followers_count/following_count ——
   * 拿不到就**不编一个数**,如实说「没有基准」。
   */
  /** 早于 notes 收集的说明(对账那段之前就要用) */
  const notesPre: string[] = [];
  let reconcile: AutoCollectReport['reconcile'];
  /**
   * ⭐⭐ **采推也要对账** —— 2026-09-20 用户指出的缺口。
   *
   * ── 这个门槛原来把采推整个挡在外面 ──
   *
   * 条件写的是 `r.people.length > 0`,而**采推那跑 people 恒为 0** →
   * 对账段永远进不去 → 报告里只有 `coverage`(每条完整吗),
   * 没有任何「**该采的都采到了吗**」。
   *
   * ⚠️ 这正是 followers 踩过的坑的翻版:「采到 250 人且条条字段齐全」
   * 看着很好,实际漏了 2500 人。**完整 ≠ 齐全**:
   * · coverage  = 采到的每条，字段全不全
   * · reconcile = 该采的，采到了几成
   * 实测 2026-09-20:自己的主页采到 476 条,而 X 报 4938 条 = **9.6%**,
   * 而报告里**一个字都没提**。
   *
   * ⭐ 分母现成:`tweet_count` 就在人的画像里(getAuthorCounts 已经返回)。
   */
  const isProfile = /profile/i.test(opts.pageLabel ?? '');
  const isWithReplies = /withreplies/i.test(opts.pageLabel ?? '');
  /** 采推的页面:主页 / with_replies —— 它们有 tweet_count 这个分母 */
  const tweetPageWithBaseline = (isProfile || isWithReplies) && r.tweets.length > 0;

  /**
   * ⭐⭐ **单条推详情页(x.status)的对账** —— 分母是**根推自己的 reply_count**。
   *
   * ── 为什么它要单独一条分支 ──
   *
   * ① **分母不在「某个人」身上,在那条推身上** —— 所以它**不需要 ownerHandle**
   *    (x.status 的 handle 可以是 `i`,X 会自己跳转)。挂在上面那个
   *    `&& opts.ownerHandle` 的门槛里会**永远进不去**。
   * ② 分母**就在这一跑的载荷里**(根推的 metrics.replies),
   *    不用查库、不用担心时间差 —— 这是所有页面里分母最干净的一个。
   *
   * ── ⚠️ 这个比例天生对不齐,而且不是漏采 ──
   *
   * `reply_count` 是**整棵树**的总回复数(含回复的回复),而详情页一次
   * 加载只给**直接回复 + 部分展开**。所以采到的数**天然小于**它,
   * 这是**结构性**的,不是漏。判词必须说清 ——
   * 否则会把「X 的分页设计」误读成「我们采漏了」。
   */
  const isStatus = /status/i.test(opts.pageLabel ?? '');
  /**
   * ⭐ 根推 = 这一跑里**被回复得最多的那条**。
   * ⚠️ 不按「第一条」认:载荷里的顺序不保证根推在前
   * (X 有时先给热门回复)。用 reply_count 最大的那条最稳 ——
   * 一棵树里根推的回复数必然 ≥ 任何一条回复的回复数。
   */
  const rootTweet = isStatus && r.tweets.length > 0
    ? r.tweets.reduce((a, b) =>
      ((b.metrics?.replies ?? -1) > (a.metrics?.replies ?? -1) ? b : a))
    : undefined;
  const statusBaseline = rootTweet?.metrics?.replies;

  /**
   * ⚠️⚠️ **排除 status** —— 2026-09-20 实测踩到:
   *
   * status 的对账原本写成 `} else if (isStatus …)`,挂在这个 if 的 else 上。
   * 而详情页**也会采到人**(推文作者,报告里「采到 1 人」),
   * 于是 `r.people.length > 0 && ownerHandle` **成立**,
   * 走进了上面这条(按「人」对账)→ 报出「没有基准可对:这个页面没有基准概念」,
   * **status 那条分支永远轮不到**。
   *
   * ⭐ 教训:`else if` 意味着「前面都不成立才轮到我」——
   * 而这里两条分支的触发条件**本来就会同时成立**。
   * 守卫当时只钉了「status 的条件里不能有 ownerHandle」,
   * 没钉「它会不会被前一条吃掉」—— 那是守卫的盲区。
   */
  /** ⚠️ 临时诊断(2026-09-20 查「withReplies 没出对账」)—— 定位后删 */
  console.log('[对账诊断]', JSON.stringify({
    pageLabel: opts.pageLabel, ownerHandle: opts.ownerHandle,
    people: r.people.length, tweets: r.tweets.length,
    isStatus, tweetPageWithBaseline,
    willEnter: !isStatus && (r.people.length > 0 || tweetPageWithBaseline) && !!opts.ownerHandle,
  }));
  if (!isStatus && (r.people.length > 0 || tweetPageWithBaseline) && opts.ownerHandle) {
    const owner = normalizeHandle(opts.ownerHandle);
    const isFollowing = /following/i.test(opts.pageLabel ?? '');
    const isFollowers = /followers/i.test(opts.pageLabel ?? '');
    const isVerified = /verified/i.test(opts.pageLabel ?? '');

    let baseline: number | undefined;
    /**
     * ⚠️ 查不到基准有**三种**成因,处置完全不同 ——
     * 只说「没有基准」等于没说(用户实测 2026-09-18:reconcile 显示 `250/?`,
     * 而我分不清是没采过主页、还是采了但没存这个字段)。
     */
    let why = '';
    if (!isVerified && (isFollowing || isFollowers)) {
      try {
        const counts = await getAuthorCounts(owner);
        baseline = isFollowing ? counts.followingCount : counts.followersCount;
        if (baseline === undefined) {
          why = counts.countsAt
            ? `库里有 @${owner} 的行(${counts.countsAt} 采的)但**没有${isFollowing ? '关注数' : '粉丝数'}** ——`
              + '多半是采主页时载荷没带 relationship_counts(那是别人看你时才有的视角)'
            : `库里**没有 @${owner} 这个人** —— 先采一次他的主页(x.profile)`;
        }
      } catch (err) {
        why = `查基准出错:${String(err)}`;
      }
    }
    /**
     * ⭐⭐ **采推的分母 = tweet_count**(用户 2026-09-02 定的:
     * 「tweet_count 是采集完整度的分母」)。
     *
     * ⚠️ 分母要**优先用这一跑刚采到的**,而不是库里的旧值 ——
     * 主页载荷里就带着本人的 tweet_count,那是**与采集同一时刻**的数。
     * 用库里的旧值会引入时间差:实测 following 那次,分母是两天前的 2553、
     * 采集是两天后的 2884,差出来的 91 人**分不清是时间差还是真漏**。
     * 同时刻取分母,这条歧义就没有了。
     */
    if (tweetPageWithBaseline) {
      const selfInPayload = r.people.find((p) => p.handle === owner);
      if (selfInPayload?.tweetCount !== undefined) {
        baseline = selfInPayload.tweetCount;
        why = '';
      } else {
        try {
          const counts = await getAuthorCounts(owner);
          baseline = counts.tweetCount;
          if (baseline === undefined) {
            why = counts.countsAt
              ? `库里有 @${owner} 的行(${counts.countsAt} 采的)但**没有发推数**`
              : `库里**没有 @${owner} 这个人** —— 先采一次他的主页(x.profile)`;
          } else {
            /** ⚠️ 用了旧分母就**说出来** —— 时间差会让对账出现说不清的尾巴 */
            why = `分母取自库里 ${counts.countsAt ?? '?'} 的快照,`
              + '不是这一跑同时刻的数 —— 期间新发的推会让比例偏低';
          }
        } catch (err) {
          why = `查基准出错:${String(err)}`;
        }
      }
    }

    /**
     * ⭐ 分子:采人那跑数人,采推那跑数推 —— **对账的两边必须是同一种东西**。
     * ⚠️ 写死 `r.people.length` 会让采推那跑的分子恒为 0(人本来就是 0),
     * 对账结果恒为「0%」—— 那比不对账更糟,因为它看起来像个结论。
     */
    const got = tweetPageWithBaseline ? r.tweets.length : r.people.length;
    if (isVerified) {
      /**
       * ⭐⭐ **交叉基准** —— X 不报蓝V关注者总数,但 followers 列表里
       * 标了蓝V的人数是另一个**独立观测**,拿来互相验证。
       *
       * ── 用户 2026-09-19 ──
       * > 「我再取一次蓝V的数据,用来比对从 Follower 获取的数据是否准确。
       * >   但是要监控好是否取完整了,因为这里 x 没有给出总数的。」
       *
       * ⚠️ 这不是真值,是「两个来源一致吗」。两边都可能不全,
       * 但**两边接近**就说明至少没有一边出大漏子;**差很多**就说明
       * 至少一边没采全,而**不知道是哪边,数据就不能用**。
       *
       * ⚠️⚠️ 这里原来写着「followers 列表受 ~2500 天花板限制」——
       * **2026-09-19 已证否**(真因是滚动轮数不够,改 PDCA 后采到 2781)。
       *
       * ⭐ 「采完没有」的真判据仍是**停止原因**:
       * 「X 说没有更多了」才是采完;「连续 N 页零新人」「达到翻页上限」
       * 都是**没采完**,要加大闸门重跑
       * (⚠️ 别再解释成「X 的天花板」—— 那条结论已被证否)。
       */
      let crossNote = '';
      try {
        const x = await countBlueVerifiedInFollowers(owner);
        if (x.blueInFollowers !== undefined) {
          const diff = got - x.blueInFollowers;
          const pct = x.blueInFollowers > 0
            ? ((got / x.blueInFollowers) * 100).toFixed(0) : '?';
          crossNote = `；交叉基准:followers 列表里标蓝V的有 ${x.blueInFollowers} 人`
            + `(共 ${x.followersTotal ?? '?'} 人),这次采到 ${got}(${pct}%)`
            + (Math.abs(diff) <= Math.max(20, x.blueInFollowers * 0.05)
              ? ' —— ✓ 两个来源**基本一致**,可以互相印证'
              : ` —— ⚠️ 相差 ${diff > 0 ? '+' : ''}${diff} 人,**至少一边没采全**`
                + '(不知道是哪边,这份数据先别用来下结论)');
        }
      } catch (e) {
        crossNote = `；交叉基准查询失败:${String(e)}`;
      }
      /** ⭐ 采完没有 —— 只认 X 的话,别的都是「没采完」 */
      const doneByCursor = !r.paging.hasMore;
      reconcile = {
        got,
        note: 'Verified Followers **没有总数** —— X 不报「多少个蓝V关注者」。'
          + `采完判据看游标:${doneByCursor
            ? '✓ **X 说没有更多了** —— 这一页采完了'
            : '⚠️ **X 说还有下一页** —— 没采完'}`
          + crossNote,
      };
    } else if (baseline === undefined) {
      reconcile = { got, note: `没有基准可对:${why || '这个页面没有基准概念'}` };
    } else {
      const rate = baseline > 0 ? got / baseline : 0;
      const pct = (rate * 100).toFixed(0);
      const unit = tweetPageWithBaseline ? '条推' : '人';
      /**
       * ⚠️ 采推的**分母语义和采人不一样**,判词必须跟着变:
       * · 采人:followers_count 就是这个列表该有的人数,**可以直接比**
       * · 采推:tweet_count 是**这个人发过的全部推**,而主页时间线
       *   **本来就不给你全部** —— X 只给最近的一段,越往前越稀疏,
       *   而且转推/回复算不算进 tweet_count 各页口径还不一样。
       * 所以采推比例低**不能直接判成「没采完」** —— 那会把「X 就是不给」
       * 说成「我们采漏了」,指向完全错误的修法。
       */
      reconcile = {
        baseline, got, rate,
        note: tweetPageWithBaseline
          ? `采到 ${got}/${baseline} ${unit}(${pct}%)`
            + `${why ? `;⚠️ ${why}` : ''}`
            + `;停止原因:${r.stopReason}`
            + '。⚠️ **低比例不等于采漏** —— 主页时间线本就不给全部历史'
            + '(X 越往前越稀疏,且转推/回复是否计入 tweet_count 口径不一)。'
            + `真判据仍是游标:${r.paging.hasMore
              ? '**X 说还有下一页** —— 加大轮数/预算还能拿到更多'
              : '**X 说没有更多了** —— 这一页给到头了'}`
          : rate >= 0.9
            ? `采到 ${got}/${baseline}(${pct}%)—— 够了(基准是活的,采集期间有人关注/取关很正常)`
            : `⚠️ 采到 ${got}/${baseline}(${pct}%)—— **明显少于基准**,`
              + `多半没采完(看游标:${r.paging.hasMore ? 'X 说还有下一页' : 'X 说没了'})`,
      };
    }
  }
  /** ⭐ **独立 if,不是 else if** —— 见上面那段:挂 else 会被「采到人」吃掉 */
  if (isStatus && r.tweets.length > 0) {
    /**
     * ⭐⭐ **单条推详情页的对账**(独立分支,不走上面那条)。
     *
     * ⚠️ 上面那条挂着 `&& opts.ownerHandle`,而 x.status **可以没有 handle**
     * (X 接受 `/i/status/<id>` 并自己跳转)—— 挂在那里会永远进不去。
     *
     * ⭐ 分子 = 这次采到的推里**除根推以外**的(那些就是回复);
     *    分母 = 根推自己的 reply_count。两个数**都在这一跑的载荷里**,
     *    不查库、无时间差 —— 所有页面里最干净的一个分母。
     */
    const replies = Math.max(0, r.tweets.length - 1);
    if (statusBaseline === undefined) {
      reconcile = {
        got: replies,
        note: '这条推**没拿到 reply_count** —— 根推的 metrics 没解出来,'
          + `所以没有分母(采到 ${r.tweets.length} 条推)。`
          + `采完判据只能看游标:${r.paging.hasMore ? '⚠️ X 说还有下一页' : '✓ X 说没有更多了'}`,
      };
    } else {
      const rate = statusBaseline > 0 ? replies / statusBaseline : 0;
      const pct = (rate * 100).toFixed(0);
      /**
       * ⚠️⚠️ **这个比例天生对不齐,而且不是漏采**:
       * `reply_count` 是**整棵树**的总数(含回复的回复),
       * 而详情页一次加载只给**直接回复 + 部分展开**。
       * 把它判成「没采完」会指向错误的修法 —— 那是 X 的分页设计,不是我们的漏。
       *
       * ⭐ 真判据仍是游标 + 「还有没有 ShowMore 折叠区没展开」。
       */
      reconcile = {
        baseline: statusBaseline, got: replies, rate,
        note: `采到 ${replies} 条回复 / 根推报 ${statusBaseline} 条(${pct}%)`
          + `;根推 ${rootTweet?.tweetId ?? '?'}`
          + '。⚠️ **对不齐是正常的** —— reply_count 是**整棵树**的总数'
          + '(含回复的回复),而详情页一次只给直接回复 + 部分展开,'
          + '**不是我们采漏了**。'
          + `真判据看游标:${r.paging.hasMore
            ? '⚠️ **X 说还有下一页** —— 加大轮数还能拿到更多'
            : '✓ **X 说没有更多了** —— 这一页给到头了'}`,
      };
    }
  }

  /**
   * ⭐ 采**某人主页**时,把这个人自己的基准数报出来 ——
   * 那正是后续采他的关注者列表时要用的分母。
   *
   * ⚠️ 用户实测 2026-09-18:采完自己主页后,再采 followers 仍显示「没有基准」。
   * 而 `UserByScreenName` 载荷**确实带 relationship_counts**
   * (x-author-profile.ts:10 记着「能力勘查 §2.4 早已实测记录」),
   * 解析路径也一致 —— 所以问题在「页面主人到底有没有被采到」。
   * 与其猜,不如**让采集自己报告**。
   */
  /**
   * ⚠️ 只在采**主页**时检查「本人的基准入库没有」。
   *
   * 用户实测 2026-09-18:采 verifiedFollowers 时报
   * 「采到 241 人但其中没有 @otun_myvpn 本人 —— 所以粉丝数没能入库」,
   * **那句是错的**:粉丝数上一次采主页时就入库了(2604)。
   * 它混淆了两件事 ——
   *  · 这一次有没有采到本人(关注者列表里**本该没有**你自己)
   *  · 库里有没有基准(有)
   * 在列表页说这句话纯属误导。
   */
  const isProfilePage = /profile/i.test(opts.pageLabel ?? '');
  if (isProfilePage && opts.ownerHandle && r.people.length > 0) {
    const owner = normalizeHandle(opts.ownerHandle);
    const self = r.people.find((p) => p.handle === owner);
    if (!self) {
      notesPre.push(
        `⚠️ 采到 ${r.people.length} 人,但**其中没有 @${owner} 本人** —— `
        + '所以他的粉丝数没能入库,后续采他的关注者列表会没有基准',
      );
    } else if (self.followersCount === undefined && self.followingCount === undefined) {
      notesPre.push(
        `⚠️ 采到了 @${owner} 本人,但载荷**没带 relationship_counts** —— `
        + '粉丝/关注数拿不到(可能是「看自己主页」与「看别人主页」的视角差异)',
      );
    } else {
      notesPre.push(
        `✓ 基准已入库:@${owner} 粉丝 ${self.followersCount ?? '?'} · `
        + `关注 ${self.followingCount ?? '?'} —— 采他的列表时有分母可对了`,
      );
    }
  }

  const fromPayload = r.tweets.filter((t) => !t.fromDom).length;

  /**
   * ⭐ 「截到载荷却一条推都没解出来」要**说清楚**,不能只报 0 条。
   *
   * ── 用户 2026-09-18 在 verified_followers 页上采集 ──
   *
   * 这几页(followers / following / verified_followers)的载荷是
   * `Followers`/`Following` —— 内容是**人的列表**,而 `extractTweetsFrom`
   * 只认带 `legacy.id_str` 的推文对象,会把这些载荷整个跳过。
   *
   * ⚠️ 那样报告会显示「采到 0 条」,看着像**采集坏了** ——
   * 而事实是「这一页本来就没有推文,需要的是另一种解析器」。
   * 两者的处置完全不同:前者要修采集,后者要加「采人」能力。
   */
  let dbCheck: AutoCollectReport['dbCheck'];
  if (saved > 0) {
    const SAMPLE = 20;
    const ids = r.tweets.slice(0, SAMPLE).map((t) => t.tweetId).filter(Boolean);
    if (ids.length > 0) {
      try {
        const stored = await readBackTweets(ids);
        /** ⭐ 只查**采集该负责**的字段 —— 业务后填的(accepted/replied/ai_verdict)不算 */
        const OWNED = [
          'text', 'author_handle', 'created_at', 'lang', 'metrics',
          'tweet_url', 'author_avatar', 'author_name_at_post', 'conversation_id',
        ] as const;
        const gaps = OWNED.map((f) => {
          const empty = stored.filter((row) => {
            const v = (row as Record<string, unknown>)[f];
            return v === undefined || v === null || v === ''
              || (typeof v === 'object' && Object.keys(v as object).length === 0);
          }).length;
          return { field: f, empty, of: stored.length };
        }).filter((g) => g.empty > 0);
        dbCheck = {
          sampled: stored.length,
          asked: ids.length,
          gaps,
        };
      } catch (e) {
        dbCheck = { sampled: 0, asked: ids.length, gaps: [], error: String(e).slice(0, 200) };
      }
    }
  }


  const notes: string[] = [...notesPre];
  /**
   * ⭐ 把「采完没有」说成人话 —— 这是全量/增量的第一个问题。
   * ⚠️ 只报**事实**:X 说还有 / X 说没了。「该不该再采」是分析层的判断。
   */
  if (r.paging.hasMore) {
    notes.push(
      `X 说**还有下一页**(游标未耗尽)—— 本次停在「${r.stopReason}」,`
      + '加大轮数或预算能拿到更多',
    );
  } else if (r.payloads > 0) {
    notes.push('X 说**没有下一页了** —— 这一页已采完(不是「滚不动了」,是真的到底)');
  }
  if (r.people.length > 0) {
    notes.push(`这一页采的是**人**不是推:${r.people.length} 人入库(${peopleWithBio} 人有 bio)`);
  }

  /**
   * ⭐⭐ **解析率进 notes** —— 每个页面都要能回答「完整吗」。
   *
   * ⚠️ 它是 note(事实说明)**不是 problem**(链路坏了):
   * 去重后的数本来就可能小于条目数(滚动时 X 会重发前面的内容),
   * 所以低比例**不等于漏** —— 判词里必须说清,否则人会去修没坏的东西。
   * 这与采推那条「低比例不等于采漏」是同一个纪律。
   */
  if (r.parseRate && r.parseRate.entries > 0) {
    const { entries, parsed, rate } = r.parseRate;
    const pct = rate !== undefined ? (rate * 100).toFixed(0) : '?';
    notes.push(
      `解析率:X 给了 ${entries} 个条目,解出 ${parsed} 条(${pct}%)`
      + (rate !== undefined && rate > 1.2
        ? '。⚠️ **超过 100%** —— 一个条目里嵌了多个对象(如引用推),'
          + '或者分母没数全,这个数**先别当准**'
        : '')
      + '。⚠️ 载荷会重发前面的内容,去重后小于条目数是正常的 —— '
      + '**低比例不等于漏**;真要判漏看「有没有整类结构没认出来」'
      + (r.unparsedSamples.length > 0
        ? `(本次有 ${r.unparsedSamples.length} 个载荷一条都没解出来,见样本)`
        : '(本次没有「一条都没解出来」的载荷)'),
    );
  }

  /**
   * ⭐⭐⭐ **入库回读进 notes** —— 「存对了吗」要说出来。
   *
   * ⚠️ 字段在库里整片为空 = **采集链路真的坏了**(而不是数据质量),
   * 所以进 problems 不只是 notes:铁律一「失败要响」。
   * 但**抽样里恰好都没有**(如没人转发过的推没有 quoted)不该报 ——
   * 只报那些「采集该负责、却整片空」的。
   */
  if (dbCheck) {
    if (dbCheck.error) {
      notes.push(`入库回读失败:${dbCheck.error} —— 不能确认存对了没有`);
    } else {
      const missed = dbCheck.asked - dbCheck.sampled;
      if (missed > 0) {
        notes.push(
          `⚠️ 入库回读:查 ${dbCheck.asked} 条只读回 ${dbCheck.sampled} 条`
          + ` —— **有 ${missed} 条没写进库**(报告说入库成功,库里却没有)`,
        );
      }
      if (dbCheck.gaps.length > 0) {
        const all = dbCheck.gaps.filter((g) => g.empty === g.of);
        const some = dbCheck.gaps.filter((g) => g.empty < g.of);
        if (all.length > 0) {
          notes.push(
            `⚠️⚠️ 入库回读:这些字段**整片为空**(抽查 ${dbCheck.sampled} 条全空)`
            + `:${all.map((g) => g.field).join('、')}`
            + ' —— 多半是解析没取、或 toRecord 没写、或类型没声明这一列',
          );
        }
        if (some.length > 0) {
          notes.push(
            `入库回读:部分为空 —— ${some.map((g) => `${g.field} ${g.empty}/${g.of}`).join('、')}`
            + '(可能是这些推本来就没有,不一定是漏)',
          );
        }
      } else {
        notes.push(`✓ 入库回读:抽查 ${dbCheck.sampled} 条,采集该给的字段**都在库里**`);
      }
    }
  }

  /**
   * ⭐⭐ **快速增量的如实说明** —— 用户 2026-09-19 拍板:
   * 「如实说明 + 建议全量周期」,不假装它是完整的对账。
   */
  let fast: AutoCollectReport['fast'];
  if (fastFellBack) notes.push(fastFellBack);
  if (ranFast && r.fastIncremental) {
    const fi = r.fastIncremental;
    /** ⭐ 新人 = 这次采到、而上次全量名单里没有的 */
    const newcomers = r.people
      .map((p) => normalizeHandle(p.handle))
      .filter((h) => h !== '' && !knownHandles?.has(h));

    /** 距上次全量多少天 —— run_id 就是 ISO 时间串 */
    const days = lastFullRunAt
      ? Math.floor((Date.now() - new Date(lastFullRunAt).getTime()) / 86_400_000)
      : undefined;

    fast = {
      knownBaseline: fi.knownBaseline,
      caughtUp: fi.caughtUp,
      newcomers,
      lastFullRunAt,
      daysSinceFullRun: days,
    };

    notes.push(
      `快速增量:翻了 ${r.pagedRounds} 页就追上上次的名单`
      + `(基线 ${fi.knownBaseline} 人,连续见到 ${fi.knownRun} 个已知的人)`
      + ` —— 新增 ${newcomers.length} 人`
      + (newcomers.length > 0 ? `:@${newcomers.slice(0, 20).join(' @')}` : ''),
    );

    /**
     * ⭐⭐ **边界必须每次都说** —— 不是「偶尔提醒」。
     *
     * 取关者是从名单**中间**消失的(实测那位在 seq 868),
     * 只翻前几页**永远**发现不了。不说的话,用户会把
     * 「没报取关」读成「没人取关」—— 而那两件事天差地别。
     */
    notes.push(
      '⚠️ 快速增量**看不见取关** —— 取关的人是从名单中间消失的,'
      + '只翻前几页发现不了。「谁取关了」只有全量能回答'
      + (days !== undefined ? `(距上次全量 ${days} 天)` : '')
      + ';建议每周跑一次全量兜底。',
    );

    /** ⭐ 快速模式没写快照,要说出来 —— 否则人会以为基线更新了 */
    notes.push(
      '⚠️ 本次**没有写快照**(基线仍是上次全量的)—— '
      + '快速增量只采了前几十人,存成快照会让下次差集把没翻到的人全报成「取关」。',
    );
  }
  if (r.tweets.length === 0 && r.people.length === 0 && r.payloads > 0) {
    notes.push(
      `截到 ${r.payloads} 个载荷但解出 0 条推 —— `
      + '这一页多半没有推文(如关注者/关注中列表),'
      + '需要的是「采人」而不是「采推」,不是采集坏了',
    );
  }

  /**
   * ⭐⭐ 字段级覆盖率 —— 用户 2026-09-18:「每一条数据都是完整的吗?」
   *
   * ⚠️ 分母按字段种类算,**不是一律用总条数**:
   *  · always     → 分母 = 全部
   *  · payloadOnly→ 分母 = **载荷来源那些**(DOM 兜底的推本来就没有,
   *                 算进去会让覆盖率无谓地低,而低得没有信息量)
   *  · conditional→ **不算覆盖率**(不是回复本来就没 inReplyTo),
   *                 只报「有几条带了」,避免制造假缺失
   */
  const coverage = FIELD_SPEC.map((spec) => {
    const pool = spec.kind === 'payloadOnly'
      ? r.tweets.filter((t) => !t.fromDom)
      : r.tweets;
    const have = pool.filter((t) => has(spec.get(t))).length;
    const total = spec.kind === 'conditional' ? 0 : pool.length;
    return {
      field: spec.field,
      have,
      total,
      rate: total > 0 ? have / total : 0,
    };
  });

  /**
   * ⭐⭐⭐ **回读库里那几条** —— 「解析对了」≠「存对了」。
   *
   * ── 用户 2026-09-21 ──
   * > 「我觉得先观察单条推文的完整性,然后才是 item 的条数」
   *
   * ⚠️ 上面的 `coverage` 量的是 **`HarvestedTweet`**(内存里解析出来的),
   * 而两者之间隔着 `toRecord()` 转换 —— **解析对了不代表存对了**。
   * 实测 2026-09-21:`conversation_id` schema 有列、解析器有值,
   * 唯独 `TweetInboxRecord` 类型没声明 → 写不进去 → 库里恒空。
   * 三处各自看都正常,**只有端到端对照才看得出来**。
   *
   * ⭐ 这正是可靠性纲领的**铁律四:成功要对账** ——
   * 写完回读,而不是「没抛异常就当成了」。
   *
   * ⚠️ 只抽查前 N 条:全量回读几千条会把一次采集拖慢很多,
   * 而抽样足以发现「整个字段没写进去」这类问题(那才是要防的),
   * 单条偶发缺失本来就该由 coverage 那边看。
   */
  /**
   * ⭐ 逐条明细 —— 人要能逐条看,不是只看百分比。
   * ⚠️ `conditional` 不算缺失,否则每条都"缺"一堆本来就不该有的东西。
   */
  const sample = r.tweets.slice(0, 40).map((t) => ({
    tweetId: t.tweetId,
    handle: t.authorHandle,
    fromDom: !!t.fromDom,
    missing: FIELD_SPEC
      .filter((spec) => {
        if (spec.kind === 'conditional') return false;
        if (spec.kind === 'payloadOnly' && t.fromDom) return false;  // DOM 兜底没有是正常的
        return !has(spec.get(t));
      })
      .map((spec) => spec.field),
  }));

  return {
    url: r.url,
    tweets: r.tweets.length,
    fromPayload,
    saved,
    authorsWithRelation,
    authorsWithBio,
    payloads: r.payloads,
    problems: snapshotProblem ? [...r.problems, snapshotProblem] : r.problems,
    notes,
    unparsedSamples: r.unparsedSamples,
    seenOps: r.seenOps,
    people: r.people.length,
    peopleWithBio,
    peopleWithRelation,
    stopReason: r.stopReason,
    rounds: r.rounds,
    pagedRounds: r.pagedRounds,
    pagingSkipped: r.pagingSkipped,
    /** ⭐ 解析率 —— 每个页面都有,包括没有外部分母的那些 */
    parseRate: r.parseRate,
    /** ⭐ 入库回读 —— 「存对了吗」 */
    dbCheck,
    failedUrl: r.failedUrl,
    /** ⭐ 抄到的那条请求 —— 只带 URL,请求头含鉴权不外传 */
    capturedUrl: r.lastRequest?.url,
    dateSpan: r.dateSpan,
    paging: { hasMore: r.paging.hasMore, cursor: r.paging.bottom },
    /** ⭐ 增量:与上次快照的差集 + 排序稳定性证据 */
    incremental,
    /** ⭐ 快速增量:新增了谁 + 追上了没有 + 距上次全量多久 */
    fast,
    reconcile,
    elapsedMs: Date.now() - t0,
    longText: (() => {
      const longs = r.tweets.filter((t) => t.isLongText);
      const lens = r.tweets.map((t) => (t.text ?? '').length);
      return {
        count: longs.length,
        maxChars: lens.length ? Math.max(...lens) : 0,
        avgChars: lens.length ? Math.round(lens.reduce((a, b) => a + b, 0) / lens.length) : 0,
      };
    })(),
    coverage,
    sample,
  };
}
