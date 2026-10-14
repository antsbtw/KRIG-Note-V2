/**
 * ⭐⭐ 后台采集任务 —— 类型 + 纯判断(「他的朋友圈」第二步,2026-10-13)
 *
 * 用户 2026-10-10:「可以配置获取的长度(一个月、半年、一年，全部)，如果全部时可能比较长，
 * 要跑上几天，就采用策略方式慢慢跑…大部分就是一个月就够了。」
 *
 * → month 当场采(第一步,已上线);halfYear / year / all 走后台策略(本文件起)。
 *
 * ── 分层 ──
 * 本文件**纯逻辑、零副作用**:类型、状态流转、挑任务判断、进度合并 —— 可完全离线测。
 * 碰库的在 `x-bg-job-repo.ts`,跑一段的编排在 `x-bg-segment.ts`。
 *
 * ⭐ 身份只认 `rest_id`(全仓铁律 [[project-x-ops-platform]] 1.2.20):handle 只做显示。
 */

import type { TimelineRange } from './x-person-timeline';

/** 后台任务只接这三档(month 当场采,不进后台) */
export type BgRange = Extract<TimelineRange, 'halfYear' | 'year' | 'all'>;

export function isBgRange(r: TimelineRange): r is BgRange {
  return r === 'halfYear' || r === 'year' || r === 'all';
}

/**
 * 任务状态。
 * ⚠️ `done` / `failed` 是**终态**;`paused` 可回 `queued`(恢复)。
 */
export type BgStatus = 'queued' | 'running' | 'paused' | 'done' | 'failed';

/** 三个标签页 —— 各采各的、各停各的(翻页速度不同,某个页可能先到底) */
export type BgTab = 'profile' | 'replies' | 'reposts';
export const BG_TABS: readonly BgTab[] = ['profile', 'replies', 'reposts'];

/** 一个标签页的进度 */
export type BgTabProgress = {
  /** 下次从这个游标接着翻;undefined = 还没开始 / 从头 */
  readonly cursor?: string;
  /** 已采到的最旧时间(只做显示,⚠️ 绝不做停止判据 —— 见 x-collect-strategy 血泪④) */
  readonly oldestAt?: string;
  /** 这个页到底了没(到范围起点 / X 说到头) */
  readonly done: boolean;
};

/** 一个后台任务(与 x_bg_job 表一行对应) */
export type BgJob = {
  readonly id: string;
  readonly restId: string;
  readonly handle: string;
  readonly wsId: string;
  readonly range: BgRange;
  readonly status: BgStatus;
  readonly profile: BgTabProgress;
  readonly replies: BgTabProgress;
  readonly reposts: BgTabProgress;
  readonly lastError?: string;
  readonly totalPages: number;
  readonly totalSaved: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly lastSegmentAt?: string;
};

export function tabProgress(job: BgJob, tab: BgTab): BgTabProgress {
  return job[tab];
}

/**
 * ⭐⭐ 三个标签页全到底 → 整个任务完成。
 * ⚠️ 这是**完成**的唯一判据(不靠页数、不靠时间猜),与停止判据同源:数据说了算。
 */
export function allTabsDone(job: BgJob): boolean {
  return job.profile.done && job.replies.done && job.reposts.done;
}

/**
 * ⭐ 这个任务接下来该采哪个标签页 —— 第一个还没到底的。
 * 全到底返回 undefined(调用方据此把 job 标 done)。
 */
export function nextTab(job: BgJob): BgTab | undefined {
  return BG_TABS.find((t) => !job[t].done);
}

/**
 * ⭐⭐⭐ 现在该不该跑这个任务的下一段 —— 纯判断,runner 的核心。
 *
 * ⚠️ 不碰库、不碰时间源:`now` 和 `wsBusy` 都传进来,所以能离线测。
 *
 * 规则(全部可解释):
 *  - 终态(done/failed)不跑
 *  - paused 不跑(等人恢复)
 *  - 这个 ws 正忙(你在手动操作)→ 让路,不跑
 *  - 距上一段没够间隔 → 等
 *  - 其余(queued / running)→ 跑
 */
