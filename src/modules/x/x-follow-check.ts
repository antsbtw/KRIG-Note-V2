/**
 * ⭐⭐⭐ 查回关 —— 主进程(2026-10-19,蓝V互关求关第 4 阶段)
 *
 * 用户 10-17:「要记录关注时间,定期检查对方是否回关」;10-19 选「每天自动一次」+ 任务页「现在查」。
 *
 * 怎么查:去我自己的 followers,从第一页往下翻,每页存人(按号写关系 —— 变了自动在变化表留「他关注了我」),
 * 连续见到 N 个原来就关注我的人 = 追上上次了,停。
 * ⭐ 为什么能这样:followers 严格按关注时间倒序(09-19 真快照复算);10-19 真机:求关 14 人里回关的 10 人
 *   都在前 199 人里(第 162–198 位,正好是 10-17 求关那段)。
 * ⚠️ 前提是名单能翻页 —— 10-19 修过「只认 Bottom 的 TimelineTerminateTimeline」(原来第一页就停)。
 *
 * 保护(记忆 project-x-write-redline-cancelled;这是读操作,但占用 X 网页):
 *  · X 网页忙 / 后台在采 → 让路,不抢
 *  · 一次只跑一个;页数有上限(设置 follow.check_max_pages)
 *  · 每次都留运行记录(x_follow_check)+ 留痕;没追上 / 对不上明说,不当成「没回关」
 */
import { webviewPorts } from './x-collect-ports';
import { pageProblem } from './x-page-ledger';
import { X_PAGE_NAME } from './x-pages';
import { getXHostBusy, getXHostState, listXHostStates, setXHostBusy } from './x-host-registry';
import { bgRunningOn } from './x-bg-runner';
import { accountForWrite, readWsAccount } from './x-account-repo';
import { readSettings } from './x-ops-actions-repo';
import { existingUserIds, saveUsers } from './x-user-repo';
import { followCheckDue } from './x-follow-back';
import { scanFollowersUntilCaughtUp } from './x-follow-scan';
import { insertFollowCheck, readAskStatuses, readKnownFollowers, readLastFollowCheck } from './x-follow-check-repo';
import { traceRecorder } from '@platform/main/web-capability/wiring/runtime';

const BUSY = '任务:查回关';
let running: string | null = null;

export type FollowCheckResult =
  | { readonly ran: false; readonly why: string }
  | { readonly ran: true; readonly ok: boolean; readonly caughtUp: boolean; readonly pages: number; readonly seen: number;
      readonly newFollowers: number; readonly askedBack: readonly string[]; readonly stopReason: string; readonly problem?: string };

export function followCheckRunning(): string | null {
  return running;
}

