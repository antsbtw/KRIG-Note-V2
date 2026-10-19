/**
 * ⭐ 取关一个人 / 读他主页核对关系 —— renderer 侧共用(2026-10-19 从 XOpsPeople 抽出)
 *
 * 为什么抽:第 4 阶段任务页的「满 N 天没回关」名单要直接给「取关」按钮(用户 10-19 选),
 * 取关的保护(每日上限 / 间隔闸门 → 让路 → 去主页 → 点 → 等按钮变回 → 记动作)只许有一份。
 * 运营人卡和任务页都调这里;各自的界面状态(暂停、提示、列表移行)留在各自组件里。
 */
import { xDataCall } from './x-data-types';
import { X_NOISY_URLS, X_PAGE_NAME } from './x-pages';
import { getXHostBusy, setXHostBusy } from './x-host-registry';
import { auditUserPayload, type XUserRecord } from './x-user-audit';
import { PROFILE_ENDPOINT, pickProfileUser } from './x-person-refresh';
import { X_SCRIPTS } from './x-dom-scripts';
import { localDayStart, type UnfollowGate } from './x-ops-settings';

export type Who = { readonly rest_id: string; readonly handle: string };

/**
 * ⭐ X 网页现在能不能被我们跳走 —— 三处的「忙」都问:
 * renderer 自己登记的 · 主进程登记的(查回关 / 关注队列 / 求关;登记表每进程一份)· 后台采集。
 * @param own 自己登记的那个忙不算(核对中再核对)
 */
export async function xPageBusy(wcId: number, own?: string): Promise<string | null> {
  const local = getXHostBusy(wcId);
  if (local !== null && local !== own) return local;
  const main = await xDataCall({ op: 'mainBusy', wcId });
  if (main.status === 'ok' && typeof main.value === 'string' && main.value !== own) return main.value;
  const bg = await xDataCall({ op: 'bgBusy', wcId });
  if (bg.status !== 'ok') return `问不到后台状态(${bg.reason})`;
  const v = bg.value as { handle: string } | null;
  return v ? `后台正在采 @${v.handle}(可在人卡暂停)` : null;
}

export const UNFOLLOW_STATE_TEXT: Readonly<Record<string, string>> = {
  'not-following': '本来就没关注他', 'no-button': '页面上找不到他的关注按钮', 'no-confirm': '确认框没出来',
  'no-switch': '点了确认,按钮没变回 Follow', 'bad-id': '数字 id 不对', error: '脚本出错',
};

export type UnfollowOutcome =
  | { readonly blocked: string; readonly gate?: UnfollowGate }
  | { readonly done: boolean; readonly state: string; readonly detail?: string; readonly gate: UnfollowGate };

/**
 * ⭐⭐ 取关一个人:闸门 → 让路 → 去他主页 → 点 Following → 确认 → 等按钮变回 Follow → 记动作(成败都记)。
 * ⚠️ 不做「异常即停」的暂停 —— 那是调用方的界面状态;本函数只如实回结果。
 */
export async function unfollowOnce(p: Who, wcId: number, busyLabel: string, reason?: string, wsId?: string): Promise<UnfollowOutcome> {
  const busy = await xPageBusy(wcId);
  if (busy !== null) return { blocked: `${busy},先等它结束` };
  const g = await xDataCall({ op: 'unfollowGate', dayStartIso: localDayStart(new Date()).toISOString() });
  if (g.status === 'failed') return { blocked: g.reason };
  const gate = g.value as UnfollowGate;
  if (!gate.allowed) return { blocked: `没取关:${gate.reason}`, gate };

  setXHostBusy(wcId, busyLabel);
  let result: { done: boolean; state: string; why?: string } = { done: false, state: 'error' };
  try {
    const go = await window.electronAPI!.webDomInvoke({ op: 'goto', pageRef: { wcId }, name: X_PAGE_NAME.profile, params: { handle: p.handle } });
    if (go.status === 'failed') {
      result = { done: false, state: 'error', why: `没去到他的主页:${go.reason ?? ''}` };
    } else {
      const r = await window.electronAPI!.webDomInvoke({ op: 'run', pageRef: { wcId }, scriptId: X_SCRIPTS.unfollow, params: { restId: p.rest_id } });
      result = r.status === 'failed' ? { done: false, state: 'error', why: r.reason ?? '' } : (r.value as { done: boolean; state: string; why?: string });
    }
  } catch (e) {
    result = { done: false, state: 'error', why: e instanceof Error ? e.message : String(e) };
  } finally {
    setXHostBusy(wcId, null);
  }
  const detail = result.done ? undefined : `${UNFOLLOW_STATE_TEXT[result.state] ?? result.state}${result.why ? `:${result.why}` : ''}`;
  await xDataCall({
    op: 'logAction',
    entry: { action: 'unfollow', targetRestId: p.rest_id, targetHandle: p.handle, decidedBy: 'human', result: result.done ? 'ok' : 'failed', detail, reason, wsId },
  });
  return { done: result.done, state: result.state, detail, gate };
}

export type VerifyOutcome =
  | { readonly kind: 'miss'; readonly text: string }
  | { readonly kind: 'same' | 'changed' | 'new'; readonly text: string; readonly rec: XUserRecord; readonly changes: readonly string[] };

/**
 * ⭐ 去他主页读资料,把关系写回库(按这个 X 网页登录的号)。调用方负责「忙」的登记与让路。
 */
export async function readProfileAndRefresh(p: Who, wcId: number): Promise<VerifyOutcome> {
  try {
    const h = await window.electronAPI!.webDomInvoke({
      op: 'harvest', pageRef: { wcId },
      plan: {
        gotoPage: { name: X_PAGE_NAME.profile, params: { handle: p.handle } },
        /** 只等主页资料那一条;来了就停,最多 3 轮、10 秒 */
        pageUrlIncludes: [PROFILE_ENDPOINT], wantPages: 1, maxRounds: 3, maxMs: 10_000,
        noisyUrlSubstrings: X_NOISY_URLS,
      },
    });
    if (h.status === 'failed') return { kind: 'miss', text: `没读到:${h.reason ?? '原因未知'}` };
    const rep = h.value as { items?: Array<{ url: string; text: string }>; problems?: string[] };
    const items = (rep.items ?? []).filter((it) => it.url.includes(PROFILE_ENDPOINT));
    const rec = pickProfileUser(items.flatMap((it) => auditUserPayload(it.text).items), p.handle, p.rest_id);
    if (!rec) {
      const why = rep.problems?.[0];
      return { kind: 'miss', text: items.length === 0 ? `没读到(主页资料那条请求没来${why ? `:${why}` : ''})` : '没读到(载荷里找不到这个人)' };
    }
    /** ⭐ wcId:主页资料里的关系是这个 X 网页登录的号看到的(1.2.27) */
    const r = await xDataCall({ op: 'refreshPerson', record: rec, wcId });
    if (r.status === 'failed') return { kind: 'miss', text: `没写进库:${r.reason}` };
    const d = r.value as { isNew: boolean; changes: string[] };
    return d.isNew ? { kind: 'new', text: '库里没有,已补进来', rec, changes: d.changes }
      : d.changes.length > 0 ? { kind: 'changed', text: `有变化:${d.changes.join(';')}(已更新)`, rec, changes: d.changes }
        : { kind: 'same', text: '刚核对,与库里一致', rec, changes: [] };
  } catch (e) {
    return { kind: 'miss', text: `没读到:${e instanceof Error ? e.message : String(e)}` };
  }
}