export type DueDecision = {
  readonly due: boolean;
  /** 不跑时说清为什么(留痕/调试要看得见) */
  readonly why: string;
};

export function isDue(
  job: BgJob,
  opts: { readonly now: Date; readonly wsBusy: boolean; readonly segmentGapSec: number },
): DueDecision {
  if (job.status === 'done') return { due: false, why: '已完成' };
  if (job.status === 'failed') return { due: false, why: `上次失败了,等人看过:${job.lastError ?? ''}` };
  if (job.status === 'paused') return { due: false, why: '已暂停,等人点恢复' };
  if (opts.wsBusy) return { due: false, why: '这个号正在手动操作,让路' };
  if (job.lastSegmentAt !== undefined) {
    const since = (opts.now.getTime() - Date.parse(job.lastSegmentAt)) / 1000;
    if (Number.isFinite(since) && since < opts.segmentGapSec) {
      return { due: false, why: `距上段才 ${Math.floor(since)} 秒,间隔 ${opts.segmentGapSec} 秒还没到` };
    }
  }
  return { due: true, why: '到期可跑' };
}

/**
 * ⭐⭐ 一段跑完,把结果合并进任务(纯函数,不碰库)。
 *
 * ⚠️ 返回**新的** BgJob,调用方拿去写库。这样「合并逻辑」能离线测,
 * 不用起库就能验「到底了 → done」「三页全 done → 整任务 done」这些流转。
 */
export type SegmentOutcome = {
  readonly tab: BgTab;
  /** 这一段翻了几页 */
  readonly pages: number;
  /** 这一段存了几条 */
  readonly saved: number;
  /** 停下来时手里的游标(下次从这续);undefined = 没有可续的 */
  readonly nextCursor?: string;
  /** 这个标签页到底了没(到范围起点 / X 说到头) */
  readonly tabDone: boolean;
  /** 这一页他最新一条的时间(显示用) */
  readonly oldestAt?: string;
  /** 这一段失败了吗(403/限流扛不住…),失败就停整个任务 */
  readonly failed?: string;
};

export function mergeSegment(job: BgJob, out: SegmentOutcome, now: Date): BgJob {
  const nowIso = now.toISOString();
  if (out.failed !== undefined) {
    return { ...job, status: 'failed', lastError: out.failed, updatedAt: nowIso, lastSegmentAt: nowIso };
  }
  const prog: BgTabProgress = {
    cursor: out.nextCursor,
    oldestAt: out.oldestAt ?? job[out.tab].oldestAt,
    done: out.tabDone,
  };
  const next: BgJob = {
    ...job,
    [out.tab]: prog,
    totalPages: job.totalPages + out.pages,
    totalSaved: job.totalSaved + out.saved,
    updatedAt: nowIso,
    lastSegmentAt: nowIso,
    // 跑了一段,从 queued 转 running(除非已经是)
    status: 'running',
  } as BgJob;
  // 三页全到底 → 整任务完成
  return allTabsDone(next) ? { ...next, status: 'done' } : next;
}

/** 一句话进度(人卡/状态页显示) */
export function describeProgress(job: BgJob): string {
  const one = (label: string, p: BgTabProgress): string =>
    p.done ? `${label} 已到底` : `${label} ${p.oldestAt ? `采到 ${p.oldestAt.slice(0, 10)}` : '待采'}`;
  const head = job.status === 'done' ? '✅ 采完'
    : job.status === 'failed' ? `❌ ${job.lastError ?? '失败'}`
    : job.status === 'paused' ? '⏸ 暂停'
    : job.status === 'running' ? '▶ 采集中' : '⏳ 排队';
  return `${head}｜${one('帖子', job.profile)}／${one('回复', job.replies)}／${one('转发', job.reposts)}｜共 ${job.totalPages} 页 ${job.totalSaved} 条`;
}
