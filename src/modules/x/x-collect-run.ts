/**
 * ⭐⭐⭐ **采一页的全流程** —— 采集 → 研判 → 按深度补全 → 核对
 *
 * ── 用户 2026-10-03 定的逻辑(原话)──
 * 「先 tweetid,然后**研判**这个推文是需要 showall 还是需要点击进入 article,
 * 　最后**根据业务的要求**来执行是否要获取全部内容。」
 * 「是否需要逐层获取,**根据采集的要求定下来**就可以了。」
 *
 * ⭐ 为什么是一个模块而不是写在按钮里:
 * 原先这 60 行编排全挤在 JSX 的 onClick 里,再往里加「逐篇补正文」
 * 只会更糟 —— 而且**写在 onClick 里的东西测不了**。
 *
 * ⚠️ 本模块**不碰 Electron、不碰 React**:所有动作经 `RunDeps` 注入,
 * 所以它能在单测里跑完整条链路(含补全循环),不用真机。
 */

import {
  auditTimelinePayload, summarizeAudits, mergeExpandedText, nextPageCursorOf,
  type TimelineAudit, type TweetAudit,
  type TweetRecord,
} from './x-timeline-audit';
import { judgeTweet, decideFetch, type FetchDepth, type TweetNeed } from './x-fetch-plan';
import { carriesTweets, carriesUsers, X_NOISY_URLS, X_PAGE_MATCHERS, X_PAGE_NAME } from './x-pages';
import { dispatchPayloads, type PayloadKind } from './x-payload-dispatch';
import type { XUserAudit, XUserRecord } from './x-user-audit';
import { X_SCRIPTS } from './x-dom-scripts';
import { directionWrong, pageProblem, type PageLedgerRow } from './x-page-ledger';
import { censusByManual, X_MANUAL } from './x-manual';
import { orderedByTime } from '@platform/main/web-capability/manual';
import { tapPage } from './x-page-tap';

/** 短指纹(FNV-1a,8 位十六进制)—— 只为在报告里分辨两个长得像的游标,不做安全用途 */
export function shortHash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}

/** ⭐ 一次采集回来的东西 —— 与底座 `HarvestReport` 同形,只取用得上的 */
export type RunHarvest = {
  /**
   * ⚠️ **`status` 要带着** —— 原先这里只声明 `{url, text}`,
   * 底座的 `AcquiredItem` 一直有 `status`,到了这一层就没了。
   * ⭐ 带上它,采集层才能自己判「这条是不是被挡了」。
   *
   * ── ⚠️⚠️ 怎么读面板上那一行(2026-10-06 我读错过)──
   * 面板一行长这样:`429  ViewerBadgeCounts` + `不是 JSON（20 字符，开头：Rate limit exceeded…）`
   * 　· `429` 是**真实 HTTP 状态码**(`XConsole` 画的,非 200 标红)
   * 　· `Rate limit exceeded` 是**那条响应 body 的前几个字符**,
   * 　　由我们自己的 `describePayload` 截出来 —— **不是 X 发来的通知**
   * ⭐ 我把这两样读成一件事,断言「X 在限流、前面七八轮白干」,还建议停手等几小时。
   * 用户一句话证否:「我们肉眼能够在 view 中看到名单滚动,你告诉我限流啦?」
   * ⚠️ 那条 429 是 `ViewerBadgeCounts`(通知角标计数),**不在 `X_PAGE_MATCHERS` 里**;
   * 同一屏 `BlueVerifiedFollowers` 是 **200 / 38.6KB / 20 个用户**,主链路好得很。
   * ⭐ 判据:说「被挡了」之前先问**被挡的是不是我们要的端点**(见 `detectRateLimit`)。
   */
  readonly items: ReadonlyArray<{
    readonly url: string;
    readonly text: string;
    readonly status?: number;
    /**
     * ⭐⭐⭐ **X 发这条请求时用的请求头** —— 2026-10-06 真机逼出来的。
     * ⚠️⚠️ 游标翻页第 1 轮 **HTTP 403**:我们只带了 cookie
     * (`credentials: "include"`),而 X 的 GraphQL 还要
     * `authorization` 与 `x-csrf-token`。
     * ⭐ 旧版的做法是**复用 X 刚发过的那条请求**原样重发 ——
     * 自己拼鉴权那条路本仓早就否决过(token 会过期、随版本变)。
     */
    readonly requestHeaders?: Readonly<Record<string, string>>;
  }>;
  readonly afterRound?: readonly unknown[];
  readonly rounds?: number;
  readonly scrolledPx?: number;
  readonly reachedBottom?: boolean;
  readonly stopReason?: string;
  /** ⭐⭐ 对账(底座 HarvestReport 同名字段):浏览器收到几次目标数据 / 采到几页 */
  readonly completeness?: { readonly seen: number; readonly captured: number };
  readonly problems?: readonly string[];
};

/**
 * ⭐ 外部动作 —— ⚠️ 全部注入,本模块一个都不自己实现。
 */
export type RunDeps = {
  /** 采当前页(或先去某页再采) */
  harvest(plan: {
    wantPages?: number;
    pageUrlIncludes?: readonly string[];
    noisyUrlSubstrings?: readonly string[];
    afterRoundScriptId?: string;
    /** ⭐ 滚不动时换位置的脚本 —— 虚拟列表的抢救动作 */
    onStuckScriptId?: string;
    maxRounds?: number;
    /** ⭐ 时间安全网 —— 不给的话底座默认 180s(名单多的号不够用) */
    maxMs?: number;
    gotoPage?: { name: string; params?: Record<string, string> };
  }): Promise<RunHarvest | null>;
  /**
   * ⭐⭐ 跑一个**带参数**的预注册脚本(翻页用)。
   * ⚠️ 可选 —— 不给就不主动翻页(老调用方行为不变)。
   */
  runScript?(scriptId: string, params: Record<string, unknown>): Promise<unknown>;
  /**
   * ⭐⭐⭐ **还翻不翻** —— 业务的研判,采集层不替它决定。
   * ⚠️ 不给就一直翻到 X 不给为止(没游标 / 游标不变),只有安全网兜底。
   */
  stopPaging?(state: PagingState): PagingDecision;
  /**
   * ⭐⭐⭐ **人点了「停止」吗** —— 2026-10-04 用户:
   * 「停止按钮不起作用的,怎么点击停止也不停止?」
   *
   * ⚠️⚠️ 真因:「停止」发的是底座的 `scrollStop`,它只能停**滚动**。
   * 而一跑有三段,后两段是本模块自己的循环:
   * 　① 首轮 harvest(滚动)—— scrollStop 停得了
   * 　② 主动翻页循环 —— **听不见**
   * 　③ 逐篇补长文循环 —— **听不见**
   * 人点停止时多半正在 ②③,所以「点了没反应」。
   *
   * ⭐ 长流程的每一段都要能叫停,否则「停止」就是个摆设。
   */
  cancelled?(): boolean;
  /**
   * ⭐⭐ 回到指定 URL —— 逐篇补完之后用。
   * ⚠️ 可选:没提供就不回(老调用方行为不变),但那样下一轮会从错的页开始。
   */
  goBack?(): Promise<boolean>;
  /** ⭐ 每做完一步报一次 —— 长流程必须让人看见进度 */
  onProgress?(msg: string): void;
  /**
   * ⭐⭐ **等一会儿** —— 被限流(429)时退避重试用。
   * ⚠️ 注入进来是为了**测试跑得动**:真用 `setTimeout` 的话,
   * 一条退避测试就要等好几秒,没人会愿意跑。
   */
  wait?(ms: number): Promise<void>;
  /**
   * ⭐⭐⭐ **一页一存、存完回读**(2026-10-16,逐页账)——
   * 用户:「A页是多少条,落库多少条,对不上问题在哪里,直接就可以敲定了,一页数据不完整,再往下翻页又有什么意义呢?」
   * 存这一页解出的推文 / 人,然后**回读**:返回库里**查得到**的 id(推文 tweet_id / 人 rest_id)。
   * ⚠️ 可选 —— 不给就只对到解析层(逐页账里「入库」显示 —)。
   */
  savePage?(p: { readonly page: number; readonly tweets: readonly TweetRecord[]; readonly users: readonly XUserRecord[] }):
    Promise<{ readonly inDb: readonly string[] } | { readonly error: string }>;
};

