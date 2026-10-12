/**
 * ⭐⭐ 采一个人的帖子 / 回复 / 转发 —— 按**时间范围**收手(纯函数,离线可测)
 *
 * 用户 2026-10-10:「右键点击，获取这三项数据，但是可以配置获取的长度（一个月、半年、一年，全部），
 * 如果全部时可能比较长，要跑上几天，就采用策略方式慢慢跑…大部分就是一个月就够了。」
 *
 * 第一步只做「一个月当场采」;半年 / 一年 / 全部走后台策略(第二步)。
 *
 * ── ⚠️ 按时间停的两个坑(都是真机数据里看到的,10-10 李老师不是你老师)──
 * ① **置顶推文**:主页最早一条是 05-12、回复页最早是 2023 年,都是置顶 —— 拿「最早的一条」判,
 *    第一页就停。→ 只判**翻页回来的每一页**(置顶只在首页),不判首页。
 * ② **转发旧推文**:原推可能很老,转发却是最近的 —— 原推作者不是他。→ 只看**他自己的**推文
 *    (转发外层那条作者是他,时间就是转发的时间)。
 * 判据:这一页**他自己最新的一条**都早于起点 → 整页都过了范围 → 停。
 */

import type { PagingDecision, PagingState } from './x-collect-run';
import type { TweetRecord } from './x-timeline-audit';
import { X_PAGE_NAME } from './x-pages';

export type TimelineRange = 'month' | 'halfYear' | 'year' | 'all';

export const TIMELINE_RANGES: ReadonlyArray<{ readonly id: TimelineRange; readonly label: string; readonly days?: number }> = [
  { id: 'month', label: '一个月', days: 30 },
  { id: 'halfYear', label: '半年', days: 182 },
  { id: 'year', label: '一年', days: 365 },
  { id: 'all', label: '全部' },
];

/**
 * ⭐ 三个标签页 —— 接口名是 2026-10-10 真机探查确认的:
 * 帖子 `UserOriginalsTimeline`、回复 `UserRepliesTimeline`(⚠️ 不是旧名 UserTweetsAndReplies)、
 * 转发 `UserRepostsTimeline`。
 */
export const PERSON_TABS: ReadonlyArray<{ readonly name: string; readonly label: string; readonly endpoint: string }> = [
  { name: X_PAGE_NAME.profile, label: '帖子', endpoint: 'UserOriginalsTimeline' },
  { name: X_PAGE_NAME.withReplies, label: '回复', endpoint: 'UserRepliesTimeline' },
  { name: X_PAGE_NAME.reposts, label: '转发', endpoint: 'UserRepostsTimeline' },
];

/** 当场采时每个标签页最多翻几页 —— 超过就停,并说清楚(剩下的交给后台策略) */
export const LIVE_PAGE_CAP = 30;

export function rangeStart(range: TimelineRange, now: Date): Date | undefined {
  const r = TIMELINE_RANGES.find((x) => x.id === range);
  if (!r || r.days === undefined) return undefined;
  return new Date(now.getTime() - r.days * 86_400_000);
}

/** 这一页**他自己**最新一条推文的时间(没有他自己的推文 → undefined) */
export function newestOwn(records: readonly TweetRecord[], restId: string): string | undefined {
  const own = records.filter((r) => r.authorRestId === restId && r.createdAt)
    .map((r) => Date.parse(r.createdAt!))
    .filter((t) => !Number.isNaN(t));
  return own.length > 0 ? new Date(Math.max(...own)).toISOString() : undefined;
}

/**
 * ⭐⭐ 翻页的收手规则:① 到了当场采的页数上限 ② 这一页他自己最新的推文都早于起点。
 * 首页(置顶所在)不经过这里 —— `stopPaging` 只在翻页回来的每一轮调用。
 */
export function timeWindowStop(
  restId: string, start: Date | undefined, pageCap: number,
): (st: PagingState) => PagingDecision {
  return (st) => {
    const newest = newestOwn(st.roundRecords, restId);
    if (start !== undefined && newest !== undefined && Date.parse(newest) < start.getTime()) {
      return { go: false, why: `已采到 ${start.toISOString().slice(0, 10)} 之前(这一页他最新的一条是 ${newest.slice(0, 10)})` };
    }
    if (st.round >= pageCap) {
      return { go: false, why: `当场采到上限 ${pageCap} 页还没到范围起点 —— 剩下的要交给后台策略` };
    }
    return { go: true };
  };
}