export async function checkFollowBack(wsId: string, trigger: 'auto' | 'manual'): Promise<FollowCheckResult> {
  if (running !== null) return { ran: false, why: `正在查(${running})` };
  const wcId = getXHostState(wsId)?.wcId;
  if (wcId === undefined) return { ran: false, why: `${wsId} 的 X 网页没开` };
  const busy = getXHostBusy(wcId);
  if (busy !== null) return { ran: false, why: `X 网页正忙:${busy}` };
  const bg = bgRunningOn(wcId);
  if (bg !== null) return { ran: false, why: `后台正在采 @${bg.handle}` };
  const account = await accountForWrite(wcId);
  if (account.kind !== 'ok') return { ran: false, why: `认不出这个 X 网页登录的号:${account.reason}` };

  running = wsId;
  setXHostBusy(wcId, BUSY);
  const say = (m: string): void => console.log(`[x.follow-check] ${wsId} @${account.handle} ${m}`);
  try {
    const { settings } = await readSettings();
    const limit = settings['follow.check_known_run'];
    const maxPages = settings['follow.check_max_pages'];
    const revisit = settings['follow.revisit_days'];
    const known = await readKnownFollowers(account.restId);
    const backBefore = new Set((await readAskStatuses(account.restId, revisit)).filter((s) => s.status === 'back').map((s) => s.person));
    let saveError: string | undefined;
    say(`开始(${trigger}):已知关注者 ${known.size} 人,连续 ${limit} 个老关注者算追上,最多 ${maxPages} 页`);

    const ports = webviewPorts(wcId);
    const go = await ports.goto(X_PAGE_NAME.followers, { handle: account.handle });
    if (!go.ok) {
      const why = `没去到我的 followers:${go.reason}`;
      await record({ ok: false, caughtUp: false, pages: 0, seen: 0, newFollowers: 0, askedBack: [], stopReason: why });
      return { ran: true, ok: false, caughtUp: false, pages: 0, seen: 0, newFollowers: 0, askedBack: [], stopReason: why };
    }
    const scan = await scanFollowersUntilCaughtUp({
      harvest: ports.harvest,
      runScript: ports.runScript,
      save: async (users) => {
        const r = await saveUsers(users, { listSource: 'followers', wsId }, account);
        if (r.failed.length > 0 && saveError === undefined) saveError = `存人失败 ${r.failed.length} 个:${r.failed[0].why}`;
        return { inDb: await existingUserIds(users.map((u) => u.restId)) };
      },
    }, { known, limit, maxPages });
    const { stopReason, caughtUp, pages, tracker } = scan;
    const run = scan.run;
    const ledgerBad = (run.paging?.ledger ?? []).map(pageProblem).find((x) => x !== undefined);
    const problem = ledgerBad ?? saveError ?? (caughtUp ? undefined : `没追上(${stopReason})—— 这次没看到的人不能算「没回关」`);
    const after = await readAskStatuses(account.restId, revisit);
    const askedBack = after.filter((s) => s.status === 'back' && !backBefore.has(s.person)).map((s) => s.person);
    const res = {
      ok: problem === undefined,
      caughtUp, pages, seen: tracker.state.seen, newFollowers: tracker.state.fresh.length, askedBack, stopReason, problem,
    };
    await record(res);
    say(`${res.ok ? '✓' : '⚠️'} ${pages} 页 · 看了 ${res.seen} 人 · 新关注我 ${res.newFollowers} · 求关对象新回关 ${askedBack.length}`
      + ` · ${caughtUp ? '追上了' : '没追上'} · ${stopReason}${problem ? ` · ${problem}` : ''}`);
    return { ran: true, ...res };
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    console.error(`[x.follow-check] ${wsId} 出错:${why}`);
    try { await record({ ok: false, caughtUp: false, pages: 0, seen: 0, newFollowers: 0, askedBack: [], stopReason: `出错:${why}` }); } catch { /* 终端已打 */ }
    return { ran: false, why };
  } finally {
    setXHostBusy(wcId, null);
    running = null;
  }

  async function record(r: { ok: boolean; caughtUp: boolean; pages: number; seen: number; newFollowers: number; askedBack: readonly string[]; stopReason: string; problem?: string }): Promise<void> {
    if (account.kind !== 'ok') return;
    await insertFollowCheck({ account: account.restId, wsId, trigger, ...r });
    traceRecorder.lifecycle({ layer: 'web.net', event: r.ok ? 'x-follow-check-ok' : 'x-follow-check-incomplete', pageId: 'x-data', detail: { wsId, trigger, ...r } });
  }
}

/* ───────────────────────── 每天自动一次 ───────────────────────── */

const TICK_MS = 10 * 60_000;
let timer: NodeJS.Timeout | null = null;

async function tick(): Promise<void> {
  if (running !== null) return;
  for (const [wsId] of listXHostStates()) {
    const acc = await readWsAccount(wsId);
    if (!acc?.restId) continue;
    if (!followCheckDue(await readLastFollowCheck(acc.restId), Date.now())) continue;
    const r = await checkFollowBack(wsId, 'auto');
    if (!r.ran) console.log(`[x.follow-check] ${wsId} 到点了但没查:${r.why}(${TICK_MS / 60_000} 分钟后再看)`);
    return;
  }
}

/** ⚠️ 常驻 timer:unref + before-quit 必须调 stopFollowCheckDaily(记忆 project-graceful-shutdown) */
export function startFollowCheckDaily(): void {
  if (timer) return;
  timer = setInterval(() => { void tick().catch((e) => console.error('[x.follow-check] 定时检查出错:', e)); }, TICK_MS);
  timer.unref?.();
}

export function stopFollowCheckDaily(): void {
  if (timer) { clearInterval(timer); timer = null; }
}
