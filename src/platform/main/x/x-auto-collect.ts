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
import { upsertTweet } from '../db/tweet-inbox-repo';
import { saveAuthorCounts, registerSeenAuthor, getAuthorCounts } from '../db/x-author-repo';
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
    tweet_url: t.tweetUrl,
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
  } = {},
): Promise<AutoCollectReport | { error: string }> {
  const t0 = Date.now();
  /** 这批顺序属于哪个列表 —— followers 的第 3 名 ≠ following 的第 3 名 */
  const pageLabel = opts.pageLabel ?? url;

  // ⭐ 导航 + 滚动 + 解析载荷,一条龙 —— 现成的,不重写
  const r = await harvestTimeline(url, targetWcId, opts.maxRounds ?? 8, {
    budgetMs: opts.budgetMs ?? 30_000,
    pageBudget: opts.pageBudget,
  });
  if ('error' in r) return { error: r.error };

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
  if (r.people.length > 0 && opts.ownerHandle) {
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

    const got = r.people.length;
    if (isVerified) {
      reconcile = {
        got,
        note: 'Verified Followers **没有基准** —— X 不单独报「多少个蓝V关注者」,'
          + '这一页只能靠游标判断采完没有',
      };
    } else if (baseline === undefined) {
      reconcile = { got, note: `没有基准可对:${why || '这个页面没有基准概念'}` };
    } else {
      const rate = baseline > 0 ? got / baseline : 0;
      const pct = (rate * 100).toFixed(0);
      reconcile = {
        baseline, got, rate,
        note: rate >= 0.9
          ? `采到 ${got}/${baseline}(${pct}%)—— 够了(基准是活的,采集期间有人关注/取关很正常)`
          : `⚠️ 采到 ${got}/${baseline}(${pct}%)—— **明显少于基准**,`
            + `多半没采完(看游标:${r.paging.hasMore ? 'X 说还有下一页' : 'X 说没了'})`,
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
    problems: r.problems,
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
    dateSpan: r.dateSpan,
    paging: { hasMore: r.paging.hasMore, cursor: r.paging.bottom },
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
