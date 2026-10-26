/**
 * ⭐⭐ 点人核对 / 取关 —— 主进程(Module5-04 第 4 步 4a,2026-10-26 从 renderer 的 x-unfollow-run.ts 搬过来)
 *
 * 原来界面自己 webDomInvoke 去主页、点按钮、再报给主进程记一笔;主进程 / 定时器 / AI 都够不着。
 * 现在只干活(…On):占网页由能力执行器做(x.person.verify / x.person.unfollow),调之前必须已经占住 wcId。
 *
 * 顺带修的两个旧问题:
 *  ① 任务页取关后的核对没占网页(取关占着,核对时锁已经放了)→ 取关和核对在同一把锁里做完
 *  ② 「异常即停」人卡和任务页各管各的(React 状态)→ 按 workspace 记在这里,两边看同一份
 */
import { webviewPorts } from './x-collect-ports';
import { X_PAGE_NAME } from './x-pages';
import { X_SCRIPTS } from './x-dom-scripts';
import type { XUserRecord } from './x-user-audit';
import { readProfileOn } from './x-person-profile';
import { writeRelations } from './x-user-repo';
import { accountForWrite } from './x-account-repo';
import type { AccountDecision } from './x-account';
import { savePersonRefresh } from './x-save-batch';
import { appendAction, readUnfollowGate } from './x-ops-actions-repo';
import { localDayStart, type UnfollowGate } from './x-ops-settings';
import { UNFOLLOW_STATE_TEXT } from './x-unfollow-text';

export type Who = { readonly restId: string; readonly handle: string };

export type VerifyOutcome =
  | { readonly kind: 'miss'; readonly text: string }
  | { readonly kind: 'same' | 'changed' | 'new'; readonly text: string; readonly rec: XUserRecord; readonly changes: readonly string[] };

/** ⭐ 去他主页读资料,把关系写回库(按这个 X 网页登录的号)。⚠️ 调之前必须已占住 wcId */
export async function verifyPersonOn(wcId: number, who: Who): Promise<VerifyOutcome> {
  const read = await readProfileOn(wcId, who);
  if (!read.ok) return { kind: 'miss', text: `没读到(${read.why})` };
  const rec = read.rec;
  try {
    /** ⭐ 主页资料里的关系是这个 X 网页登录的号看到的(1.2.27) */
    const d = await savePersonRefresh(rec, await accountForWrite(wcId));
    return d.isNew ? { kind: 'new', text: '库里没有,已补进来', rec, changes: d.changes }
      : d.changes.length > 0 ? { kind: 'changed', text: `有变化:${d.changes.join(';')}(已更新)`, rec, changes: d.changes }
        : { kind: 'same', text: '刚核对,与库里一致', rec, changes: [] };
  } catch (e) {
    return { kind: 'miss', text: `读到了但没写进库:${e instanceof Error ? e.message : String(e)}` };
  }
}

export type FollowDone = { readonly state: 'followed' | 'already-following' | 'failed'; readonly detail?: string };

/**
 * ⭐⭐ 关注一个人 —— 一份(第 5 步,2026-10-26;原来关注队列和求关卡各抄一遍):
 * 去他主页 → 点关注 → 按钮变 Following = 关上了(执行后核对)→ 写进这个号的关系 → 记动作(本来就关注的不记)。
 * 闸门 / 节奏 / 异常即停归调用方(队列等歇完、求关卡只提醒)。⚠️ 调之前必须已占住 wcId。
 */
export async function followOn(wsId: string, wcId: number, account: AccountDecision, who: Who, reason?: string): Promise<FollowDone> {
  let state: FollowDone['state'] = 'failed';
  let detail: string | undefined;
  try {
    const ports = webviewPorts(wcId);
    const go = await ports.goto(X_PAGE_NAME.profile, { handle: who.handle });
    if (!go.ok) detail = `去不到他的主页:${go.reason}`;
    else {
      const r = (await ports.runScript(X_SCRIPTS.follow, { restId: who.restId })) as { state?: string; why?: string } | null;
      if (r?.state === 'followed' || r?.state === 'already-following') state = r.state;
      else detail = `关注没成:${r?.state ?? '无返回'}${r?.why ? `(${r.why})` : ''}`;
    }
  } catch (e) {
    detail = `关注出错:${e instanceof Error ? e.message : String(e)}`;
  }
  if (state !== 'failed') {
    await writeRelations(account, [{ person: who.restId, iFollow: true, observedAt: new Date().toISOString() }], 'follow-action');
  }
  if (state !== 'already-following') {
    await appendAction({
      action: 'follow', targetRestId: who.restId, targetHandle: who.handle, decidedBy: 'human',
      result: state === 'followed' ? 'ok' : 'failed', reason, detail, wsId,
    });
  }
  console.log(`[x.follow] ${wsId} @${who.handle} → ${state}${detail ? `:${detail}` : ''}`);
  return detail === undefined ? { state } : { state, detail };
}

