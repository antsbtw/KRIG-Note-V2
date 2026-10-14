/**
 * ⭐⭐ 跑「一段」后台采集 —— 编排(副作用全注入,可离线测)
 *
 * 一段 = 对一个任务的**某一个标签页**,从断点续、翻**有限页数**就停,把结果并进任务。
 * 不是一口气采完 —— 采完要很多段、跨很多个节奏窗口、可能好几天(用户:「慢慢跑」)。
 *
 * ── 为什么这一层要纯 ──
 * 真正采集的 runCollect / 导航 / 存库全**注入**进来(SegmentDeps),所以这里能离线测
 * 「选哪个页」「怎么判到底」「怎么判失败」这些编排判断,不用起库、不用真机。
 * 真机那套(webDomInvoke / saveTweets)由调用方(runner / 人卡)接。
 *
 * ⭐ 停止判据全来自**数据**(x-collect-strategy 血泪):
 *   到范围起点(timeWindowStop) / X 说到头(exhausted) → 这个页 done;
 *   只是翻够了本段页数 → 存断点、下段接着翻,**不是** done。
 */

import type { BgJob, BgTab, SegmentOutcome } from './x-bg-job';
import { mergeSegment, nextTab } from './x-bg-job';
import { PERSON_TABS, rangeStart } from './x-person-timeline';
import { X_PAGE_NAME } from './x-pages';

/** 标签页 → 页名(导航用)。profile=帖子 / replies=回复 / reposts=转发 */
const TAB_PAGE: Record<BgTab, string> = {
  profile: X_PAGE_NAME.profile,
  replies: X_PAGE_NAME.withReplies,
  reposts: X_PAGE_NAME.reposts,
};

/** 一段的结果(除了并进 job,还带出给留痕/日志看的细节) */
export type SegmentReport = {
  /** 并进任务后的新 job(调用方拿去 saveJob)。没有可跑的页时返回原 job */
  readonly job: BgJob;
  /** 这一段采了哪个页;没跑(全到底)时 undefined */
  readonly tab?: BgTab;
  /** 一句话结果(留痕) */
  readonly note: string;
};

/**
 * ⭐ 注入的一次采集 —— 包了 runCollect。调用方负责:
 *  - 导航到 `page`(带 handle)
 *  - runCollect(resumeCursor=cursor, 本段页数上限 pageCap, 时间停到 start)
 *  - 存推文
 * 返回这一段的产出(纯数据,segment 据此算 SegmentOutcome)。
 */
export type RunOneResult = {
  /** 这一段翻了几页 */
  readonly pages: number;
  /** 存进库几条 */
  readonly saved: number;
  /** 停下来时手里的游标(下次续);undefined=没有可续的 */
  readonly nextCursor?: string;
  /** X 说到头了(TimelineTerminateTimeline) */
  readonly exhausted: boolean;
  /** 停止原因(runCollect 的 stopReason) */
  readonly stopReason: string;
  /** 这一页他最新一条的时间(显示用) */
  readonly oldestAt?: string;
  /** 被限流/失败了(有话说);扛不住就停整个任务 */
  readonly failure?: string;
};

export type SegmentDeps = {
  /**
   * 跑这个页的一段。`start` 是范围起点(到它就该停这个页),
   * `pageCap` 是本段最多翻几页(翻够就停这段,不是停整个页)。
   */
  runOne(input: {
    readonly page: string;
    readonly handle: string;
    readonly resumeCursor?: string;
    readonly start?: Date;
    readonly pageCap: number;
  }): Promise<RunOneResult>;
  /** 每做一步报一句(留痕 + 进度) */
  onProgress?(msg: string): void;
};

/**
 * ⭐⭐⭐ 判这个页**到底了没**。
 *
 * ⚠️ 判据**只有两个**,都是数据说了算:
 *  ① X 说到头(exhausted)
 *  ② 翻到了范围起点 —— 表现为「不是因为页数上限停的」且 stopReason 提到采到了起点之前
 * ⚠️ 只翻够本段页数(pageCap)→ **没到底**,下段接着翻。
 *
 * ── 为什么要显式判而不是信一个 flag ──
 * runCollect 的 stopReason 是人话字符串,timeWindowStop 到起点时写「已采到 X 之前」,
 * 到页数上限时写「当场采到上限 N 页」。两者都让翻页停,但**含义相反**:
 * 前者是这段时间采完了(done),后者是这段先到这儿(续)。
 */
export function tabDoneFrom(r: RunOneResult): boolean {
  if (r.exhausted) return true;
  // 页数上限停 → 没到底(还要续)。其余的「停」里,到起点那种才算 done。
  if (/上限/.test(r.stopReason)) return false;
  if (/采到.*之前|到.*起点|范围/.test(r.stopReason)) return true;
  // 没游标了(X 不给了)也算到底 —— 和 exhausted 同义的另一种表现
  if (r.nextCursor === undefined && !/上限/.test(r.stopReason)) return true;
  return false;
}

/**
 * ⭐⭐ 跑一个任务的一段。
 * @param job 当前任务
 * @param pageCap 本段最多翻几页(来自 bg.pages_per_segment 设置)
 * @param now 时间源(注入,便于测)
 */
export async function runSegment(
  job: BgJob, deps: SegmentDeps, pageCap: number, now: Date,
): Promise<SegmentReport> {
  const tab = nextTab(job);
  if (tab === undefined) {
    // 三页全到底,照理 runner 不该把它挑进来;稳妥起见把它收成 done
    return { job: { ...job, status: 'done', updatedAt: now.toISOString() }, note: '三页都到底了,标完成' };
  }

  const page = TAB_PAGE[tab];
  const label = PERSON_TABS.find((t) => t.name === page)?.label ?? tab;
  const start = rangeStart(job.range, now); // 'all' → undefined(没有时间终点,只能靠 exhausted)
  const resumeCursor = job[tab].cursor;
  deps.onProgress?.(`采${label}…${resumeCursor ? '(从断点续)' : ''}`);

  const r = await deps.runOne({ page, handle: job.handle, resumeCursor, start, pageCap });

  const out: SegmentOutcome = {
    tab,
    pages: r.pages,
    saved: r.saved,
    nextCursor: r.failure !== undefined ? job[tab].cursor : r.nextCursor,
    tabDone: r.failure === undefined && tabDoneFrom(r),
    oldestAt: r.oldestAt,
    failed: r.failure,
  };
  const next = mergeSegment(job, out, now);
  const note = r.failure !== undefined
    ? `${label} 这段失败:${r.failure}`
    : `${label} 这段 ${r.pages} 页 ${r.saved} 条${out.tabDone ? '(到底了)' : '(还没到,下段续)'} —— ${r.stopReason}`;
  deps.onProgress?.(note);
  return { job: next, tab, note };
}
