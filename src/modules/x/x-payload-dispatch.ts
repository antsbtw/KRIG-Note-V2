/**
 * ⭐⭐⭐ **载荷自己说自己是什么** —— 采集只有一个入口
 *
 * 用户 2026-10-05 的订正(原话):
 * 「不管采什么,都是采集页面的内容,而不应该增加一个采人的名单。
 * 　跳转到那个页面,就采集那个页面,这就是输出的意义。
 * 　**输出要自行判断**,把输出的内容结构化而已。」
 *
 * ── ⚠️⚠️ 我错在哪 ──
 * 原设计让**人**告诉采集器「这页上是什么」:两个按钮,按钮决定用哪个解析器。
 * 可端点名里就写着 `Followers` / `SearchTimeline` —— **信息本来就在数据里**,
 * 我却造了第二个真源,还把「保持两边一致」变成了人的活。
 * ⭐ 这正是 `project-x-collect-panel-scraped-homepage` 的形状:
 * 「我在哪一页」有两个说法,就一定有一天它们不一致(那次爬了 30 分钟首页,
 * 1281 条污染入库)。⭐⭐ **消掉一个真源,比给它加守卫更根本**。
 *
 * ── ⭐ 这一层只做一件事 ──
 * 拿一堆「URL + 响应体」,按 URL 的端点名分给对应的解析器,产出结构化的账。
 * ⚠️ 它**不采集、不翻页、不落库、不判断够不够** —— 那些各有各的层。
 * ⚠️ 也**不认页面**:页面是人导航的结果,响应才是事实。
 */

import { auditTimelinePayload, type TimelineAudit } from './x-timeline-audit';
import { auditUserPayload, type XUserAudit } from './x-user-audit';
import { carriesTweets, carriesUsers } from './x-pages';

/** ⭐ 一条采回来的响应 —— 与底座 `HarvestReport.items` 同形 */
export type RawPayload = {
  readonly url: string;
  readonly text: string;
};

/**
 * ⭐⭐ **这一页装的是什么** —— 由数据算出来,不是人选的。
 * ⚠️ `mixed` 是真实情况不是异常:人流名单页上也会有别的时间线请求。
 */
export type PayloadKind = 'tweets' | 'users' | 'mixed' | 'empty';

export type DispatchResult = {
  /** ⭐ 由数据算出来的结论 */
  readonly kind: PayloadKind;
  readonly tweets: readonly TimelineAudit[];
  readonly users: readonly XUserAudit[];
  /**
   * ⭐ 既不是推文也不是用户的响应**记个数**。
   * ⚠️ 悄悄丢掉的话,「页面没数据」和「全是视频分片」长得一模一样 ——
   * 而后者的下一步完全不同(是噪音表没拦住,不是采集坏了)。
   */
  readonly ignored: number;
  /**
   * ⚠️ 解析器报的问题**原样汇总带出**。
   * 「这个载荷读不懂」与「这个载荷是空的」是两件事,混起来就查不动。
   */
  readonly problems: readonly string[];
};

/**
 * ⭐⭐⭐ 把一批响应分给对应的解析器。
 *
 * ⚠️ 判据是**端点名**(`carriesTweets` / `carriesUsers`,两者互斥),
 * 不是「人在面板上选了什么」,也不是「当前页是哪一页」。
 */
export function dispatchPayloads(items: readonly RawPayload[]): DispatchResult {
  const tweets: TimelineAudit[] = [];
  const users: XUserAudit[] = [];
  const problems: string[] = [];
  let ignored = 0;
  /**
   * ⭐⭐ 用户的名次**跨响应连续** —— `seq` 是增量采集的命根子
   * (「新人全落在 seq 0-10」那条实测判据靠它)。
   * ⚠️ 每个响应各自从 0 编号的话,去重后名次全是乱的。
   */
  let seq = 0;

  for (const it of items) {
    if (carriesUsers(it.url)) {
      const a = auditUserPayload(it.text, seq);
      seq += a.items.length;
      users.push(a);
      problems.push(...a.problems);
      continue;
    }
    if (carriesTweets(it.url)) {
      const a = auditTimelinePayload(it.text);
      tweets.push(a);
      problems.push(...a.problems);
      continue;
    }
    /** ⭐ 认不出的记一笔(见 `ignored` 的注释) */
    ignored += 1;
  }

  /**
   * ⭐⭐ `kind` **由数据算**,不是调用方传进来的。
   * ⚠️ 判据用「解出了东西没有」而不是「有几个响应」——
   * 一页有 20 个 Followers 响应却一个人都没解出来,那是 `empty` 不是 `users`,
   * 而把它报成 `users` 就等于说「采到了」(又一个「看着成功实际没有」)。
   */
  const gotTweets = tweets.some((a) => a.items.length > 0);
  const gotUsers = users.some((a) => a.items.length > 0);
  const kind: PayloadKind = gotTweets && gotUsers ? 'mixed'
    : gotTweets ? 'tweets'
      : gotUsers ? 'users' : 'empty';

  return { kind, tweets, users, ignored, problems };
}
