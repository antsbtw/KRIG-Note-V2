/**
 * ⭐ 取关一个人 / 读他主页核对关系 —— renderer 侧共用(2026-10-19 从 XOpsPeople 抽出)
 *
 * 为什么抽:第 4 阶段任务页的「满 N 天没回关」名单要直接给「取关」按钮(用户 10-19 选),
 * 取关的保护(每日上限 / 间隔闸门 → 让路 → 去主页 → 点 → 等按钮变回 → 记动作)只许有一份。
 * 运营人卡和任务页都调这里;各自的界面状态(暂停、提示、列表移行)留在各自组件里。
 */
import { xDataCall } from './x-data-types';
import { X_NOISY_URLS, X_PAGE_NAME } from './x-pages';
import { auditUserPayload, type XUserRecord } from './x-user-audit';
import { PROFILE_ENDPOINT, pickProfileUser } from './x-person-refresh';
import { X_SCRIPTS } from './x-dom-scripts';
import { localDayStart, type UnfollowGate } from './x-ops-settings';

export type Who = { readonly rest_id: string; readonly handle: string };

/**
 * ⭐ X 网页现在有没有人占着(只问,不占)—— 锁只在主进程(x-page-lock),查回关 / 关注队列 / 求关 / 后台采集 /
 * 别的界面都在那一把锁上。要真的用网页(跳转 / 采)用 `acquireXPage`,别「先问再用」(问完到用之间会被人抢)。
 */
export async function xPageBusy(wcId: number): Promise<string | null> {
  const r = await xDataCall({ op: 'pageBusy', wcId });
  if (r.status !== 'ok') return `问不到 X 网页占用状态(${r.reason})`;
  return typeof r.value === 'string' ? r.value : null;
}

/**
 * ⭐⭐⭐ 占住 X 网页(Module5-04 第 1 步)—— 拿到 token,用完在 finally 里 `releaseXPage(token)`。
 * 被占着返回 `{ ok: false, why }`(「X 网页正忙:查回关(timer,已 40 秒)」)。
 * ⚠️ renderer 不再自己写「忙」:原来 setXHostBusy 同步到主进程会覆盖 / 清掉别人的忙。
 */
export async function acquireXPage(wcId: number, purpose: string): Promise<{ ok: true; token: string } | { ok: false; why: string }> {
  const r = await xDataCall({ op: 'pageAcquire', wcId, purpose });
  if (r.status !== 'ok') return { ok: false, why: `申请不到 X 网页(${r.reason})` };
  return r.value as { ok: true; token: string } | { ok: false; why: string };
}

/** 放自己的锁;放不掉要响(不能静默 —— 说明锁已超时被收回,期间可能有人用过这个网页) */
export async function releaseXPage(token: string): Promise<void> {
  const r = await xDataCall({ op: 'pageRelease', token });
  if (r.status !== 'ok') console.error(`[x.page-lock] 放锁没成:${r.reason}`);
}

export const UNFOLLOW_STATE_TEXT: Readonly<Record<string, string>> = {
  'not-following': '本来就没关注他', 'no-button': '页面上找不到他的关注按钮', 'no-confirm': '确认框没出来',
  'no-switch': '点了确认,按钮没变回 Follow', 'bad-id': '数字 id 不对', error: '脚本出错',
};

export type UnfollowOutcome =
  | { readonly blocked: string; readonly gate?: UnfollowGate }
  | { readonly done: boolean; readonly state: string; readonly detail?: string; readonly gate: UnfollowGate; readonly warning?: string };

/**
 * ⭐⭐ 取关一个人:闸门 → 让路 → 去他主页 → 点 Following → 确认 → 等按钮变回 Follow → 记动作(成败都记)。
 * ⚠️ 不做「异常即停」的暂停 —— 那是调用方的界面状态;本函数只如实回结果。
 */
export async function unfollowOnce(p: Who, wcId: number, busyLabel: string, reason?: string, wsId?: string): Promise<UnfollowOutcome> {
  const g = await xDataCall({ op: 'unfollowGate', dayStartIso: localDayStart(new Date()).toISOString() });
  if (g.status === 'failed') return { blocked: g.reason };
  const gate = g.value as UnfollowGate;
  /** ⚠️⚠️ 用户 10-21:「我的任务我自己控制,有问题提示就好了」—— 超了平时的量照做,只带提醒 */
  const warning = gate.allowed ? undefined : gate.reason;

  const lock = await acquireXPage(wcId, busyLabel);
  if (!lock.ok) return { blocked: `${lock.why},先等它结束` };
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
    await releaseXPage(lock.token);
  }
  const detail = result.done ? undefined : `${UNFOLLOW_STATE_TEXT[result.state] ?? result.state}${result.why ? `:${result.why}` : ''}`;
  await xDataCall({
    op: 'logAction',
    entry: { action: 'unfollow', targetRestId: p.rest_id, targetHandle: p.handle, decidedBy: 'human', result: result.done ? 'ok' : 'failed', detail, reason, wsId },
  });
  return { done: result.done, state: result.state, detail, gate, warning };
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