export type RunResult = {
  readonly audits: readonly TimelineAudit[];
  /**
   * ⭐⭐ **整轮**的响应总数(列表页 + 逐篇长文页)。
   *
   * ⚠️⚠️ 不能用 `harvest.items.length` 当这个数:那只是**第一趟**的。
   * 真机 2026-10-04 的报告因此写出「收到 **20** 条响应,其中 **64** 条是
   * 时间线载荷」—— 64 > 20,一眼假。两个数来自不同的跑,却摆在一句话里。
   */
  readonly totalResponses: number;
  readonly summary: ReturnType<typeof summarizeAudits> | null;
  readonly harvest: RunHarvest | null;
  /** ⭐⭐ 研判与执行的账 —— 三类分开,不许混 */
  readonly plan: {
    readonly depth: FetchDepth;
    readonly todo: readonly TweetNeed[];
    readonly skipped: readonly TweetNeed[];
    readonly impossible: readonly TweetNeed[];
  } | null;
  /**
   * ⭐⭐⭐ **翻页的账** —— 2026-10-05 补。
   *
   * ⚠️⚠️ 上一跑翻了 47 轮(填的 50),**没到上限**,
   * 所以是三道数据判据之一停的 —— 而我**读不出是哪一道**:
   * 三句停止原因都只走 `say()`,只进面板进度条,**不落盘**。
   * ⭐ 正是刚验过的那条教训(落库留痕救了一跑),我在翻页这边又漏了一处。
   */
  readonly paging: {
    readonly rounds: number;
    /** ⭐ 哪道闸停的 —— 没游标 / 游标不变 / 业务判定 / 跑满安全网 */
    readonly stopReason: string;
    /** ⚠️ 47 轮只换 40 条新推 = 每页高度重复,这个数要能读出来 */
    readonly freshTotal: number;
    /**
     * ⭐⭐⭐ **每一轮发出去的游标和换回来的东西** —— 2026-10-05 补。
     *
     * ⚠️⚠️ 真机:翻 16 轮只多 20 个人,而我**读不出每轮发的游标是什么** ——
     * 「游标没变所以 X 回同一批」和「游标变了但 X 还是回同一批」
     * 是**完全不同的两个毛病**(前者是我的 bug,后者要去查请求形状),
     * 光看总数分不出来,只能猜。⭐ 把它记下来,下一跑自己说得清。
     * ⚠️ 游标很长,只留前后各 12 个字符 —— 够判「变没变」,不占地方。
     */
    readonly rounds_detail: ReadonlyArray<{
      readonly round: number;
      /** 发出去的游标(掐头去尾) */
      readonly cursor: string;
      /** 这一轮**新**收到几个(推文+用户) */
      readonly fresh: number;
      /** 这一轮收到几条响应 */
      readonly responses: number;
      /** ⭐ true = 脚本直接回了 body(主路);false = 走 harvest 兜底 */
      readonly viaBody?: boolean;
    }>;
    /**
     * ⭐⭐⭐ **逐页账**(2026-10-16)—— 每页:X 列了什么 / 解出没有 / 库里有没有 / 方向对不对。
     * 种子页记 page 0。一页对不上会重采一次,还不对就停在这页(停因写清是哪一层)。
     */
    readonly ledger?: readonly PageLedgerRow[];
  } | null;
  /** ⭐ 逐篇补正文的结果 —— 成/败都记 */
  readonly fetched: ReadonlyArray<{
    readonly id: string;
    readonly url: string;
    readonly ok: boolean;
    readonly textLen?: number;
    readonly why?: string;
  }>;
  /**
   * ⭐⭐⭐ **同一次采集里顺带解出来的 X 用户** —— 2026-10-05。
   *
   * 用户订正:「不管采什么,都是采集页面的内容…**输出要自行判断**。」
   * ⚠️⚠️ 在这之前,`auditsOf` 用 `carriesTweets` 一筛,
   * followers/following 的响应就**整个被丢掉、不留痕** ——
   * 而那些响应明明已经采回来了。于是我加了第二个按钮让人去选,
   * 等于**把数据里本来就有的信息,变成人要记住的事**。
   * ⭐ 现在:响应里有什么就产出什么,`kind` 由数据算。
   */
  readonly users: readonly XUserAudit[];
  /** ⭐ 这一跑**到底采到了什么** —— tweets / users / mixed / empty,由数据算 */
  readonly kind: PayloadKind;
  /**
   * ⭐⭐⭐ **被 X 限流了** —— 有话说,没限流就是 undefined。
   *
   * ⚠️⚠️ 限流下的「滚到底」是**假的**:内容没加载出来,不是没有内容。
   * 不把这件事单独喊出来,人(和我)就会去查滚动逻辑 ——
   * 真机已经栽过:响应数 132→9→6→4 一路掉,我却改了七八轮滚动/翻页/游标。
   * ⭐ 单独一个字段,不混进 `problems` 那一堆里 —— 它决定的是
   * 「**现在该停手等一等**」,不是「哪个字段没解出来」。
   */
  readonly rateLimit?: string;
  /**
   * ⭐⭐⭐ **停下来时手里那个游标** —— 断点续采靠它(2026-10-07)。
   *
   * ⚠️ 无论是被 429 挡下、人点停、还是翻够了,都要带出来 ——
   * **被挡那次正是最需要它的一次**:不带的话下次从第 1 页开始,
   * 50 次配额全浪费在重采已入库的人上。
   * ⭐ `undefined` = 没有可续的(X 说到头了 / 压根没翻页)。
   */
  readonly nextCursor?: string;
  /** ⭐ X 说过「到头了」没有 —— 到头后下次该**从头采**(拿新增),不是续 */
  readonly exhausted?: boolean;
};

/** ⚠️ 补全有上限 —— 安全网,不是目标(`feedback-pdca-close-the-loop`) */
const MAX_ARTICLE_FETCH = 50;
/**
 * ⚠️ 再判几轮的**上限** —— 安全网不是目标。
 * ⭐ 正常情况 2~3 轮就没新的了(停止由数据判据定);
 * 这个数只防「每篇都带出新的」那种病态情况把一轮跑无限拖下去。
 */
const MAX_PASSES = 5;
/**
 * ⭐⭐ **第一趟滚动只要这么多页** —— 它只为抄一条请求模板。
 * ⚠️ 旧版实测:滚动拿 7.7%,游标翻页快几十倍。滚多了纯属浪费。
 */
const SEED_PAGES = 2;
/**
 * ⭐⭐ **被限流后最多退避重试几次**(用户 2026-10-07 定)。
 *
 * ⚠️⚠️ 原先是「4 次翻倍:30s/60s/120s/240s」,实测**三跑全部退避到底仍被挡** ——
 * 加起来才 7.5 分钟,而 X 的窗口恢复要更久。
 * ⭐ 也就是说那套退避**注定失败**:它的意义是「等到恢复」,
 * 等不到就是纯浪费 7.5 分钟,然后照样停。
 *
 * ⭐⭐ 用户的方案:**一次等够**。实测人工等十几分钟再点就能接着采,
 * 所以 15 分钟是有据的,不是拍脑袋。
 * ⚠️ 只试 2 次(共 30 分钟):再多就该让人来决定,
 * 而不是程序干等半小时 —— 反正**断点在**,下次点一下就从那儿续。
 */
const MAX_429_RETRY = 2;
/**
 * ⭐ 退避时长 —— **15 分钟起**(用户定),第二次 30 分钟。
 * ⚠️ 不是翻倍到几小时:断点续采已经兜住了,
 * 等太久不如把控制权交回给人。
 */
const RATE_LIMIT_BASE_MS = 15 * 60_000;
/**
 * ⭐⭐⭐ **每轮之间的随机停顿** —— 旧代码实测值 1800~3300ms。
 * ⚠️ 旧注释原话:「**匀速请求是风控最容易识别的特征**」——
 * 所以是**随机**区间不是定值,定值本身也是指纹。
 */
const PAGE_GAP_MIN_MS = 1_800;
const PAGE_GAP_JITTER_MS = 1_500;
/**
 * ⭐⭐ 每翻这么多页主动歇一次 —— 实测 `Followers` 两跑都卡在 48/49 轮,
 * 所以批次要明显小于它。
 */
const BATCH_ROUNDS = 30;
/** ⭐ 批间停顿 —— 记忆里旧实现是「2000 人歇 20s」,这里每 30 轮(≈1500 人)歇 20s */
const BATCH_PAUSE_MS = 20_000;

/**
 * ⭐⭐⭐ **这一趟是不是被限流了** —— 2026-10-06。
 *
 * ⚠️ 判据就是 HTTP 状态码,**不猜**:429 = Too Many Requests。
 * ⭐ 连同「哪些端点被挡」一起报出来 —— 只说「被限流了」人还得去翻日志。
 * ⚠️ 返回 `undefined` 表示没限流,**不要返回空字符串**:
 * 调用方会用 `if (rateLimit)` 判,空串与 undefined 行为一样但语义含糊。
 */
function detectRateLimit(rep: RunHarvest): string | undefined {
  /**
   * ⚠️⚠️ **只看我们要的那些端点** —— 2026-10-06 订正。
   *
   * 我第一版把**任何** 429 都当成「X 在限流」,据此断言「前面七八轮白干」。
   * 用户一句话点破:「我们肉眼能够在 view 中看到名单滚动,你告诉我限流啦?」
   * ——**他是对的**。那条 429 是 `ViewerBadgeCounts`(通知角标计数),
   * 根本不在 `X_PAGE_MATCHERS` 里;同一屏 `BlueVerifiedFollowers`
   * 是 **200 / 38.6KB / 20 个用户**,主链路好得很。
   * ⭐ 教训:判据要缩到**我们真正依赖的东西**,拿无关端点的失败
   * 论证主链路被挡 = 制造假线索,还把人指向「等几小时」这种最浪费的方向。
   */
  const blocked = rep.items.filter(
    (it) => it.status === 429 && (carriesTweets(it.url) || carriesUsers(it.url)),
  );
  if (blocked.length === 0) return undefined;
  /** ⭐ 端点名去重 —— 同一个端点被挡 20 次,说一次就够 */
  const ops = [...new Set(blocked.map(
    (it) => it.url.split('?')[0].split('/').filter(Boolean).pop() ?? it.url,
  ))];
  return `⚠️ X 正在限流(HTTP 429):${blocked.length} 条响应被挡`
    + `（${ops.slice(0, 5).join(' / ')}）`
    + ' —— 这时候的「滚到底」是假的:内容没加载出来,不是没有内容。'
    + ' ⭐ 该做的是**歇一会儿再采**,不是改采集逻辑。';
}

/** ⭐ 从一次 harvest 的响应里解析出核对结果 */
function auditsOf(rep: RunHarvest): TimelineAudit[] {
  /** ⭐ 每轮展开的全文 —— 按「**只许变长**」合并 */
  const merged = new Map<string, string>();
  for (const one of rep.afterRound ?? []) {
    const tweets = (one as { tweets?: Array<{ id: string; text: string }> }).tweets ?? [];
    for (const t of tweets) {
      const prev = merged.get(t.id);
      if (!prev || t.text.length > prev.length) merged.set(t.id, t.text);
    }
  }
  const domList = [...merged.entries()].map(([id, text]) => ({ id, text }));
  return rep.items
    /**
     * ⚠️⚠️ 用 `carriesTweets` **不是** `isTimelineOp`:
     * 补回来的长文走 `TweetResultByRestId` —— 它**带推文但不算一页**。
     * 只用 `isTimelineOp` 筛会把补回来的 38 篇整个筛掉,
     * 跑完 38 趟一条都不进账。**是测试逼出来的,不是我想到的**。
     */
    .filter((it) => carriesTweets(it.url))
    .map((it) => auditTimelinePayload(it.text))
    .map((a) => mergeExpandedText(a, domList));
}

