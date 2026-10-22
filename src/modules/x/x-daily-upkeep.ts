/**
 * ⭐⭐ 每天自动的两件事 —— 先查回关,再给我自己的号跑一次关系采集(2026-10-21)
 *
 * · 查回关(用户 10-19 选「每天自动一次」):x-follow-check.ts
 * · 关系采集(用户 10-21「按照顺序做吧」第 1 件):每天顺带翻「我的关注」等三个名单(通常各一两页增量),
 *   候选里在 X 上直接关注过的人第二天就自动清掉;差得多会自己改全量并对账(策略同任务页)。
 * · 采互动(10-22,蓝V互关第 3 件事):小段多次 —— 最近 7 天没采全每 15 分钟一段,采全后每 3 小时补新的;
 *   按搜索额度账本避开限流,撞了 15 分钟后自动接着采(策略见 x-engage.ts nextEngageRun)
 * 一个 X 网页一次只做一件:这一轮做了一件就收手,10 分钟后再看下一件。忙 / 后台在采 → 各自让路。
 * ⚠️ 常驻 timer:unref + before-quit 必须调 stopDailyUpkeep(记忆 project-graceful-shutdown)
 */
import { listXHostStates } from './x-host-registry';
import { readWsAccount } from './x-account-repo';
import { checkFollowBack, followCheckRunning } from './x-follow-check';
import { readLastFollowCheck } from './x-follow-check-repo';
import { followCheckDue } from './x-follow-back';
import { listRelationJobs, startRelationTask } from './x-relation-task';
import { relationDailyDue } from './x-relation-plan';
import { collectEngagement } from './x-engage-collect';
import { readEngageCoverage } from './x-engage-repo';
import { engageCollectDue } from './x-engage';
import { searchBudget } from './x-search-budget';

const TICK_MS = 10 * 60_000;
let timer: NodeJS.Timeout | null = null;
let ticking = false;

export async function dailyUpkeepTick(now = Date.now()): Promise<string | null> {
  if (ticking || followCheckRunning() !== null) return null;
  ticking = true;
  try {
    for (const [wsId] of listXHostStates()) {
      const acc = await readWsAccount(wsId);
      if (!acc?.restId) continue;
      if (followCheckDue(await readLastFollowCheck(acc.restId), now)) {
        const r = await checkFollowBack(wsId, 'auto');
        if (!r.ran) console.log(`[x.daily] ${wsId} 查回关到点了但没查:${r.why}(${TICK_MS / 60_000} 分钟后再看)`);
        return `follow-check:${wsId}`;
      }
      const mine = (await listRelationJobs(wsId)).filter((j) => j.self);
      if (relationDailyDue(mine, now)) {
        const r = await startRelationTask(wsId, undefined, 'auto');
        console.log(`[x.daily] ${wsId} 每天的关系采集:${r.ok ? `已开始(任务 ${r.jobId})` : `没开始:${r.why}(${TICK_MS / 60_000} 分钟后再看)`}`);
        return `relation:${wsId}`;
      }
      if (engageCollectDue(await readEngageCoverage(acc.handle), now, searchBudget(now))) {
        const r = await collectEngagement(wsId);
        console.log(`[x.daily] ${wsId} 采互动一段:${r.ok ? `${r.runs.map((x) => `${x.label} ${x.tweets} 条${x.problem ? `(${x.problem})` : ''}`).join(' · ')}${r.note ? ` · ${r.note}` : ''}` : r.why}`);
        return `engage:${wsId}`;
      }
    }
    return null;
  } finally {
    ticking = false;
  }
}

export function startDailyUpkeep(): void {
  if (timer) return;
  timer = setInterval(() => { void dailyUpkeepTick().catch((e) => console.error('[x.daily] 定时检查出错:', e)); }, TICK_MS);
  timer.unref?.();
}

export function stopDailyUpkeep(): void {
  if (timer) { clearInterval(timer); timer = null; }
}