/** ⭐⭐ 异常即停 —— 按 workspace 一份(一次取关没成就停,人看过原因点「恢复」才继续) */
const haltByWs = new Map<string, string>();
export const unfollowHalted = (wsId: string): string | null => haltByWs.get(wsId) ?? null;
export function resumeUnfollow(wsId: string): boolean {
  const had = haltByWs.delete(wsId);
  if (had) console.log(`[x.unfollow] ${wsId} 取关已恢复(人点了恢复)`);
  return had;
}
/** 测试用 */
export function _resetUnfollowHalt(): void { haltByWs.clear(); }

export type UnfollowDone = {
  readonly done: boolean; readonly state: string; readonly detail?: string;
  readonly gate: UnfollowGate; readonly warning?: string; readonly verify?: VerifyOutcome;
};

/**
 * ⭐⭐ 取关一个人:闸门 → 去他主页 → 点 Following → 确认 → 等按钮变回 Follow → 记动作(成败都记)→ 同一把锁里核对。
 * 没成(且不是「本来就没关注」)→ 这个号的取关暂停,返回 halted 原因。⚠️ 调之前必须已占住 wcId。
 */
export async function unfollowOn(wsId: string, wcId: number, who: Who, reason?: string): Promise<UnfollowDone & { readonly halted?: string }> {
  const gate = await readUnfollowGate(localDayStart(new Date()).toISOString());
  /** ⚠️⚠️ 用户 10-21:「我的任务我自己控制,有问题提示就好了」—— 超了平时的量照做,只带提醒 */
  const warning = gate.allowed ? undefined : gate.reason;
  let result: { done: boolean; state: string; why?: string } = { done: false, state: 'error' };
  try {
    const ports = webviewPorts(wcId);
    const go = await ports.goto(X_PAGE_NAME.profile, { handle: who.handle });
    if (!go.ok) result = { done: false, state: 'error', why: `没去到他的主页:${go.reason ?? ''}` };
    else {
      const r = (await ports.runScript(X_SCRIPTS.unfollow, { restId: who.restId })) as { done?: boolean; state?: string; why?: string } | null;
      result = r ? { done: r.done === true, state: r.state ?? 'error', why: r.why } : { done: false, state: 'error', why: '脚本没返回' };
    }
  } catch (e) {
    result = { done: false, state: 'error', why: e instanceof Error ? e.message : String(e) };
  }
  const detail = result.done ? undefined : `${UNFOLLOW_STATE_TEXT[result.state] ?? result.state}${result.why ? `:${result.why}` : ''}`;
  await appendAction({
    action: 'unfollow', targetRestId: who.restId, targetHandle: who.handle, decidedBy: 'human',
    result: result.done ? 'ok' : 'failed', detail, reason, wsId,
  });
  console.log(`[x.unfollow] ${wsId} @${who.handle} → ${result.done ? '已取关' : result.state}${detail ? `(${detail})` : ''}`);
  if (result.done || result.state === 'not-following') {
    /** 执行后核对:读回他主页,确认关系真变了再写库(同一把锁里) */
    const verify = await verifyPersonOn(wcId, who);
    return { done: result.done, state: result.state, detail, gate, warning, verify };
  }
  const halted = `@${who.handle} ${detail}`;
  haltByWs.set(wsId, halted);
  console.warn(`[x.unfollow] ${wsId} ⚠️ 取关暂停:${halted} —— 要人看过原因点「恢复」`);
  return { done: false, state: result.state, detail, gate, warning, halted };
}