/**
 * ⚠️ 翻页**兜底**轮次 —— 只在调用方没给 `stopPaging` 时用。
 *
 * ⚠️⚠️ 它**不是**「采多少算够」的判据 —— 那是编排的事(见 `PagingDecision`)。
 * 这里只防「X 一直给新游标、程序永远转下去」那种病态情况。
 */
const PAGING_SAFETY_ROUNDS = 200;
/**
 * ⭐⭐⭐ **翻到第几页该不该继续** —— 由**调用方**答,不由采集层答。
 *
 * ── 用户 2026-10-04 定的分界(原话)──
 * 「判断是否停下来是由**业务编排时的研判逻辑**来定,
 * 　而不是你在**采集**中定下来。」
 *
 * ⭐ 采集层只回答一件事:**X 还给不给**(没游标 / 游标不变)。
 * 「够了没有」「值不值得再翻」是业务的判断 —— 不同配方答案不同:
 * 盯人可能要翻到底,热点扫一眼就够。
 *
 * ⚠️⚠️ 我在这上面连栽两次,**两次都是把业务判断写死进采集**:
 * ① `EMPTY_ROUNDS_TO_STOP = 3` —— 连 3 轮没新推就停。
 * 　 真机对照实验证否:窄配方 43 条 / 宽配方 42 条(查询放宽十几倍结果一样),
 * 　 而 **4/4 页都有游标** —— 是刹车踩早了。
 * 　 `project-x-cursor-paging` 早写过:当年这条把 2604 账号卡死在 2244。
 * ② 然后我「改成 12」—— **还是同一个错误**,只是换了个数。
 */
export type PagingDecision = {
  /** ⭐ 还要不要翻下一页 */
  readonly go: boolean;
  /** ⚠️ 不翻了的话**说清为什么** —— 报告要印得出来 */
  readonly why?: string;
};

/** ⭐ 翻完一页之后问调用方:继续吗 */
export type PagingState = {
  /** 已经翻了几轮 */
  readonly round: number;
  /** 到目前为止一共多少条**不重复**推文 */
  readonly uniqueTweets: number;
  /**
   * ⭐⭐ **到目前为止解出多少不重复的人** —— 2026-10-06 加。
   * ⚠️ `uniqueTweets` 这个名字是历史遗留,它数的其实是「推文 + 人」的总和,
   * 拿它当「人数」用会偏大。业务要按人数收手,就得有个**名副其实**的数。
   */
  readonly uniqueUsers: number;
  /** 这一轮**新增**了几条(0 = 这一页全是见过的) */
  readonly freshThisRound: number;
  /**
   * ⭐ 这一轮翻回来的推文记录(2026-10-10 加)—— 业务按**时间**收手要看它
   * (运营人卡「采一个月」:这一页他自己的推文都早于一个月前就停)。
   * ⚠️ 只给这一轮的,不给累计的:累计里有首页的置顶推文,拿它判时间第一页就会停。
   */
  readonly roundRecords: readonly TweetRecord[];
  /** ⚠️ 连续多少轮没有新的 —— 业务要用它定自己的刹车 */
  readonly emptyRounds: number;
};

/** 这一页里 X 的目标载荷(推文 / 名单)—— 逐页账只清点这些 */
function targetItems(one: RunHarvest): RunHarvest['items'] {
  return one.items.filter((it) => carriesTweets(it.url) || carriesUsers(it.url));
}

/**
 * 这一页是不是**按时间倒序**的 —— 只有这种页判翻页方向才有意义。
 * ⚠️ 首页推荐流(HomeTimeline)、搜索「热门」(product=Top)、推文详情不是按时间排的,判了会误报。
 */
export function isChronological(url: string): boolean {
  /** ⭐ P2(2026-10-19):哪些页按时间排挪进说明书 data.orderedByTime */
  return orderedByTime(X_MANUAL.data.orderedByTime, url);
}

/** 这一页推文的发布时间(去掉置顶)—— 判翻页方向 */
export function pageTimes(got: readonly TimelineAudit[]): number[] {
  return got.flatMap((a) => a.items)
    .filter((t) => t.record.pinned !== true && t.record.createdAt)
    .map((t) => Date.parse(t.record.createdAt as string))
    .filter((n) => !Number.isNaN(n));
}

/**
 * ⭐⭐⭐ 给一页记账:清点 X 列的 → 逐条核对解出 → (有 savePage 就)存并回读 → 判方向。
 * 纯编排,不翻页不重试 —— 重试由调用方决定(一页对不上重采一次,还不对就停)。
 */
