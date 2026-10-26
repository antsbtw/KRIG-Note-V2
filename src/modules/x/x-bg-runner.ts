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
 * 3. **你在手动操作该 ws 时让路**:`isDue` 看 wsBusy(X 网页有没有人占着,x-page-lock);
 *    开跑时自己也占住这个网页 —— 别人(查回关 / 卡片准备 / 操作台)申请会被拒,不用再单独问「后台在不在采」。
 * 4. 失败即停:一段 failed → job 标 failed 留原因,不自动重试(异常即停铁律)。
 */

import { getXHostState } from './x-host-registry';
import { pageBusy } from './x-page-lock';
import { execute } from '@platform/main/capability/capability';
import { activeJobsForWs, wsWithActiveJobs, readJob, saveJob } from './x-bg-job-repo';
import { BG_LIST_TABS, describeProgress, isDue, kindOf, nextTab, type BgJob, type BgListTab } from './x-bg-job';
import { readPace as readPaceState, recordPaceOutcome } from './x-pace-repo';
import { isRateLimited, type PaceKey } from './x-pace';
import { collectPersonListSegment } from './x-person-list-collect';
import { runSegment, type SegmentDeps, type RunOneResult } from './x-bg-segment';
import { collectPersonTab, personCollectProgress } from './x-person-collect';
import { saveTweetBatch } from './x-save-batch';
import { rangeStart, worthReloadRetry } from './x-person-timeline';
import { traceRecorder } from '@platform/main/web-capability/wiring/runtime';

/** 默认节奏(都可被 x_setting 覆盖) */
const DEFAULTS = {
  /** timer 多久醒一次(毫秒)—— 醒来挑到期任务 */
  tickMs: 120_000,
  /** ⚠️ 每段页数 / 段间隔不在这里了:由节奏自调(x_pace)按限流情况定,2026-10-20 */
};

let timer: ReturnType<typeof setInterval> | null = null;
/** ⭐ 同 ws 串行:正在跑一段的 ws 锁在这里,下一轮 tick 跳过它 */
const runningWs = new Set<string>();
/**
 * ⭐⭐ 「此刻」状态 —— 给运营顶栏 / 人卡的「在不在跑」提示(用户 10-14:「应该有一个任务是否在执行的提示,
 * 否则都不知道是否已经启动任务」)。
 * ⚠️ 库里的 status=running 只表示「跑过至少一段」,**不是**「这一刻在采」—— 这一刻只有 runner 知道。
 */
type LiveSeg = { jobId: string; handle: string; range: string; wcId: number; startedAt: number; msg: string };
const liveByWs = new Map<string, LiveSeg>();
/** 每个 ws 上一轮为什么没跑(有活跃任务时才记) */
const waitNoteByWs = new Map<string, string>();
let nextTickAt: number | null = null;

export type BgRunnerStatus = {
  readonly live: (LiveSeg & { readonly pageMsg?: string }) | null;
  /** 有任务却没在跑的原因;null = 没记(空闲或正在跑) */
  readonly waitNote: string | null;
  /** 下一次醒来的时刻(ms);runner 没启动为 null */
  readonly nextTickAt: number | null;
};

export function bgRunnerStatus(wsId: string): BgRunnerStatus {
  const l = liveByWs.get(wsId);
  return {
    live: l ? { ...l, pageMsg: personCollectProgress(l.wcId)?.msg } : null,
    waitNote: waitNoteByWs.get(wsId) ?? null,
    nextTickAt,
  };
}

/**
 * ⭐⭐ 节奏由 AI 自调(2026-10-20,用户:「这些是配置项,没有必要用户做配置,而是AI执行这些任务时自我优化就可以了。
 * 根据限流出现的不同来调整这些参数。」)—— 每种接口一份(x_pace),撞限流放慢、连续顺利加快。
 * 这个任务下一段要采的是哪种接口:名单任务按下一个名单,推文任务统一 timeline。
 */
