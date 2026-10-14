/**
 * ⭐⭐⭐ 后台采集节奏控制器(2026-10-13,「他的朋友圈」第二步 3b)
 *
 * 一个常驻 timer,每隔一个节奏窗口醒一次:遍历有活跃任务的 ws,每个 ws 挑一个到期任务,
 * **跑一段**(翻几页就停、存断点),然后歇着等下一个窗口。一个人要采几天 = 很多段。
 *
 * ── 分层 ──
 * 本文件 = timer 外壳 + 一次调度(`tickOnce`,可单测,真采集经 deps 注入)。
 * 跑一段的编排 = `x-bg-segment.ts`(纯);真采集 = `collectPersonTab`(主进程驱动 webview);
 * 断点读写 = `x-bg-job-repo.ts`。
 *
 * ── ⚠️ 铁律(都踩过)──
 * 1. **常驻 timer 必须在 before-quit 有停止调用**(记忆 project-graceful-shutdown:
 *    不停 → 吊住事件循环 → Ctrl+C 不退)。`stopBgRunner` 导出给 index.ts;timer `unref()`。
 * 2. **同 ws 串行**(x_task 注释:同一任务跨 ws 并行=很强的自动化信号)。
 *    `runningWs` 按 ws 锁;跨 ws 可并行(用户拍板「按 ws 各一个并行」)。
 * 3. **你在手动操作该 ws 时让路**:`isDue` 看 wsBusy(getXHostBusy)。
 * 4. 失败即停:一段 failed → job 标 failed 留原因,不自动重试(异常即停铁律)。
 */

import { getXHostState, getXHostBusy } from './x-host-registry';
import { readSettings } from './x-ops-actions-repo';
import { activeJobsForWs, wsWithActiveJobs, readJob, saveJob } from './x-bg-job-repo';
import { isDue, type BgJob } from './x-bg-job';
import { runSegment, type SegmentDeps, type RunOneResult } from './x-bg-segment';
import { collectPersonTab } from './x-person-collect';
import { saveTweets } from './x-tweet-repo';
import { rangeStart } from './x-person-timeline';
import { newestOwn } from './x-person-timeline';
import { traceRecorder } from '@platform/main/web-capability/wiring/runtime';

/** 默认节奏(都可被 x_setting 覆盖) */
const DEFAULTS = {
  /** timer 多久醒一次(毫秒)—— 醒来挑到期任务 */
  tickMs: 120_000,
  /** 一段最多翻几页(翻够就停这段,等下个窗口再跑) */
  pagesPerSegment: 10,
  /** 两段之间至少隔多久(秒)—— isDue 用 */
  segmentGapSec: 120,
};

let timer: ReturnType<typeof setInterval> | null = null;
/** ⭐ 同 ws 串行:正在跑一段的 ws 锁在这里,下一轮 tick 跳过它 */
const runningWs = new Set<string>();

/** 读节奏设置(库里没有就用默认) */
async function readPace(): Promise<{ pagesPerSegment: number; segmentGapSec: number }> {
  try {
    const { settings } = await readSettings();
    return {
      pagesPerSegment: settings['bg.pages_per_segment'] ?? DEFAULTS.pagesPerSegment,
      segmentGapSec: settings['bg.segment_gap_sec'] ?? DEFAULTS.segmentGapSec,
    };
  } catch {
    return { pagesPerSegment: DEFAULTS.pagesPerSegment, segmentGapSec: DEFAULTS.segmentGapSec };
  }
}

/**
 * ⭐⭐ runner 用的 SegmentDeps —— 把真采集(collectPersonTab)+ 存库 组装成 RunOneResult。
 *
 * ⚠️ `collectPersonTab` 只采不存(与人卡同一份);存库是调用方的事,这里主进程直接调 saveTweets。
 * `saved` 要等存完才知道,所以组装在这里而不在 collectOnWebview 里。
 */