export async function ledgerFor(
  deps: RunDeps, page: number, label: string, one: RunHarvest,
  got: readonly TimelineAudit[], prevNewestMs: number | undefined,
  cursorBrief: string | undefined, retried: boolean,
): Promise<PageLedgerRow> {
  const tweetIds = new Set<string>(); const userIds = new Set<string>(); const promoted = new Set<string>();
  let tombstones = 0; const other: Record<string, number> = {};
  let nextCursor: string | undefined;
  const targets = targetItems(one);
  tapPage({ page, label, items: targets.map((it) => ({ url: it.url, status: it.status, text: it.text })) });
  const manualDiffs: string[] = [];
  for (const it of targets) {
    /**
     * ⭐⭐ 照说明书清点(P2 2026-10-19 切换)。切换前:基线样本 20 份 + 随机 1 万份与旧 censusPage 逐条一致,
     * 真机并跑两轮(搜索 4 页 / 转发 3 页)报告「逐页与旧账一致」。
     */
    const c = censusByManual(it.text);
    if (!c) { other['非JSON响应'] = (other['非JSON响应'] ?? 0) + 1; continue; }
    c.tweetIds.forEach((x) => tweetIds.add(x)); c.userIds.forEach((x) => userIds.add(x));
    c.promotedIds.forEach((x) => promoted.add(x)); tombstones += c.tombstones;
    for (const [k, n] of Object.entries(c.other)) other[k] = (other[k] ?? 0) + n;
    if (c.cursors.bottom) nextCursor = c.cursors.bottom;
    /** 说明书算的「往下」游标 vs 翻页实际用的(nextPageCursorOf,说明书外登记过)—— 逐份比,只比推文载荷 */
    if (carriesTweets(it.url)) {
      const used = nextPageCursorOf(JSON.parse(it.text));
      const down = c.cursors.bottom ?? '';
      if (used !== down) manualDiffs.push(`游标:说明书 down ${down ? `#${shortHash(down)}` : '(无)'} / 翻页用 ${used ? `#${shortHash(used)}` : '(无)'}`);
    }
  }
  if (manualDiffs.length > 0) {
    console.warn(`[x.manual] 第 ${page} 页(${label})说明书的往下游标与翻页所用不一致:${manualDiffs.join(';')}`);
  }
  /**
   * ⚠️ 推文页里夹着的人(推荐关注之类的卡片)不是这一页采的对象 —— 单独计数,不进对账;
   * 只有**名单页**(一条推文都没有)才对人。用户:「如果采人,就查找人,如果采推文,就查找推文」
   */
  const isTweetPage = tweetIds.size > 0;
  if (isTweetPage && userIds.size > 0) { other['推荐的人'] = userIds.size; userIds.clear(); }
  const users = isTweetPage ? [] : dispatchPayloads(one.items).users.flatMap((a) => a.items);
  const tweets = got.flatMap((a) => a.items.map((t) => t.record));
  const parsed = new Set<string>([...tweets.map((t) => t.id), ...users.map((u) => u.restId)].filter((x) => x !== ''));
  const listed = [...tweetIds, ...userIds];
  const notParsed = listed.filter((id) => !parsed.has(id));
  let notInDb: string[] | undefined;
  if (deps.savePage && (tweets.length > 0 || users.length > 0)) {
    const r = await deps.savePage({ page, tweets, users });
    if ('error' in r) {
      notInDb = listed.filter((id) => parsed.has(id));
      other[`存库出错:${r.error.slice(0, 40)}`] = 1;
    } else {
      const inDb = new Set(r.inDb);
      notInDb = listed.filter((id) => parsed.has(id) && !inDb.has(id));
    }
  }
  return {
    page, label, xTweets: tweetIds.size, xUsers: userIds.size, promoted: promoted.size, tombstones, other,
    notParsed, notInDb,
    directionWrong: targetItems(one).some((it) => isChronological(it.url)) && directionWrong(prevNewestMs, pageTimes(got)),
    cursor: cursorBrief,
    nextCursor: nextCursor ? `${nextCursor.slice(0, 6)}…#${shortHash(nextCursor)}` : undefined,
    retried,
    manualDiff: manualDiffs.length > 0 ? manualDiffs.join(';') : undefined,
  };
}

/**
 * ⭐⭐⭐ **拿游标一直翻到没有为止**。
 *
 * ⚠️ 停止判据全部来自**数据**,不是猜的次数:
 * ① 没有新游标 → X 说到头了
 * ② 游标和上一轮一样 → 翻不动了(防死循环)
 * ③ 这一轮没解出新推文 → 请求发了但没回数据
 * ⭐ `MAX_PAGE_ROUNDS` 只在以上三条都没触发时兜底。
 *
 * ⭐ 实现上**复用 `harvest`**:发完请求用一次零滚动的 harvest 把响应收回来。
 * ⚠️ 不新开 `peekAcquire`/`wait` 这些 dep —— 那会让这一层多认识底座两件事。
 */
async function pageUntilDone(
  deps: RunDeps,
  audits: readonly TimelineAudit[],
  rep: RunHarvest,
  say: (m: string) => void,
  /**
   * ⭐⭐ 每翻完一页回调一次 —— **给整份 harvest 不只给条数**。
   * ⚠️ 原先只传 `items.length`(为了累计响应数),于是翻页拿回来的
   * **用户响应在这一层就蒸发了**:第 2 页之后的人一个都收不到。
   * ⭐ 传整份出去,「这一页里有什么」由外面那层决定怎么用。
   */
  onRound: (rep: RunHarvest) => void,
  /**
   * ⭐⭐⭐ **从这个游标接着翻** —— 断点续采。
   * ⚠️ 不给就用种子那一页的游标(从头采)。
   */
  resumeCursor?: string,
  /** ⭐ 逐页账(种子页已记在里面)—— 翻页每页往里追加 */
  ledger: PageLedgerRow[] = [],
  /** ⭐ 种子页里最新一条推文的时间 —— 第 1 页判方向用 */
  seedNewestMs?: number,
): Promise<{
  audits: TimelineAudit[];
  paging: NonNullable<RunResult['paging']>;
  /** ⭐ 停下来时手里那个游标 —— 下次从这里续 */
  nextCursor?: string;
  exhausted: boolean;
}> {
  const all = [...audits];
  /** ⭐ 停止原因**要带出去**,不能只 say() —— say 的东西关掉就没了 */
  let stopReason = '跑满安全网（未触发任何数据判据）';
  /**
   * ⭐ 翻页要用**页面自己发过的那条请求** —— queryId 与 features 都在里面,
   * 推不出来也不该写死(随 X 版本变)。
   */
  /**
   * ⚠️⚠️ 2026-10-05 放宽:原先只认**推文**的请求当种子,
   * 于是 followers 页「有游标、X 说还有」却一页都翻不动 ——
   * 又是那个「采集只认推文」的旧假设。
   * ⭐ 用户名单的请求同样带 queryId 与 features,一样能当种子。
   */
  const seedCandidates = rep.items.filter(
    (it) => (carriesTweets(it.url) || carriesUsers(it.url)) && it.url.includes('variables='),
  );
  /**
   * ⭐⭐⭐ **种子必须带着请求头,否则老实说没有** —— 2026-10-13,403 根治。
   *
   * ── ⚠️⚠️ 推翻旧注释:请求头来源搞反过 ──
   * 旧注释写「请求头只有 CDP 腿拿得到,钩子腿看不见」—— **完全反了**(2026-10-13
   * 真机日志证实)。真相:请求头**只有 webRequest 腿**(`onSendHeaders`)拿得到,
   * CDP 腿登记的 record 从不带头。X 进页面时 `UserRepliesTimeline` 等有时是
   * service worker / keepalive 发的 → 没有 `webContentsId` → webRequest 腿丢弃
   * → 那条 record **永远 0 头** → 种子撞上它重发必 **403**。
   * ⭐ 底层已修(`body-provider` 让 CDP 也补头),所以现在种子**应当**都有头;
   *   但这里**不再兜底**:万一又出现无头种子,老实失败由上层重试/留痕接手,
   *   绝不拿一个「必死」的种子去撞 —— 那是「退而求其次地保证 403」,
   *   正是 `feedback-fail-loud-no-fallback` 禁的静默兜底。
   */
  const seed = seedCandidates.find(
    (it) => Object.keys(it.requestHeaders ?? {}).length > 0,
  );
  if (seed === undefined) {
    const why = seedCandidates.length > 0
      ? `有 ${seedCandidates.length} 条翻页请求但都没带鉴权头 —— 不拿必 403 的种子去撞`
      : '没有可用来翻页的请求';
    say(`${why} —— 跳过主动翻页`);
    return {
      audits: all,
      paging: { rounds: 0, stopReason: why, freshTotal: 0, rounds_detail: [], ledger },
      /** ⚠️ 没有带头的种子,谈不上续采 */
      nextCursor: undefined,
      exhausted: false,
    };
  }

  /**
   * ⭐⭐ **这一页解出来的用户 handle** —— 判新鲜度用。
   * ⚠️ 这一层不存用户记录(那是外面那层的事,它要连续的 seq),
   * 只要「有没有没见过的人」这一个事实。
   */
  const usersOfRep = (r: RunHarvest): string[] =>
    dispatchPayloads(r.items).users.flatMap((a) => a.items.map((u) => u.handle.toLowerCase()))
      .filter((h) => h !== '');

  /** ⭐ 最近一份用户账给的游标 —— followers 页靠它翻页 */
  /**
   * ⭐ 首轮的游标 —— 滚动会采回几十条响应,这里同样**不能闭眼取最后一条**。
   * ⚠️ 取最靠后的那个非空游标即可(首轮 `seenCursors` 还是空的,
   * 没有「见过没见过」可挑);真正的挑选逻辑在循环里。
   */
  let lastUserCursor: string | undefined = (() => {
    /**
     * ⭐⭐⭐ **有断点就从断点开始** —— 2026-10-07。
     * ⚠️ 种子那一页给的永远是**第 1 页**的游标(X 每次都从头给),
     * 拿它续采等于重走已经走过的 48 轮,配额全浪费。
     */
    if (resumeCursor !== undefined && resumeCursor !== '') return resumeCursor;
    const cs = dispatchPayloads(rep.items).users
      .map((a) => a.cursor)
      .filter((c): c is string => c !== undefined && c !== '');
    return cs.length > 0 ? cs[cs.length - 1] : undefined;
  })();

  /** ⭐ 每轮的账 —— 见 `rounds_detail` 的注释 */
  const roundsDetail: Array<{
    round: number; cursor: string; fresh: number; responses: number; viaBody?: boolean;
  }> = [];

  /**
   * ⭐⭐⭐ **X 说「到头了」** —— `TimelineTerminateTimeline`。
   *
   * ⚠️⚠️ 真机 2026-10-06:第 3 轮 X 回了它、外加游标 `0|...`(A 段为 0 = 边界),
   * **明说没有了**;可翻页又空转了 7 轮,游标 A 段冻住、只有 B 段(时间戳)
   * 匀速递增 —— 拿着同一个位置反复问「下一页呢」。
   * ⭐ 解析器**早就解出了 `terminated`**,而这里从来没读过它:
   * 那条检查原本在 `x-user-run` 里,合并成单入口时**丢了**。
   * ⚠️ `feedback-grep-shared-edge-before-delete` 的反面:删文件前我 grep 的是
   * 「谁 import 它」,而不是「**它做了什么别处没有的事**」。
   *
   * ⚠️ 注意:X 翻到底**仍然附带游标**,所以光看游标永远判不出来。
   */
  /**
   * ⭐⭐⭐ **「到头了」要按「我们要用的那一页」判** —— 2026-10-06 真机。
   *
   * ⚠️⚠️ 原先用 `.some()` 扫**种子里所有**用户载荷:种子一趟会收到好几条
   * (真机截图里两条 `BlueVerifiedFollowers`),其中**最后一页**带 terminate
   * 是正常的,而第一页的游标还活着 —— 一条「到头了」就把整轮**毒死在第 0 轮**,
   * 停因还理直气壮写着「X 说名单到头了」。
   *
   * ⭐ 正确判据:**带着我们要用的那个游标的那一页**说没说到头。
   * 种子里**有游标**就说明还能翻;没有任何游标才是真到头。
   * ⚠️ 翻页开始后每一轮只看**那一轮回来的那一页**(见循环末尾)。
   */
  const seedUsers = dispatchPayloads(rep.items).users;
  let terminated = seedUsers.length > 0
    && seedUsers.every((a) => a.terminated || a.cursor === undefined || a.cursor === '');

  const seenCursors = new Set<string>();
  /**
   * ⭐ 已经见过的**东西** —— 判「这一轮有没有收到新的」靠它。
   * ⚠️ 推文记 `t:<id>`、用户记 `u:<handle>`,**加前缀避免撞键**。
   */
  const seenKeys = new Set<string>();
  for (const a of all) for (const t of a.items) if (t.id) seenKeys.add(`t:${t.id}`);
  for (const u of usersOfRep(rep)) seenKeys.add(`u:${u}`);
  /** ⭐ 翻页**开始前**已有多少 —— 用来算「翻页带来了多少新的」 */
  const seedCount = seenKeys.size;
  let emptyRounds = 0;
  let round = 0;
  /** ⭐ 429 退避试了几次 —— 超过上限才真停 */
  let rateLimitRetries = 0;
  /** ⭐ 逐页账:上一页最新推文时间(判方向)/ 这个游标是不是已经重采过一次 */
  let prevNewestMs = seedNewestMs;
  let retriedCursor: string | undefined;
  while (round < PAGING_SAFETY_ROUNDS) {
    /** ⭐ 每轮开头先看人有没有喊停 —— 停在轮次之间,已采到的都留着 */
    if (deps.cancelled?.()) {
      stopReason = '人点了停止';
      say(`已停止（翻了 ${round} 轮）`); break;
    }
    /**
     * ⭐⭐⭐ X 明说到头了就停 —— 别再拿同一个位置空转。
     * ⚠️ 放在游标检查**之前**:它比游标可信(游标到底了还给)。
     */
    if (terminated) {
      stopReason = 'X 说名单到头了（TimelineTerminateTimeline）';
      say(`翻页结束：${stopReason}（共 ${round} 轮）`); break;
    }
    /**
     * ⭐⭐⭐ **断点续采:第一轮且有断点 → 从断点续,不用首页游标** —— 2026-10-13 (3b)。
     *
     * ⚠️⚠️ 这是推文页续采的要害。否则:`all` 第一轮已含种子页(首页),
     * 首页就带推文游标 → 下面的 `find` 命中首页游标 → 传入的 resumeCursor 被忽略,
     * 后台分段每段都从头重采(KNOWN_DEBT,3a 钉过)。
     * ⭐ 只在**第一轮**(round===0,此时尚未 +1)用断点;之后用翻回来的游标。
     * ⚠️ 名单页不受影响:名单页的 resumeCursor 本就经 lastUserCursor 初始化(见上),
     * 这里把「首轮优先 resumeCursor」显式提前,对名单页是等价强化、对推文页才是修复。
     */
    const resumeThisRound = round === 0 && resumeCursor !== undefined && resumeCursor !== '';
    const cursor = resumeThisRound
      ? resumeCursor
      : (
        /**
         * ⭐ 游标取**最新那一份账**里的,不是第一页的。
         * ⚠️ 推文账和用户账**都带游标** —— 只看推文账的话,
         * followers 页永远拿不到游标、第一轮就停(实测过)。
         */
        [...all].reverse()
          .map((a) => a.cursor)
          .find((c) => c !== undefined && c !== '')
        /**
         * ⭐⭐ 推文账里没有游标时,**问用户账要** ——
         * followers 页的游标只在用户载荷里(实测:只看推文账则恒为 undefined,
         * 第一轮就报「X 说到头了」,而 X 一直说还有)。
         */
        ?? lastUserCursor
      );
    if (cursor === undefined) {
      stopReason = '没有下一页游标（X 说到头了）';
      /**
       * ⭐ 没有下一页游标 = 真到头(X 不给了)—— 标 exhausted。2026-10-13 (3b)。
       * ⚠️ 推文页靠这一条判到头(它没有用户账,`terminated` 那套名单判据够不着它);
       * 不标的话返回 exhausted=false + 一个旧 nextCursor,后台会判成「还能续」无限翻。
       */
      terminated = true;
      say(`翻页结束：${stopReason}（共 ${round} 轮）`); break;
    }
    /** ⚠️ 同一个游标出现两次 = 翻不动了,**立刻停**,别空转 */
    if (seenCursors.has(cursor)) {
      stopReason = '游标不再变化（真的翻不动了）';
      /** ⭐ 翻不动了同样是到头(X 拿同一页糊弄)—— 标 exhausted,别让后台续一个死游标 */
      terminated = true;
      say(`翻页结束：${stopReason}（共 ${round} 轮）`); break;
    }
    seenCursors.add(cursor);

    round += 1;
    /**
     * ⭐⭐⭐ **请求之间要有随机停顿** —— 2026-10-06 真机,用户:
     * 「是的,不能太快,这样会引发限流。」
     *
     * ⚠️⚠️ 旧代码注释里一句话点破:
     * > 「随机停顿:**匀速请求是风控最容易识别的特征**」
     * 而我重建的翻页是**连珠炮**:48 轮一轮接一轮、中间零间隔,
     * 真机后果是 X 把**整个会话**挡掉 —— 连它自己的页面都报
     * `Something went wrong. Try reloading.`(用户截图实证)。
     *
     * ⭐ 停顿要**随机**不要定值:定值本身也是指纹。
     * ⚠️ 第一轮不等(刚从种子过来,本来就有间隔),从第二轮起才等。
     * ⚠️ 等待期间要能叫停 —— `deps.wait` 的实现里每秒看一次停止键。
     */
    if (round > 1 && deps.wait) {
      const jitter = PAGE_GAP_MIN_MS + Math.random() * PAGE_GAP_JITTER_MS;
      await deps.wait(Math.round(jitter));
      if (deps.cancelled?.()) {
        stopReason = '人点了停止';
        say(`已停止（翻了 ${round - 1} 轮）`); break;
      }
    }
    /**
     * ⭐⭐ **每采一批歇一会儿** —— 记忆 project-x-cursor-paging 记着
     * 「自动分批(2000 人歇 20s)」。
     * ⚠️ 连续几十轮之后 X 的容忍度明显下降(followers 两跑都卡在 48/49 轮),
     * 中途主动歇一次,比被挡了再退避划算。
     */
    if (round > 1 && round % BATCH_ROUNDS === 0 && deps.wait) {
      say(`已翻 ${round} 页 —— 歇 ${Math.round(BATCH_PAUSE_MS / 1000)}s 再继续（避开限流）`);
      await deps.wait(BATCH_PAUSE_MS);
      if (deps.cancelled?.()) {
        stopReason = '人点了停止';
        say(`已停止（翻了 ${round - 1} 轮）`); break;
      }
    }
    say(`主动翻页 第 ${round} 页…`);
    /**
     * ⭐ 掐头去尾 + 短指纹 —— 不占地方,又判得出「变没变」。
     * ⚠️ 2026-10-16:只掐头去尾时,X 搜索游标头尾都一样、只有中间不同 →
     * 报告误报「有重复的游标 → 我们这边的 bug」,把排查指错方向。指纹按整串算。
     */
    const cursorBrief = cursor.length > 28
      ? `${cursor.slice(0, 12)}…${cursor.slice(-12)}#${shortHash(cursor)}` : cursor;

    /**
     * ⭐⭐⭐ **发一页 → 当场拿到这一页** —— 2026-10-06,照旧版的形状改。
     *
     * ⚠️⚠️ 原先是 `runScript` 发请求、再跑**一次 harvest** 去等响应 ——
     * 两步之间隔着异步,harvest 会把**滚动顺带触发的别的响应**也收进来,
     * 于是「这一页给了什么」说不清,只能拿累计表去猜。
     * ⭐ 旧版 `buildRefetchScript` 直接把 body 回传,一页一判一进;
     * 实测 **30 次请求拿 2000+ 人,比滚动快几十倍**。
     *
     * ⚠️ 仍保留 harvest 兜底:脚本回不出 body 时(老构建/被拦),
     * 走老路至少不空转 —— 但**如实记下走的是哪条**,别让两种情况长得一样。
     */
    let one: RunHarvest | null;
    let viaBody = false;
    try {
      const r = await deps.runScript!(X_SCRIPTS.fetchNextPage, {
        url: seed.url,
        cursor,
        /**
         * ⭐⭐ **原样带上 X 自己的请求头** —— 少了 authorization /
         * x-csrf-token 就是 403(真机实证)。
         * ⚠️ 用 seed 那条的头:它就是 X 刚刚成功发过的那一条。
         */
        headers: seed.requestHeaders ?? {},
      }) as {
        ok?: boolean; status?: number; body?: string; why?: string; shape?: string;
      } | null;
      /**
       * ⭐⭐⭐ **被限流就等一会儿再试,别把剩下的全丢了** —— 2026-10-06 真机。
       *
       * ⚠️⚠️ followers 那跑翻到**第 49 轮** 429,而诊断写着
       * `authorization=有，x-csrf-token=有` —— 不是鉴权问题,是真限流。
       * 原先直接 break:2469 人到手,剩下 3000 多人**整批丢掉**,
       * 而 X 只是让我们**慢一点**,不是不给。
       *
       * ⭐ 照本仓已有的那套(`project-x-translate-rate-limited`:
       * 限速 + 指数退避 + 熔断)。这里退避翻倍,最多试 `MAX_429_RETRY` 次;
       * 还不行才停,并**如实说是限流停的**(不是「采完了」)。
       * ⚠️ 退避期间也要能被人叫停 —— 长等待里不响应停止键是最招人烦的。
       */
      if (r?.ok === false && r.status === 429 && deps.wait) {
        if (rateLimitRetries < MAX_429_RETRY) {
          rateLimitRetries += 1;
          const backoff = RATE_LIMIT_BASE_MS * (2 ** (rateLimitRetries - 1));
          /**
           * ⭐⭐ **报分钟不报秒** —— 等 15 分钟写成「900s」人要自己换算。
           * ⚠️ 还要说清**断点在**:否则人会以为「等不起就白采了」,
           * 而实际上随时可以点停、下次从这儿续。
           */
          say(`⚠️ 被 X 限流(429)—— 等 ${Math.round(backoff / 60_000)} 分钟再试`
            + `（第 ${rateLimitRetries}/${MAX_429_RETRY} 次，已采 ${seenKeys.size} 条）`
            + ' —— 断点已记下，等不及就点「停止」，下次从这儿接着采');
          await deps.wait(backoff);
          /** ⭐ 这一轮不算数:游标还没用掉,退回去重来 */
          seenCursors.delete(cursor);
          round -= 1;
          continue;
        }
        stopReason = `被 X 限流(429)，退避 ${MAX_429_RETRY} 次仍被挡`
          + `——**不是采完了**，歇一会儿再跑能接着采`;
        say(stopReason); break;
      }
      if (r?.ok === false) {
        /**
         * ⭐⭐⭐ **失败时把判据一起交出来** —— 2026-10-06,403 查了两轮。
         *
         * ⚠️⚠️ 只说「HTTP 403」时,三种成因**长得一模一样**:
         * 　· 根本没带鉴权头(种子那条压根没记到 requestHeaders)
         * 　· 带了但被浏览器剔掉了(禁设名单误伤)
         * 　· 带全了而 X 仍拒(那才轮到查别的)
         * ⭐ 把**实际发出去的头名**列出来,三种当场分得开。
         * ⚠️ 只记**键名**不记值 —— authorization/csrf 是凭据,不进留痕。
         */
        const sentKeys = Object.keys(seed.requestHeaders ?? {});
        const sawAuth = sentKeys.some((k) => k.toLowerCase() === 'authorization');
        const sawCsrf = sentKeys.some((k) => k.toLowerCase() === 'x-csrf-token');
        /** ⭐ 状态码总要写进去(2026-10-20):节奏自调靠「429」认限流,不能指望 why 的文案里碰巧有 */
        stopReason = `第 ${round} 轮请求失败(HTTP ${r.status ?? '?'})：${r.why ?? '(没给原因)'}`
          + `（种子带了 ${sentKeys.length} 个请求头`
          + `，authorization=${sawAuth ? '有' : '**无**'}`
          + `，x-csrf-token=${sawCsrf ? '有' : '**无**'}）`;
        say(stopReason); break;
      }
      if (typeof r?.body === 'string' && r.body.length > 0) {
        /** ⭐ 这一页的正文当场到手 —— 不再多跑一次 harvest */
        viaBody = true;
        one = { items: [{ url: seed.url, text: r.body, status: r.status ?? 200 }] };
      } else {
        /** ⚠️ 兜底:老路。`viaBody=false` 会进留痕,两条路分得开 */
        one = await deps.harvest({
          wantPages: 1,
          pageUrlIncludes: X_PAGE_MATCHERS,
          noisyUrlSubstrings: X_NOISY_URLS,
          maxRounds: 0,
        });
      }
    } catch (e) {
      /** ⚠️ 翻页失败**不毁整轮** —— 已经采到的还在 */
      stopReason = `第 ${round} 轮失败：${e instanceof Error ? e.message : String(e)}`;
      say(stopReason);
      break;
    }
    if (one === null) {
      stopReason = `第 ${round} 轮没收到响应`;
      say(stopReason); break;
    }

    const got = auditsOf(one);
    /**
     * ⭐⭐⭐ **逐页账:这一页对上了才往下翻**(用户 10-16:「一页数据不完整,再往下翻页又有什么意义呢?」)
     * 清点 X 列的 → 逐条核对解出 → 存并回读 → 判方向。
     * 对不上:同一个游标重采一次;还对不上:停在这一页,停因写清是哪一层。
     */
    const isRetry = retriedCursor === cursor;
    const row = await ledgerFor(deps, round, '翻页', one, got, prevNewestMs, cursorBrief, isRetry);
    const problem = pageProblem(row);
    if (problem !== undefined && !isRetry) {
      say(`⚠️ ${problem} —— 重采这一页`);
      retriedCursor = cursor;
      seenCursors.delete(cursor);
      round -= 1;
      continue;
    }
    ledger.push(row);
    onRound(one);
    const times = pageTimes(got);
    if (times.length > 0) prevNewestMs = Math.max(...times);
    if (problem !== undefined) {
      stopReason = `${problem}(重采后仍对不上 —— 停在这一页,不往下翻)`;
      /** ⭐ 这一页解出的照样收下(已经存了);但不往下翻 */
      all.push(...got);
      say(stopReason); break;
    }
    /**
     * ⭐⭐⭐ 判据是「**有没有没见过的推**」,不是「这一页有几条推」。
     *
     * ⚠️⚠️ 真机 2026-10-04 踩到:原先写 `tweets === 0` 就停,
     * 而 X **每页照样回 15 条、却是同一批**(游标也每轮都给新的)——
     * 于是停止条件**永远到不了**,跑满 40 轮上限,
     * 44 页载荷去重后只剩 **42 条推文**(680 原始 → 42)。
     *
     * ⭐ 又是 `feedback-pdca-close-the-loop` 的「数错元素」:
     * 数了「页里有几条」而不是「新收了几条」,该数恒 > 0 等于没在判。
     * ⚠️ `project-x-cursor-paging` 早记过同族:**「几页没新人」不能当到底** ——
     * 反过来「有人」也不能当还有,要看的是**新不新**。
     */
    const before = seenKeys.size;
    for (const a of got) {
      for (const t of a.items) if (t.id) seenKeys.add(`t:${t.id}`);
    }
    /**
     * ⭐⭐ **用户也算「新东西」** —— 否则 followers 页每轮 fresh 恒为 0,
     * 「这一轮没收到新东西」那道闸会在第一轮就误停。
     * ⚠️ 判据必须是「这一页有没有没见过的」,不是「这一页有几个」
     * (`feedback-pdca-close-the-loop` 的「数错元素」)。
     */
    for (const u of usersOfRep(one)) seenKeys.add(`u:${u}`);
    /** ⭐ 游标跟着往前走,否则第二轮还拿第一轮的 */
    /**
     * ⭐⭐⭐ **取「没见过的」游标,不是「最后一条」** —— 2026-10-06 真机。
     *
     * ⚠️⚠️ 关注 5319 人只采到 236(4.4%),翻页**第 2 轮就停**,
     * 停因「游标不再变化」。真因:一次翻页 harvest 会回**十几条**响应
     * (滚动还在继续产出),而原先取游标用 `.reverse().find(...)`
     * = 数组里最后那条 —— 而**响应到达顺序 ≠ 分页顺序**。
     * 拿到一条靠前的游标发出去,X 就把走过的那一页再给一遍,
     * 游标撞进 `seenCursors` → 判成「翻不动了」→ 停。
     *
     * ⭐ 一页只有 20-50 人,5319 人要翻上百轮;在第 2 轮停下,
     * 面板却报「真的翻不动了」—— 又一个「看着成功实际没有」。
     */
    /**
     * ⚠️⚠️ **推文账游标也要纳入** —— 2026-10-13 (3b)。
     * 原先只取用户账(`.users`)的游标,于是推文页(帖子/回复/转发)翻完一轮
     * `lastUserCursor` 从不更新 → 返回的 `nextCursor` 恒 undefined → 后台分段续不上
     * (KNOWN_DEBT,3a 钉过)。
     * ⭐ 合并推文账 + 用户账的下一页游标,仍沿用「挑没见过的」血泪逻辑
     * (响应到达顺序 ≠ 分页顺序,见上)。名单页行为不变(它只有用户账游标)。
     */
    const ucs = [
      ...got.map((a) => a.cursor),
      ...dispatchPayloads(one.items).users.map((a) => a.cursor),
    ].filter((c): c is string => c !== undefined && c !== '');
    /** ⭐ 优先挑**没用过的**;都用过了才退回最后一条(让「真不动了」仍能判出来) */
    const unseen = ucs.filter((c) => !seenCursors.has(c));
    const uc = unseen.length > 0 ? unseen[unseen.length - 1] : ucs[ucs.length - 1];
    if (uc !== undefined) lastUserCursor = uc;
    /**
     * ⭐ X 这一轮说到头了 → 下一轮开头就停。
     * ⚠️ 判据与种子那里一致:**这一轮回来的页里再没有活游标**才算到头。
     * 走兜底(harvest)时一轮可能收到好几条,其中一条带 terminate 很正常
     * (那是列表末页),不能因此就把整轮判死 —— 真机已经栽过一次。
     */
    const roundUsers = dispatchPayloads(one.items).users;
    if (roundUsers.length > 0
      && roundUsers.every((a) => a.terminated || a.cursor === undefined || a.cursor === '')) {
      terminated = true;
    }
    const fresh = seenKeys.size - before;
    /** ⭐⭐ 每轮落一笔账 —— 下一跑不用再问人、也不用猜 */
    roundsDetail.push({
      round, cursor: cursorBrief, fresh, responses: one.items.length,
      /** ⭐ 这一页是**当场拿到**的还是走兜底 harvest 收的 —— 两条路要分得开 */
      viaBody,
    });
    emptyRounds = fresh === 0 ? emptyRounds + 1 : 0;
    all.push(...got);

    /**
     * ⭐⭐⭐ **问调用方:还翻吗** —— 用户 2026-10-04:
     * 「判断是否停下来是由**业务编排时的研判逻辑**来定,
     * 　而不是你在**采集**中定下来。」
     *
     * ⚠️ 采集层已经把它知道的事实都摆出来了(翻了几轮、共多少条、
     * 这轮新增几条、连续几轮没新的)——**怎么用是业务的事**。
     * ⚠️ 不给 `stopPaging` 就一直翻到 X 不给为止(只有安全网兜底)。
     */
    if (deps.stopPaging) {
      const d = deps.stopPaging({
        round,
        uniqueTweets: seenKeys.size,
        /** ⭐ 只数人:`u:` 前缀的那些(推文记的是 `t:`) */
        uniqueUsers: [...seenKeys].filter((k) => k.startsWith('u:')).length,
        freshThisRound: fresh,
        emptyRounds,
        roundRecords: got.flatMap((a) => a.items.map((i) => i.record)),
      });
      if (!d.go) {
        stopReason = d.why ?? '业务判定够了';
        say(`翻页结束：${stopReason}（共 ${round} 轮）`);
        break;
      }
    }
  }
  /**
   * ⚠️ `freshTotal` 用**新收到的推文条数**,不是 `all.length` ——
   * 后者含首轮滚动采到的那些,混在一起看不出「翻页到底带来了多少」。
   * ⭐ 47 轮只换 40 条新推 = 每页高度重复,这个数就是用来看这个的。
   */
  return {
    audits: all,
    paging: { rounds: round, stopReason, freshTotal: seenKeys.size - seedCount, rounds_detail: roundsDetail, ledger },
    /**
     * ⭐⭐⭐ **把手里那个游标带出去** —— 下次从这里续。
     * ⚠️ X 说到头了就**不带**:那时续采没有意义,下次该从头采拿新增。
     */
    nextCursor: terminated ? undefined : lastUserCursor,
    exhausted: terminated,
  };
}

/**
 * ⭐⭐⭐ 采一页 —— **采集 → 研判 → 按深度补全 → 再核对**。
 *
 * ⚠️ 补全回来的正文会**并回核对结果**,否则报告还是说「缺 38 篇」——
 * 「做了」和「账上记着」是两件事(`feedback-pdca-close-the-loop`:
 * 反复执行的循环必须回读真实产出量)。
 */
export async function runCollect(
  deps: RunDeps,
  opts: {
    wantPages: number; depth: FetchDepth; maxRounds?: number; maxMs?: number;
    /** ⭐ 第一趟滚动采几页就够 —— 只为抄请求模板,默认 `SEED_PAGES` */
    seedPages?: number;
    /**
     * ⭐⭐⭐ **从这个游标接着翻** —— 断点续采(2026-10-07)。
     * ⚠️⚠️ `Followers` 端点约 50 次/窗口就 429,而 X 每次都从**第 1 页**给游标。
     * 不续采的话:翻 1-48 轮全是已入库的人 → 第 49 轮又 429
     * → **整个配额浪费在重采上,一个新人都拿不到**。
     * ⭐ 不给就从头采(首跑、或上次已到头)。
     */
    resumeCursor?: string;
  },
): Promise<RunResult> {
  const say = (m: string): void => deps.onProgress?.(m);

  // ── ① 采 ──
  const rep = await deps.harvest({
    /**
     * ⭐⭐⭐ **第一趟滚动只为拿「请求模板」** —— 2026-10-06 照旧版改。
     *
     * ⚠️⚠️ 旧代码注释里的实测:滚动 30 轮 / 76 秒只拿到 **201/2604 = 7.7%**,
     * 只触发 4 个载荷 —— 时间全花在滚动动画和虚拟列表渲染上;
     * 而游标翻页 **30 次请求就能拿 2000+ 人,快几十倍**。
     * 我却对着滚动改了七八轮(轮次/时间闸/空轮刹车/换位置抢救),
     * 真机 631 轮 448453px 只换来 **23 人**。
     *
     * ⭐ 现在滚动只需滚到**拿得到一条带 `variables` 的请求**为止:
     * 后面全靠游标翻页。`SEED_PAGES` 取 2 —— 1 页就够抄模板,
     * 给 2 页是因为头一条可能是别的端点(ViewerBadgeCounts 之类)。
     * ⚠️ 人填的页数**不再传给滚动**,它是**翻页**的目标(见面板 stopPaging)。
     */
    wantPages: opts.seedPages ?? SEED_PAGES,
    pageUrlIncludes: X_PAGE_MATCHERS,
    noisyUrlSubstrings: X_NOISY_URLS,
    afterRoundScriptId: X_SCRIPTS.expandAll,
    /**
     * ⭐⭐⭐ **滚不动时跳到最后一张卡片** —— 2026-10-06 从历史代码捡回来。
     *
     * 用户 2026-09-19 原话:「如果校验发现没有滚动就往下一个位置去采集数据。
     * 这样才对吧,而不是盲目采集直到出问题都不懂」
     *
     * ⚠️⚠️ X 的名单是**虚拟列表**,滚过去的 DOM 会被删掉 ——
     * 「滚不动」常常不是到底,是新内容还没渲染。历史代码靠这一步
     * 把 250 采成 2781;重建时丢了,真机重现:5319 人只采到 169,
     * 而停因言之凿凿写着「滚到底」。
     */
    onStuckScriptId: X_SCRIPTS.jumpToLastCard,
    /**
     * ⚠️⚠️ **安全网不是目标** —— 2026-10-05 真机:`?? 60` 把 following
     * 卡在 **150 人**(滚 60 轮 42687px 到上限,X 还有一大截没滚到)。
     * ⭐⭐ 这是 `project-x-followers-2500-ceiling` 的**同一个错误**:
     * 所谓「X 天花板 2500」真因就是滚动轮数不够,而那个轮数是人填的 ——
     * 我把**自己设的闸门**当成了平台的限制。那条记忆开头就写着「已作废」,
     * 而我又踩了一次。
     *
     * ⭐ 滚动本来就有**数据判据**(`reachedBottom`:滚不动了就停),
     * 轮数只在它失灵时兜底。2645 人实测约需 130+ 轮,给到 3000
     * 是为了「人多的号也别被我拦住」——
     * 真正该停的是「滚到底了」,不是「我数到 60 了」。
     */
    maxRounds: opts.maxRounds ?? 3000,
    /**
     * ⭐⭐⭐ **时间安全网也是网,不是目标** —— 2026-10-06 真机。
     *
     * ⚠️⚠️ 底座默认 180s,而 following 实跑 221 轮 162571px 正好撞上它,
     * 停在 150 人。⭐ 这是**同一个错误的第三次**:
     * 先是「X 天花板 2500」(真因滚动轮数不够)、
     * 再是 `maxRounds ?? 60`(卡在 150 人)、
     * 现在是 `maxMs` 180s —— 每次都是**我设的闸门被当成了平台的限制**。
     *
     * ⭐ 滚动本来就有数据判据(`reachedBottom`),时间只在它失灵时兜底。
     * 2000+ 人的名单按实测速度要十几分钟,给到 20 分钟。
     * ⚠️ 改的是**X 自己传的值**,不动底座默认 ——
     * 别的调用方(网页剪藏之类)不该为 X 的长名单买单。
     */
    maxMs: opts.maxMs ?? 20 * 60 * 1000,
  });
  if (!rep) {
    return { audits: [], totalResponses: 0, summary: null, harvest: null, plan: null, paging: null, fetched: [], users: [], kind: 'empty' };
  }
  /**
   * ⭐⭐⭐ **先看是不是被限流** —— 在一切判断之前。
   * ⚠️ 限流下后面所有的「到底了/没有更多了」全是假的。
   */
  const rateLimit = detectRateLimit(rep);
  if (rateLimit !== undefined) say(rateLimit);

  /** ⭐ 从第一趟开始累计 —— 后面每补一篇都加上 */
  let totalResponses = rep.items.length;
  /**
   * ⭐⭐⭐ **用户也顺带收下** —— 响应里有就产出,不问人要。
   * ⚠️ `seq` 必须**跨所有 harvest 连续**(增量采集靠它),
   * 所以计数放在这一层,不在 `dispatchPayloads` 内部。
   */
  const userAudits: XUserAudit[] = [];
  /**
   * ⭐⭐⭐ **按 handle 去重** —— 同一个人只留一份,名次按**第一次见到**算。
   *
   * ⚠️⚠️ 真机 2026-10-05 的数据损坏就是缺这一步:
   * verified_followers 翻 10 轮、每轮回**同一批 20 人**
   * (面板自己写着「新采到 0 条」),而这里照单全收、每轮重新编号 →
   * 面板报「解出 420 人·入库 新 40·更新 380」,库里**只有 40 行**,
   * `list_seq` 只剩 380…419 —— **前 380 个号全是同一批人的影子**。
   * ⭐ 「更新 380」听着像补全了 380 个人,其实是同 40 行被覆盖了 380 次。
   *
   * ⚠️ 名次必须是**第一次见到时**的号:`seq` 是增量采集的命根子
   * (「新人全落在 seq 0-10」那条实测判据),按最后一次编号就全乱了。
   */
  const seenHandles = new Set<string>();
  const takeUsers = (one: RunHarvest): void => {
    for (const a of dispatchPayloads(one.items).users) {
      const fresh: typeof a.items[number][] = [];
      for (const u of a.items) {
        const k = u.handle.toLowerCase();
        /** ⚠️ 空 handle 不进去凑数 —— 解析器已经在 problems 里报过它 */
        if (k === '' || seenHandles.has(k)) continue;
        seenHandles.add(k);
        /** ⭐ 名次 = 已经收了多少人(第一次见到时定,之后不再变) */
        fresh.push({ ...u, seq: seenHandles.size - 1 });
      }
      /**
       * ⚠️ 这一页**一个新人都没有**就不记账 ——
       * 否则 `users` 里会堆一串空壳,「解出几人」还是会被虚高的条目数骗。
       */
      if (fresh.length > 0) userAudits.push({ ...a, items: fresh });
    }
  };
  takeUsers(rep);

  /**
   * ⭐⭐⭐ **采完要回到原来那一页** —— 用户 2026-10-03 原话:
   * 「点击进去观看,观看完毕,**点击返回上一下**,继续往下浏览。」
   *
   * ⚠️⚠️ 我上一版只做了前半句。真机后果(四次跑的实测):
   *   推文 97 → 40 → 21,每次都报「滚到底 ✓」
   * 因为每轮跑完都**停在最后一篇长文页**,而「采这一页」采的是当前页 ——
   * 下一次跑时当前页已经不是主页而是一篇文章,自然越采越少。
   * ⭐ 三张截图的地址栏逐次坐实了这一点(停在 /article/…)。
   *
   * ⚠️ 起点由**调用方给**(它知道人选的是哪一页)——
   * 底座的 `harvest` 读不到当前 URL,为此改底座不值当。
   */
  let audits = auditsOf(rep);
  /**
   * ⚠️⚠️ **没有推文不等于什么都没采到** —— 2026-10-05。
   * followers / following 页就是这种情形:一条推文都没有,但**人全在**。
   * ⭐ 原先这里直接 return、把 `users` 丢了,于是我以为必须加第二个按钮。
   */
  /**
   * ⚠️⚠️ **这里不能 return** —— 2026-10-05。
   * followers 页就是「一条推文都没有」,原先在这里 return
   * 等于**跳过整个翻页段**:X 一直说还有下一页,而我们只采第一页。
   * ⭐ 没有推文的页**照样要翻页**,只是翻的是人。
   * (下面的「研判/补长文」才真的只对推文有意义,那段自己会空转。)
   */
  const noTweets = audits.length === 0;

  /**
   * ── ①.5 **主动翻页** —— 滚动翻不动的页面靠它 ──
   *
   * ⚠️⚠️ 三跑实测:配方搜索每跑只拿到 **1 条 `SearchTimeline`**,而
   * · 不是噪音(挡掉 m3u8 后 6 条响应全干净,仍是 1)
   * · 不是滚动不够(21 条推文约 17000px,实际滚了 **47360px**,早在空滚)
   * · 不是结果就这么多(**报告写「游标 1/1 页有」—— X 自己说还有下一页**)
   * ⭐ 对照 `x.profile` 同样滚 4 万 px 出 **43** 条载荷 ——
   * **个人主页滚动会自动翻页,搜索页不会**,这是 X 的页面差异。
   *
   * ⭐ 做法:拿**页面自己发过的那条请求**(URL 里带 queryId 与 features),
   * 在 `variables` 里塞游标,在页面上下文里 fetch。响应**照常被两条腿捕到**。
   * ⚠️ 停止由**数据判据**定(没有新游标 / 没采到新东西就停),
   * 轮数上限只是安全网(`feedback-pdca-close-the-loop`)。
   */
  /**
   * ⭐⭐⭐ **滚到底了就别再翻页** —— 2026-10-06,用户:
   * 「提取完毕怎么还在翻页呢?没有逻辑吗?」
   *
   * ⚠️⚠️ 原先翻页段的入口只有 `if (deps.runScript)` ——**无条件跑**,
   * 从不看滚动阶段是不是已经把活干完了。
   * 人流名单滚到底(`reachedBottom`)本身就是「这一页没有更多了」的数据判据,
   * 再从头翻一遍纯属空转:既耗时,又让面板显示「还在翻页」像卡住了。
   *
   * ⚠️ **不能无脑跳过**:搜索页滚动**不翻页**(X 的页面差异,实测滚 4 万 px
   * 只出 1 条载荷),那里必须靠主动翻页。
   * ⭐ 所以判据是「**滚到底了 + 这一趟确实解出过东西**」——
   * 什么都没解出来时(页面不对/链路坏)该让翻页去试,不能当成「采完了」。
   */
  const scrolledToBottom = rep.reachedBottom === true;
  const gotSomething = audits.length > 0 || userAudits.some((a) => a.items.length > 0);
  /**
   * ⭐⭐⭐ **人流名单:滚到底也要继续翻页** —— 2026-10-06 实测定的。
   *
   * ⚠️⚠️ 我上一轮加的「滚到底就跳过翻页」对**人流名单是错的**。
   * x.following 那跑的账拆开看:
   * 　· 滚动 765 轮 / 557085px → 只入账 **69 人**
   * 　· 翻页**第 1 轮**(15 条响应)→ 直接 **+100 人**
   * ⭐ 翻页的产出率比滚动高一个数量级,而「滚到底」只说明
   * **DOM 不再长高**,不等于 X 没有下一页(X 的游标还在给)。
   *
   * ⚠️ 推文页仍按原样:那里滚动本来就会自动翻页,滚到底就是真到底。
   * ⭐ 判据用「这一页产出的是**人**」—— 不是页面名(面板不许写死页名),
   * 也不是我猜的「哪些页特殊」。
   */
  const isUserList = userAudits.some((a) => a.items.length > 0);
  /**
   * ⭐⭐⭐ 逐页账从种子页开始(page 0)—— 种子页就对不上,翻页没有意义,直接停。
   */
  const ledger: PageLedgerRow[] = [];
  const seedRow = await ledgerFor(deps, 0, '种子', rep, audits, undefined, undefined, false);
  ledger.push(seedRow);
  const seedProblem = pageProblem(seedRow);
  const seedTimes = pageTimes(audits);
  let paging: RunResult['paging'] = null;
  /** ⭐ 断点续采:停下来时手里那个游标 + X 有没有说到头 */
  let nextCursor: string | undefined;
  let exhausted = false;
  if (seedProblem !== undefined) {
    say(`⚠️ ${seedProblem} —— 种子页就对不上,不往下翻`);
    paging = { rounds: 0, stopReason: `${seedProblem}(种子页就对不上,不往下翻)`, freshTotal: 0, rounds_detail: [], ledger };
  } else if (scrolledToBottom && gotSomething && !isUserList) {
    say('滚到底了 —— 这一页已经采完,跳过翻页');
    paging = {
      rounds: 0,
      stopReason: '滚到底了,无需翻页（这一页已经采完）',
      freshTotal: 0,
      rounds_detail: [],
      ledger,
    };
  } else if (deps.runScript) {
    const r = await pageUntilDone(deps, audits, rep, say, (one) => {
      totalResponses += one.items.length;
      /** ⭐ 翻页回来的用户也收下 —— 名次接着往下编 */
      takeUsers(one);
    }, opts.resumeCursor, ledger, seedTimes.length > 0 ? Math.max(...seedTimes) : undefined);
    audits = r.audits;
    paging = r.paging;
    nextCursor = r.nextCursor;
    exhausted = r.exhausted;
  }

  /**
   * ⭐⭐⭐ 一条推文都没有 → 这一页装的是**人**,到此为止。
   * ⚠️ 研判/补长文那一段只对推文有意义,硬跑一遍只会产出一堆空账。
   */
  if (noTweets && audits.length === 0) {
    const gotUsers = userAudits.some((a) => a.items.length > 0);
    say(gotUsers ? `这一页是用户名单：${seenHandles.size} 人` : '这一页什么都没解出来');
    return {
      audits, totalResponses, summary: null, harvest: rep,
      plan: null, paging, fetched: [],
      users: userAudits,
      /** ⭐ 由数据算:解出了人就是 users,真的什么都没有才是 empty */
      kind: gotUsers ? 'users' : 'empty',
      rateLimit,
      nextCursor,
      exhausted,
    };
  }

  // ── ② 研判(只判不做)──
  const uniq = summarizeAudits(audits);
  const needs = uniq.items.map(judgeTweet);
  const decided = decideFetch(needs, opts.depth);
  say(`研判完毕：要补 ${decided.todo.length} 条`
    + `，本次不补 ${decided.skipped.length} 条`
    + `，补不了 ${decided.impossible.length} 条`);

  // ── ③ 按深度执行 ──
  const fetched: RunResult['fetched'] = [];
  /**
   * ⭐ 只有「进单篇页」这条路要在这里跑;
   * `expand-in-place` 已经由 `afterRoundScriptId` 每轮做掉了。
   */
  const extraAudits: TimelineAudit[] = [];
  /** ⭐ 已经试过的 —— 取不到正文的那几篇不许让循环空转 */
  const done = new Set<string>();

  /** ⭐ 补一篇:导航进去、采、回读**那一条**的产出 */
  async function fetchOne(n: TweetNeed, label: string): Promise<void> {
    const url = n.route.kind === 'open-article' ? n.route.url : '';
    done.add(n.id);
    say(`取长文正文 ${label}…`);
    const one = await deps.harvest({
      gotoPage: { name: X_PAGE_NAME.article, params: { articleId: url } },
      wantPages: 1,
      pageUrlIncludes: X_PAGE_MATCHERS,
      noisyUrlSubstrings: X_NOISY_URLS,
      /** ⚠️ 长文是一篇文章,采到正文就停 —— 轮数只是安全网 */
      maxRounds: 8,
    });
    if (!one) {
      (fetched as Array<RunResult['fetched'][number]>).push({
        id: n.id, url, ok: false, why: '导航或采集失败',
      });
      return;
    }
    totalResponses += one.items.length;
    const got = auditsOf(one);
    extraAudits.push(...got);

    const all = got.flatMap((a) => a.items);
    /**
     * ⭐⭐⭐ **只认 `n.id` 那一条** —— 2026-10-04 真机逼出来的。
     *
     * ⚠️⚠️ 原先是 `find(t => t.isArticle && t.incomplete === undefined)` ——
     * **任意一条**有正文的长文都算数。但单篇页载荷里不止一条推
     * (引用的、相关的都在里面),于是面板报「取回 19/19」而报告里只有 17 篇。
     * ⭐ `feedback-pdca-close-the-loop`:「数错元素致该数恒为 0」——
     * 这次是反过来,**数错元素致该数恒为满**,一样等于没在看。
     */
    const hit = all.find((t) => t.id === n.id && t.incomplete === undefined);
    /**
     * ⭐⭐ 失败要说清**是哪一种** —— 一句话盖住多种成因 = 留了痕也等于没留。
     * (真机实证:正是把这句拆开之后,「串轮」那个 bug 当场就露了。)
     */
    (fetched as Array<RunResult['fetched'][number]>).push(hit !== undefined
      ? { id: n.id, url, ok: true, textLen: hit.textLen }
      : {
        id: n.id,
        url,
        ok: false,
        why: one.items.length === 0
          ? '单篇页一条响应都没有 —— 多半没到位或腿没装上'
          : all.length === 0
            ? `收到 ${one.items.length} 条响应但**没有一条带推文** —— 端点判据可能不认`
            : all.some((t) => t.id === n.id)
              ? `载荷里有这一条但**它没正文**（同页另有 ${all.length - 1} 条）`
              : `解出 ${all.length} 条推文但**没有这一条** —— 多半是跳转去了别的页`,
      });
  }

  /**
   * ⭐⭐⭐ **判断-执行-再判断-再执行** —— `feedback-pdca-close-the-loop` 的①。
   *
   * ⚠️⚠️ 原先是「判一次 → 照单做完 → 收工」。真机 2026-10-04 的后果:
   * 面板报「取回长文正文 **38/38**」零失败,报告却说「**缺 19 篇**」——
   * 两个数都对:补长文时**单篇页载荷里还夹着别的长文**(引用的、相关的),
   * 它们被一起收进账,**却从来没被请求过**。
   *
   * ⭐ 停止由**数据判据**定(没有新的要补就停),不由预先猜的次数定;
   * 轮数上限只是安全网。⚠️ 每轮都**回读真实总账**再判,不凭印象。
   */
  let pending = decided.todo.filter((n) => n.route.kind === 'open-article');
  let pass = 0;
  while (pending.length > 0 && done.size < MAX_ARTICLE_FETCH && pass < MAX_PASSES) {
    pass += 1;
    const batch = pending.slice(0, MAX_ARTICLE_FETCH - done.size);
    for (let i = 0; i < batch.length; i += 1) {
      /** ⭐ 补长文一篇约 9 秒,38 篇就是 6 分钟 —— **必须能中途叫停** */
      if (deps.cancelled?.()) { say(`已停止（补了 ${done.size} 篇长文）`); break; }
      await fetchOne(batch[i], `${i + 1}/${batch.length}` + (pass > 1 ? `（第 ${pass} 轮）` : ''));
    }
    if (deps.cancelled?.()) break;
    /** ⭐ 拿这一轮之后的**总账**再判一次;已经试过的不再排进来 */
    pending = summarizeAudits([...audits, ...extraAudits])
      .items.map(judgeTweet)
      .filter((n) => n.route.kind === 'open-article' && !done.has(n.id));
    if (pending.length > 0) {
      say(`又冒出 ${pending.length} 篇长文（补的时候带出来的）`);
    }
  }

  /**
   * ── ④ 回到原来那一页 ──
   * ⚠️ 只要**离开过**就要回,哪怕只补了一篇。
   * ⭐ 回不去不算整轮失败(数据已经采到了),但要留痕 ——
   * 下一轮会从错的页开始,人得知道。
   */
  if (done.size > 0 && deps.goBack) {
    say('采完了，回到原来那一页…');
    const back = await deps.goBack();
    if (!back) {
      console.warn('[x.collect] 回不到原页 —— 下一轮会从当前这页开始采');
    }
  }

  // ── ⑤ 把补回来的并进账 ──
  audits = [...audits, ...extraAudits];
  return {
    audits,
    totalResponses,
    paging,
    /**
     * ⚠️⚠️ 重新汇总 —— 补回来的那几篇必须体现在账上。
     *
     * ⭐ 长文会出现两次(列表页那份 23 字 / 单篇页那份带正文),
     * `summarizeAudits` 去重时**留更全的那份**(只许变长)。
     * ⚠️ 这不是本来就对的:原先「保留先出现的」会把补回来的正文
     * 整个丢掉 —— 跑完 38 趟,报告照样说「缺 38 篇」。
     * 写这个模块时实测证出来的,已在 `summarizeAudits` 里改掉。
     */
    summary: summarizeAudits(audits),
    harvest: rep,
    plan: { depth: opts.depth, ...decided },
    fetched,
    users: userAudits,
    /** ⭐ 两种都解出来了就是 mixed —— 那是真实情况不是异常 */
    kind: userAudits.some((a) => a.items.length > 0) ? 'mixed' : 'tweets',
    rateLimit,
    nextCursor,
    exhausted,
  };
}
