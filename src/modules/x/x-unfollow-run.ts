/**
 * ⭐ 取关 / 点人核对 / 左边打开某页 / 占网页 —— renderer 侧的薄壳(2026-10-26 Module5-04 第 4 步 4a)
 *
 * 取关和核对原来在这里自己 webDomInvoke 驱动网页;现在都在主进程(x-person-act.ts),走能力:
 *   x.person.verify / x.person.unfollow / x.unfollow.halt / x.unfollow.resume / x.page.open
 * 这里只把调用和结果转成界面用的形状。网页锁、闸门、记动作、核对、「异常即停」都在主进程一份 ——
 * 人卡和任务页看的是同一个「取关已暂停」。
 */
import { xDataCall } from './x-data-types';
import type { UnfollowGate } from './x-ops-settings';
import type { VerifyOutcome } from './x-person-act';

export type { VerifyOutcome } from './x-person-act';
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

export { UNFOLLOW_STATE_TEXT } from './x-unfollow-text';

/** 核对:网页被别人占着(没跳)→ refused;否则主进程读到什么给什么(没读到是 miss) */
export async function verifyPerson(wsId: string, p: Who): Promise<{ readonly refused: string } | VerifyOutcome> {
  const r = await xDataCall({ op: 'personVerify', wsId, restId: p.rest_id, handle: p.handle });
  if (r.status !== 'ok') return { refused: r.reason };
  return r.value as VerifyOutcome;
}

export type UnfollowOutcome =
  | { readonly blocked: string; readonly gate?: UnfollowGate }
  | {
    readonly done: boolean; readonly state: string; readonly detail?: string; readonly gate: UnfollowGate; readonly warning?: string;
    /** 取关后同一把锁里的核对(成了 / 本来就没关注才有) */
    readonly verify?: VerifyOutcome;
    /** 没成 → 这个号的取关暂停了(主进程一份) */
    readonly halted?: string;
  };

/** 取关(对外动作,只接受人在界面上点):闸门 / 去主页 / 点 / 记动作 / 核对 / 异常即停都在主进程 */
export async function unfollowPerson(wsId: string, p: Who, reason?: string): Promise<UnfollowOutcome> {
  const r = await xDataCall({ op: 'personUnfollow', wsId, restId: p.rest_id, handle: p.handle, reason });
  if (r.status !== 'ok') return { blocked: r.reason };
  return r.value as UnfollowOutcome;
}

/** 这个号的取关是不是暂停着(主进程一份);问不到也说出来 */
export async function unfollowHaltOf(wsId: string): Promise<string | null> {
  const r = await xDataCall({ op: 'unfollowHalt', wsId });
  if (r.status !== 'ok') return `问不到取关状态(${r.reason})`;
  return (r.value as { halted: string | null }).halted;
}

export async function resumeUnfollowOf(wsId: string): Promise<void> {
  const r = await xDataCall({ op: 'unfollowResume', wsId });
  if (r.status !== 'ok') console.error(`[x.unfollow] 恢复取关没成:${r.reason}`);
}

/** 左边 X 网页打开某人主页 / 某条推文;没打开返回原因(网页被占着 / 打不开),打开了返回 null */
export async function openInLeft(wsId: string, target: { readonly handle: string } | { readonly tweetId: string }): Promise<string | null> {
  const r = await xDataCall('handle' in target
    ? { op: 'pageOpen', wsId, page: 'profile', handle: target.handle }
    : { op: 'pageOpen', wsId, page: 'status', tweetId: target.tweetId });
  return r.status === 'ok' ? null : r.reason;
}