export function paceKeyOf(job: BgJob): PaceKey {
  if (kindOf(job) !== 'lists') return 'timeline';
  const t = nextTab(job);
  return t === 'following' ? 'list:following' : t === 'verifiedFollowers' ? 'list:verifiedFollowers' : 'list:followers';
}

/**
 * ⭐⭐ runner 用的 SegmentDeps —— 把真采集(collectPersonTab)+ 存库 组装成 RunOneResult。
 *
 * ⚠️ `collectPersonTab` 只采不存(与人卡同一份);存库是调用方的事,这里主进程直接调 saveTweets。
 * `saved` 要等存完才知道,所以组装在这里而不在 collectOnWebview 里。
 */
export function makeSegmentDeps(wcId: number, job: BgJob, now: Date): SegmentDeps {
  const progress = (m: string): void => {
    const l = liveByWs.get(job.wsId);
    if (l && l.jobId === job.id) l.msg = m;
    traceRecorder.lifecycle({
      layer: 'web.net', event: 'x-bg-progress', pageId: 'x-bg',
      detail: { jobId: job.id, handle: job.handle, range: job.range, msg: m },
    });
  };
  return {
    async runOne(input) {
      /** ⭐ 名单任务(2026-10-19):他的 followers / following / verified followers —— 另一个采集器 */
      if (kindOf(job) === 'lists') {
        if (!(BG_LIST_TABS as readonly string[]).includes(input.tab)) {
          const why = `名单任务拿到了不是名单的标签页 ${input.tab}`;
          return { pages: 0, saved: 0, exhausted: false, stopReason: why, failure: why } satisfies RunOneResult;
        }
        const list = input.tab as BgListTab;
        const once = (): Promise<RunOneResult> => collectPersonListSegment({
          wcId, page: input.page, list, handle: input.handle, ownerRestId: job.restId,
          pageCap: input.pageCap, resumeCursor: input.resumeCursor, onProgress: progress,
          plan: job.plan?.tabs[list], self: job.self === true, startedAt: job.createdAt,
        });
        /**
         * ⭐⭐ 与推文任务同一条规矩:第一轮翻页就没带鉴权头 → 重载这一页再试一次(判据 worthReloadRetry 同一份)。
         * 2026-10-20 真机:关注者全量翻到第 94 页撞上它,名单任务漏了这一步 → 一次就判失败。
         */
        const first = await once();
        if (first.failure === undefined || !worthReloadRetry(first.stopReason, first.pages)) return first;
        progress(`第一轮翻页没带鉴权头 —— 重载这一页再试一次(${first.stopReason})`);
        const second = await once();
        if (second.failure !== undefined) return { ...second, failure: `[重载后第 2 次仍失败] ${second.failure}` };
        progress('重载后第 2 次成功');
        return { ...second, saved: second.saved + first.saved };
      }
      const start = rangeStart(job.range, now);
      let pages = 0;
      let saved = 0;
      /**
       * ⭐⭐ 最多两次(用户 2026-10-15 选 A:「像人卡一样重载这一页再试一次,还不行再停」)。
       * 第一轮翻页就没带鉴权头 → 重载这一页(collectPersonTab 每次都重新 goto)再试;
       * 判据与人卡同一份(worthReloadRetry)。第一次采到的照样存(推文幂等)。
       * ⚠️ 第二次还不行 → 照旧标 failure 停整个任务(异常即停),不无限重试。
       */
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        const r = await collectPersonTab({
          wcId,
          page: input.page,
          handle: input.handle,
          restId: job.restId,
          start: start?.toISOString(),
          pageCap: input.pageCap,
          attempt,
          /** ⭐⭐ 断点 —— 不传就每段从第一页重翻(2026-10-14 真机:30 页没往后走一步) */
          resumeCursor: input.resumeCursor,
        });
        if (!r.reached) {
          // 没去到页 = 这一段失败(不碰断点,等下个窗口重试或人看)
          return { pages, saved, exhausted: false, stopReason: r.reason, failure: r.reason } satisfies RunOneResult;
        }
        /**
         * ⭐⭐ 逐页账有一页对不上(重采后仍不对)= 这一段失败,停下等人看(异常即停,2026-10-16)。
         * 已对上的页已经存了;断点不动,下次从对不上那页重采。
         */
        if (r.ledgerProblem !== undefined) {
          return { pages, saved: saved + r.pageInserted, exhausted: false, stopReason: r.ledgerProblem, failure: r.ledgerProblem } satisfies RunOneResult;
        }
        // 存库(主进程直接调 repo;source=页名,与人卡一致)
        if (r.records.length > 0) {
          try {
            /**
             * ⚠️ 每页已经先存过(逐页账,2026-10-16),这里整批再存一次(幂等,补齐长文正文等)——
             * 「新增」要算每页累计的,否则这里恒为 0。
             */
            /** 存推一份(x-save-batch:作者 / 留痕 / 记账;原来整批补存不记账,补出来的新增对不上账) */
            const sv = await saveTweetBatch([...r.records], { source: input.page });
            saved += r.pageInserted + sv.inserted;
          } catch (e) {
            // 采到了却存不进 = 这一段失败,断点不动(下次重采这一段,推文幂等)
            const why = `存库失败:${e instanceof Error ? e.message : String(e)}`;
            return { pages, saved, exhausted: false, stopReason: why, failure: why } satisfies RunOneResult;
          }
        }
        const rounds = r.paging?.rounds ?? 0;
        pages += rounds;
        const stopReason = r.paging?.stopReason ?? '';
        if (attempt === 1 && worthReloadRetry(stopReason, rounds)) {
          progress(`第一轮翻页没带鉴权头 —— 重载这一页再试一次(${stopReason})`);
          continue;
        }
        /**
         * ⚠️ 失败判据:403/限流这类「扛不住了」→ failure(停整个任务,等人看)。
         * 「到起点 / X 到头 / 页数上限」都是正常停,不是 failure。
         * 403 现在的失败语是「没带鉴权头」(见 project-x-paging-403-root-cause),一并认。
         */
        /**
         * ⭐ 2026-10-20 起限流不算失败:保住断点、交给节奏自调放慢(用户:「根据限流出现的不同来调整这些参数」)。
         * 没带鉴权头 / 403 仍是失败(那不是快慢的问题)。
         */
        const limited = isRateLimited(stopReason);
        const failed = !limited && /403|没带鉴权头/.test(stopReason)
          ? `${attempt > 1 ? '[重载后第 2 次仍失败] ' : ''}${stopReason}` : undefined;
        if (attempt > 1 && !failed) progress('重载后第 2 次成功');
        return {
          pages,
          saved,
          nextCursor: r.nextCursor ?? (limited ? input.resumeCursor : undefined),
          note: limited ? '被限流 —— 这一段停在这里,节奏自动放慢,歇够了从断点接着翻' : undefined,
          exhausted: r.exhausted,
          stopReason,
          /** ⭐ 翻页前沿(最后一页他自己最新那条),不是这一段最新/最旧一条 —— 见 collectOnWebview */
          oldestAt: r.frontierAt,
          failure: failed,
        } satisfies RunOneResult;
      }
      // 走不到这里(第二次一定 return);fail loud 而不是静默当成功
      const why = '重试循环异常退出';
      return { pages, saved, exhausted: false, stopReason: why, failure: why } satisfies RunOneResult;
    },
    onProgress: progress,
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
  /** 不给 = 生产那条:调能力 x.bg.segment(执行器占锁 / 记一行) */
  drive: (wsId: string, wcId: number, job: BgJob) => Promise<void> = driveViaExecutor,
  now: Date = new Date(),
): Promise<void> {
  const wss = await wsWithActiveJobs();
  for (const ws of [...waitNoteByWs.keys()]) if (!wss.includes(ws)) waitNoteByWs.delete(ws);
  for (const wsId of wss) {
    if (runningWs.has(wsId)) continue; // 同 ws 串行
    const host = getXHostState(wsId);
    if (!host) {
      // 这个 ws 没开 X 网页 —— 没法采,等它开。⚠️ 说出来:有任务却不动,人要看得见为什么
      console.log(`[x.bg] ${wsId} 有后台任务,但这个号的 X 网页没开 —— 等它开`);
      waitNoteByWs.set(wsId, '这个号的 X 网页没开,等它开');
      continue;
    }
    const busyBy = pageBusy(host.wcId);
    const wsBusy = busyBy !== null;
    const jobs = await activeJobsForWs(wsId);
    // 挑第一个到期的
    const gaps = new Map<string, number>();
    for (const j of jobs) gaps.set(j.id, (await readPaceState(paceKeyOf(j))).gapSec);
    const due = jobs.find((j) => isDue(j, { now, wsBusy, segmentGapSec: gaps.get(j.id) ?? 120 }).due);
    if (!due) {
      if (wsBusy && jobs.length > 0) console.log(`[x.bg] ${wsId} 让路:X 网页正忙(${busyBy})`);
      const first = jobs[0];
      if (first) waitNoteByWs.set(wsId, isDue(first, { now, wsBusy, segmentGapSec: gaps.get(first.id) ?? 120 }).why);
      continue;
    }
    /**
     * ⭐⭐ 占网页归执行器(Module5-04 收尾,2026-10-26):drive 默认调能力 x.bg.segment,执行器占锁 / 记一行;
     * 查完 isDue 到执行器占锁之间被人抢了 → 执行器 refused,这一轮让路(drive 里记下原因)
     */
    console.log(`[x.bg] ${wsId} 开跑一段:@${due.handle} ${due.range}(${due.id})`);
    runningWs.add(wsId);
    waitNoteByWs.delete(wsId);
    liveByWs.set(wsId, { jobId: due.id, handle: due.handle, range: due.range, wcId: host.wcId, startedAt: Date.now(), msg: '开始这一段…' });
    try {
      await drive(wsId, host.wcId, due);
    } finally {
      runningWs.delete(wsId);
      liveByWs.delete(wsId);
    }
  }
}