function makeSegmentDeps(wcId: number, job: BgJob, now: Date): SegmentDeps {
  return {
    async runOne(input) {
      const start = rangeStart(job.range, now);
      const r = await collectPersonTab({
        wcId,
        page: input.page,
        handle: input.handle,
        restId: job.restId,
        start: start?.toISOString(),
        pageCap: input.pageCap,
        attempt: 1,
      });
      if (!r.reached) {
        // 没去到页 = 这一段失败(不碰断点,等下个窗口重试或人看)
        return { pages: 0, saved: 0, exhausted: false, stopReason: r.reason, failure: r.reason } satisfies RunOneResult;
      }
      // 存库(主进程直接调 repo;source=页名,与人卡一致)
      let saved = 0;
      if (r.records.length > 0) {
        try {
          const sv = await saveTweets([...r.records], { source: input.page });
          saved = sv.inserted;
        } catch (e) {
          // 采到了却存不进 = 这一段失败,断点不动(下次重采这一段,推文幂等)
          const why = `存库失败:${e instanceof Error ? e.message : String(e)}`;
          return { pages: 0, saved: 0, exhausted: false, stopReason: why, failure: why } satisfies RunOneResult;
        }
      }
      const stopReason = r.paging?.stopReason ?? '';
      /**
       * ⚠️ 失败判据:403/限流这类「扛不住了」→ failure(停整个任务,等人看)。
       * 「到起点 / X 到头 / 页数上限」都是正常停,不是 failure。
       * 403 现在的失败语是「没带鉴权头」(见 project-x-paging-403-root-cause),一并认。
       */
      const failed = /403|没带鉴权头|限流|429/.test(stopReason) ? stopReason : undefined;
      return {
        pages: r.paging?.rounds ?? 0,
        saved,
        nextCursor: r.nextCursor,
        exhausted: r.exhausted,
        stopReason,
        oldestAt: newestOwn([...r.records], job.restId),
        failure: failed,
      } satisfies RunOneResult;
    },
    onProgress: (m) => {
      traceRecorder.lifecycle({
        layer: 'web.net', event: 'x-bg-progress', pageId: 'x-bg',
        detail: { jobId: job.id, handle: job.handle, range: job.range, msg: m },
      });
    },
  };
}

/**
 * ⭐⭐⭐ **跑一轮调度** —— 可单测(真采集经 `drive` 注入)。
 *
 * 遍历有活跃任务的 ws,每个 ws:
 *  · 没开 X 网页(getXHostState 为空)→ 跳过(没法采)
 *  · 这个 ws 正在跑一段(runningWs)→ 跳过(同 ws 串行)
 *  · 挑第一个到期任务(isDue:终态/暂停/忙让路/间隔未到 都不跑)→ 跑一段
 *
 * @param drive 给某 ws 的某 job 跑一段 + 存回库。注入便于测。
 */
export async function tickOnce(
  drive: (wsId: string, wcId: number, job: BgJob) => Promise<void>,
  now: Date = new Date(),
): Promise<void> {
  const pace = await readPace();
  const wss = await wsWithActiveJobs();
  for (const wsId of wss) {
    if (runningWs.has(wsId)) continue; // 同 ws 串行
    const host = getXHostState(wsId);
    if (!host) continue; // 这个 ws 没开 X 网页 —— 没法采,等它开
    const wsBusy = getXHostBusy(host.wcId) !== null;
    const jobs = await activeJobsForWs(wsId);
    // 挑第一个到期的
    const due = jobs.find((j) => isDue(j, { now, wsBusy, segmentGapSec: pace.segmentGapSec }).due);
    if (!due) continue;
    runningWs.add(wsId);
    try {
      await drive(wsId, host.wcId, due);
    } finally {
      runningWs.delete(wsId);
    }
  }
}

/** 真正跑一段 + 存回库 —— tickOnce 的默认 drive(生产用) */
async function driveSegment(_wsId: string, wcId: number, job: BgJob): Promise<void> {
  const now = new Date();
  const pace = await readPace();
  const deps = makeSegmentDeps(wcId, job, now);
  const report = await runSegment(job, deps, pace.pagesPerSegment, now);
  // ⚠️ 重新读一遍再存?不:runSegment 返回的是基于传入 job 的新状态,直接存。
  // 但人可能在这期间暂停/取消了 —— 存前查一下当前状态,别把「已取消」覆盖回 running。
  const fresh = await readJob(job.id);
  if (fresh === null) return; // 被取消删掉了
  if (fresh.status === 'paused') return; // 人暂停了,别覆盖
  await saveJob(report.job);
}

/**
 * 启动节奏控制器。⚠️ 幂等。调用方**必须**在 before-quit 调 stopBgRunner(常驻 timer 铁律)。
 */
export function startBgRunner(tickMs = DEFAULTS.tickMs): void {
  if (timer) return;
  timer = setInterval(() => {
    void tickOnce(driveSegment).catch((err) => {
      // 调度自己抛错不许拖垮进程,但必须留痕
      console.warn('[x.bg] 调度一轮抛错', err);
    });
  }, tickMs);
  timer.unref?.();
  console.log('[x.bg] 后台采集节奏控制器已启动');
}

/** ⭐ 停。**必须**在 before-quit 被调到。 */
export function stopBgRunner(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}

/** 测试用:清运行锁 */
export function _resetBgRunner(): void {
  stopBgRunner();
  runningWs.clear();
}
