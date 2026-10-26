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
import { followCheckRunning } from './x-follow-check';
import { execute, type CapResult } from '@platform/main/capability/capability';
import { readLastFollowCheck } from './x-follow-check-repo';
import { followCheckDue } from './x-follow-back';
import { listRelationJobs } from './x-relation-task';
import { relationDailyDue } from './x-relation-plan';
import type { EngageCollectResult } from './x-engage-collect';
import type { RelationStart } from './x-relation-task';
import { readEngageCoverage } from './x-engage-repo';
import { engageCollectDue } from './x-engage';
import { searchBudget } from './x-search-budget';

const TICK_MS = 10 * 60_000;
let timer: NodeJS.Timeout | null = null;
let ticking = false;

/**
 * ⭐⭐ 每件事都走执行器(caller = timer,Module5-04 第 3 步):占网页 / 留记录和人点的一样。
 * ⚠️ 只有做了(ok)或做了没成(failed)才算「这一轮做了一件」;被拒(refused:网页被人占着 / 额度不够)
 *   原来也 return,白白占掉 10 分钟 —— 现在说一句「让路」接着看下一件(Module5-04 §1.5)。
 */
export async function dailyUpkeepTick(now = Date.now()): Promise<string | null> {
  if (ticking || followCheckRunning() !== null) return null;
  ticking = true;
  const later = `${TICK_MS / 60_000} 分钟后再看`;
  /** 做了 / 做了没成 → true(这一轮收手);被拒 / 参数不对 → false(接着看下一件) */
  const done = (wsId: string, what: string, r: CapResult<unknown>, okLine: () => string): boolean => {
    if (r.ok) { console.log(`[x.daily] ${wsId} ${what}:${okLine()}`); return true; }
    if (r.kind === 'failed') { console.warn(`[x.daily] ${wsId} ${what}没成:${r.why}(${later})`); return true; }
    if (r.kind === 'invalid') { console.error(`[x.daily] ${wsId} ${what}参数不对(代码问题):${r.why}`); return false; }
    console.log(`[x.daily] ${wsId} ${what}到点了,让路:${r.why}(接着看下一件;${later})`);
    return false;
  };
  try {
    for (const [wsId] of listXHostStates()) {
      const acc = await readWsAccount(wsId);
      if (!acc?.restId) continue;
      if (followCheckDue(await readLastFollowCheck(acc.restId), now)) {
        const r = await execute('x.followCheck.run', { wsId }, { caller: 'timer' });
        if (done(wsId, '查回关', r, () => '查完了')) return `follow-check:${wsId}`;
      }
      const mine = (await listRelationJobs(wsId)).filter((j) => j.self);
      if (relationDailyDue(mine, now)) {
        const r = await execute('x.relation.start', { wsId }, { caller: 'timer' });
        if (done(wsId, '每天的关系采集', r, () => `已开始(任务 ${(r.ok ? r.value as Extract<RelationStart, { ok: true }> : undefined)?.jobId})`)) return `relation:${wsId}`;
      }
      if (engageCollectDue(await readEngageCoverage(acc.handle), now, searchBudget(now))) {
        const r = await execute('x.engage.collect', { wsId }, { caller: 'timer' });
        if (done(wsId, '采互动一段', r, () => {
          const v = (r.ok ? r.value : undefined) as Extract<EngageCollectResult, { ok: true }> | undefined;
          return `${(v?.runs ?? []).map((x) => `${x.label} ${x.tweets} 条${x.problem ? `(${x.problem})` : ''}`).join(' · ')}${v?.note ? ` · ${v.note}` : ''}`;
        })) return `engage:${wsId}`;
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