/**
 * ⭐ 体检探针(黑匣子 2026-10-16):后台此刻在采谁 / 各号在等什么 / 下次醒来还有几秒。
 * 卡死复盘时看「卡住那一刻后台在干什么」。纯读内存态。
 */
export function bgRunnerHealth(): Record<string, unknown> {
  return {
    running: [...liveByWs.entries()].map(([ws, l]) => ({ ws, handle: l.handle, range: l.range, sinceSec: Math.round((Date.now() - l.startedAt) / 1000), msg: l.msg.slice(0, 80) })),
    waiting: Object.fromEntries(waitNoteByWs),
    nextTickInSec: nextTickAt === null ? null : Math.round((nextTickAt - Date.now()) / 1000),
  };
}

/**
 * ⭐ tickOnce 的默认 drive(生产用):只「到点调一下」—— 占锁、记执行记录、结果格式归执行器(能力 x.bg.segment)。
 * 被拒(网页刚被人占了 / 任务刚被暂停)= 这一轮让路,原因写给人看。
 */
async function driveViaExecutor(wsId: string, _wcId: number, job: BgJob): Promise<void> {
  const r = await execute('x.bg.segment', { wsId, jobId: job.id, handle: job.handle }, { caller: 'timer' });
  if (r.ok) return;
  console.log(`[x.bg] ${wsId} @${job.handle} 这一段没跑${r.kind === 'refused' ? '(让路)' : ''}:${r.why}`);
  waitNoteByWs.set(wsId, `${r.kind === 'refused' ? '让路' : '这一段没跑成'}:${r.why}`);
}

