/**
 * ⭐⭐⭐ 关注队列(2026-10-16,蓝V互关 M4)—— 主进程,按 ws 各一条
 *
 * 用户 10-16:关注用方案 b「你在候选列表里勾一批,程序按节奏慢慢关」,「这个方案可以,后面再自动化」。
 * 红线已取消(10-10),但保护是前提(记忆 project-x-write-redline-cancelled):
 *  ① 节奏:每日上限 + 最小间隔 + 随机加(都是人可调的设置)
 *  ② 异常即停:任何一个没关成(找不到按钮 / 按钮没变 / 认不出号 …)→ 整条队列暂停,等人看
 *  ③ 每个动作留只追加记录(x_action_log,decided_by = human:人勾的)
 *  ④ 执行后核对:按钮真的变成 Following 才算成,并把关系写成「我关注他」(source follow-action)
 * ⚠️ X 网页忙(操作台采集 / 认号 / 后台采集)就让路,不抢页面。
 * ⚠️ 队列在内存(重启即空,人重新勾)—— 已关注的都在动作记录里,不会丢账。
 */
import { webviewPorts } from './x-collect-ports';
import { X_SCRIPTS } from './x-dom-scripts';
import { X_PAGE_NAME } from './x-pages';
import { getXHostBusy, getXHostState, setXHostBusy } from './x-host-registry';
import { bgRunningOn } from './x-bg-runner';
import { accountForWrite } from './x-account-repo';
import { appendAction, readFollowGate } from './x-ops-actions-repo';
import { localDayStart } from './x-ops-settings';
import { writeRelations } from './x-user-repo';

export type FollowItem = { readonly restId: string; readonly handle: string; readonly reason?: string };
export type FollowDone = {
  readonly restId: string; readonly handle: string; readonly at: string;
  readonly state: 'followed' | 'already-following' | 'failed'; readonly detail?: string;
};
type Queue = { items: FollowItem[]; done: FollowDone[]; current?: FollowItem; paused?: string; nextAt: number; note?: string };

const BUSY = '任务:正在关注';
const queues = new Map<string, Queue>();
let timer: NodeJS.Timeout | null = null;
let ticking = false;

const q = (ws: string): Queue => {
  let x = queues.get(ws);
  if (!x) { x = { items: [], done: [], nextAt: 0 }; queues.set(ws, x); }
  return x;
};

/** 人勾的一批进队列(去重:已在队列里 / 正在关的不重复进) */
export function addToFollowQueue(ws: string, items: readonly FollowItem[]): { added: number; skipped: number } {
  const x = q(ws);
  const have = new Set([...x.items.map((i) => i.restId), x.current?.restId].filter(Boolean));
  let added = 0;
  for (const it of items) {
    if (!/^\d+$/.test(it.restId) || have.has(it.restId)) continue;
    x.items.push(it); have.add(it.restId); added += 1;
  }
  console.log(`[x.follow] ${ws} 队列加入 ${added} 人(跳过 ${items.length - added})`);
  return { added, skipped: items.length - added };
}

export function controlFollowQueue(ws: string, action: 'pause' | 'resume' | 'clear'): void {
  const x = q(ws);
  if (action === 'pause') x.paused = '你点了暂停';
  if (action === 'resume') { x.paused = undefined; x.note = undefined; x.nextAt = 0; }
  if (action === 'clear') { x.items = []; }
}

export function followQueueStatus(ws: string): {
  waiting: number; next: readonly FollowItem[]; current?: FollowItem; paused?: string; note?: string;
  nextAt: number; done: readonly FollowDone[]; now: number;
} {
  const x = q(ws);
  return { waiting: x.items.length, next: x.items.slice(0, 10), current: x.current, paused: x.paused, note: x.note,
    nextAt: x.nextAt, done: x.done.slice(-30).reverse(), now: Date.now() };
}