/**
 * 真正跑一段 + 存回库 —— 能力 x.bg.segment 的 run(网页已由执行器占着)。
 * 返回这一段之后的进度(人看的那句);saved = false 表示人在这期间暂停 / 取消了,断点没存。
 */
export async function driveSegment(_wsId: string, wcId: number, job: BgJob): Promise<{ saved: boolean; progress: string }> {
  const now = new Date();
  const key = paceKeyOf(job);
  const pace = await readPaceState(key);
  const deps = makeSegmentDeps(wcId, job, now);
  let report = await runSegment(job, deps, pace.pages, now);
  /**
   * ⭐ 这一段顺利 / 被限流 → 节奏自调;失败(没带鉴权头、对不上 …)不算节奏的事,不调。
   * 已经最慢还被限流 → 举手:任务停下,原因写清楚。
   */
  if (report.job.status !== 'failed') {
    const limited = /限流/.test(report.job.lastError ?? '');
    const d = await recordPaceOutcome(key, limited ? 'limited' : 'ok', new Date());
    if (d.giveUp) report = { ...report, job: { ...report.job, status: 'failed', lastError: d.giveUp } };
  }
  // ⚠️ 重新读一遍再存?不:runSegment 返回的是基于传入 job 的新状态,直接存。
  // 但人可能在这期间暂停/取消了 —— 存前查一下当前状态,别把「已取消」覆盖回 running。
  const fresh = await readJob(job.id);
  if (fresh === null) { console.log(`[x.bg] 一段跑完,但任务 ${job.id} 已被取消 —— 不存断点`); return { saved: false, progress: '任务已被取消,断点没存' }; }
  if (fresh.status === 'paused') { console.log(`[x.bg] 一段跑完,但任务 ${job.id} 已暂停 —— 不覆盖`); return { saved: false, progress: '任务已暂停,没覆盖' }; }
  await saveJob(report.job);
  /** ⭐ 人看的那块屏:每段结束一行(第几页/存了几条/停在哪) */
  const progress = describeProgress(report.job);
  console.log(`[x.bg] 一段结束 @${job.handle}:${progress}`);
  return { saved: true, progress };
}

/**
 * 启动节奏控制器。⚠️ 幂等。调用方**必须**在 before-quit 调 stopBgRunner(常驻 timer 铁律)。
 */
let tickEvery = DEFAULTS.tickMs;

function runTick(): void {
  nextTickAt = Date.now() + tickEvery;
  void tickOnce().catch((err) => {
    // 调度自己抛错不许拖垮进程,但必须留痕
    console.warn('[x.bg] 调度一轮抛错', err);
  });
}

export function startBgRunner(tickMs = DEFAULTS.tickMs): void {
  if (timer) return;
  tickEvery = tickMs;
  nextTickAt = Date.now() + tickMs;
  timer = setInterval(runTick, tickMs);
  timer.unref?.();
  console.log('[x.bg] 后台采集节奏控制器已启动');
}

/** ⭐ 停。**必须**在 before-quit 被调到。 */
export function stopBgRunner(): void {
  if (kick) { clearTimeout(kick); kick = null; }
  if (!timer) return;
  clearInterval(timer);
  timer = null;
  nextTickAt = null;
}

/**
 * ⭐ 建任务 / 恢复后**马上**看一次(几秒后),不干等到下一个 120 秒窗口 ——
 * 用户 10-14:建了不知道启动没有。节奏不受影响:到不到期仍由 isDue(段间隔)判,同 ws 仍串行。
 * ⚠️ 连点只排一次;runner 没启动(测试 / 退出中)就不排。
 */
let kick: ReturnType<typeof setTimeout> | null = null;
export function kickBgRunner(delayMs = 3000): void {
  if (!timer || kick) return;
  kick = setTimeout(() => { kick = null; void tickOnce().catch((err) => console.warn('[x.bg] 调度一轮抛错', err)); }, delayMs);
  kick.unref?.();
}

/** 测试用:清运行锁 */
export function _resetBgRunner(): void {
  stopBgRunner();
  runningWs.clear();
  liveByWs.clear();
  waitNoteByWs.clear();
}