async function step(ws: string, x: Queue): Promise<void> {
  const wcId = getXHostState(ws)?.wcId;
  if (wcId === undefined) { x.note = 'X 网页没开 —— 等它打开'; return; }
  const busy = getXHostBusy(wcId);
  if (busy !== null) { x.note = `让路:${busy}`; return; }
  const bg = bgRunningOn(wcId);
  if (bg !== null) { x.note = `让路:后台在采 @${bg.handle}`; return; }
  const gate = await readFollowGate(localDayStart(new Date()).toISOString());
  if (!gate.allowed) {
    if (gate.waitSec !== undefined) { x.nextAt = Date.now() + gate.waitSec * 1000; x.note = gate.reason; }
    else { x.paused = gate.reason; }
    return;
  }
  const account = await accountForWrite(wcId);
  if (account.kind !== 'ok') { x.paused = `认不出登录的号:${account.reason} —— 已暂停`; return; }

  const item = x.items.shift()!;
  x.current = item; x.note = undefined;
  setXHostBusy(wcId, BUSY);
  const ports = webviewPorts(wcId);
  let state: FollowDone['state'] = 'failed';
  let detail: string | undefined;
  try {
    const go = await ports.goto(X_PAGE_NAME.profile, { handle: item.handle });
    if (!go.ok) detail = `去不到他的主页:${go.reason}`;
    else {
      const r = (await ports.runScript(X_SCRIPTS.follow, { restId: item.restId })) as { state?: string; why?: string } | null;
      if (r?.state === 'followed') state = 'followed';
      else if (r?.state === 'already-following') state = 'already-following';
      else detail = `关注没成:${r?.state ?? '无返回'}${r?.why ? `(${r.why})` : ''}`;
    }
  } catch (e) {
    detail = `关注出错:${e instanceof Error ? e.message : String(e)}`;
  } finally {
    setXHostBusy(wcId, null);
    x.current = undefined;
  }
  const at = new Date().toISOString();
  if (state === 'followed' || state === 'already-following') {
    /** ⭐ 执行后核对:按钮已变 Following = 我关注他 —— 写进这个号的关系(变化表会记一条) */
    await writeRelations(account, [{ person: item.restId, iFollow: true, observedAt: at }], 'follow-action');
  }
  if (state !== 'already-following') {
    await appendAction({
      action: 'follow', targetRestId: item.restId, targetHandle: item.handle, decidedBy: 'human',
      result: state === 'followed' ? 'ok' : 'failed', reason: item.reason, detail, wsId: ws,
    });
  }
  x.done.push({ restId: item.restId, handle: item.handle, at, state, detail });
  console.log(`[x.follow] ${ws} @${item.handle} → ${state}${detail ? `:${detail}` : ''}`);
  if (state === 'failed') {
    /** ② 异常即停 —— 不往下关,等人看 */
    x.paused = `@${item.handle} ${detail ?? '没关成'} —— 已暂停(异常即停),看过再点继续`;
    return;
  }
  const gap = gate.settings['follow.min_gap_sec'] + Math.random() * gate.settings['follow.jitter_sec'];
  x.nextAt = Date.now() + Math.round(gap * 1000);
}

export async function followQueueTick(): Promise<void> {
  if (ticking) return;
  ticking = true;
  try {
    for (const [ws, x] of queues) {
      if (x.paused || x.current || x.items.length === 0 || Date.now() < x.nextAt) continue;
      try { await step(ws, x); } catch (e) {
        x.paused = `队列出错:${e instanceof Error ? e.message : String(e)} —— 已暂停`;
        console.error('[x.follow]', e);
      }
    }
  } finally { ticking = false; }
}

/** X 模块启动时调;before-quit 停(记忆 project-graceful-shutdown) */
export function startFollowQueue(): void {
  if (timer) return;
  timer = setInterval(() => { void followQueueTick(); }, 2000);
  timer.unref?.();
}
export function stopFollowQueue(): void { if (timer) { clearInterval(timer); timer = null; } }
