/**
 * ⭐⭐⭐ 资源锁 —— 主进程一份,不认识任何业务(Module5-04 §3.1,2026-10-23)
 *
 * ── 为什么有它 ──
 *
 * 原来 X 的「网页正忙」是一张 `wcId → 原因` 的表,谁都能写、谁都能清,
 * renderer 那份还经 syncBusy 同步过来**覆盖**主进程那份。于是:
 * 后台查回关标了忙 → 操作台点采集盖掉 → 操作台结束清掉 → 查回关还在跑,别人看不见忙,可能抢网页。
 *
 * ── 规矩 ──
 *
 * - 资源键是字符串(如 `page:<wcId>`);一个资源同一时刻只有一个持有者。
 * - `acquireLock` 拿到的是 **token**;`releaseLock(token)` —— **只有持有者能放**,拿错 token 放不掉。
 * - 被拒时如实说出:被谁占着(caller)、在干什么(purpose)、多久了。
 * - 超时收回是兜底(进程里有人忘了放 / renderer 没了),**要响**:console.error 写明是谁的锁被收回。
 *   ⚠️ 不是正常路径 —— 正常路径永远是持有者自己在 finally 里放。
 * - ⚠️ 模块级状态每进程一份(记忆 feedback-per-process-module-state):**只在主进程用**;
 *   renderer 要占资源走 IPC 申请,不许自己 import 本文件当真。
 */

export type LockHolder = {
  readonly token: string;
  readonly resource: string;
  /** 在干什么(给人看,被拒时原样说出来) */
  readonly purpose: string;
  /** 谁发起的:ui / timer / inbox / ai / … */
  readonly caller: string;
  readonly since: number;
  readonly ttlMs: number;
};

export type LockAcquired = { readonly ok: true; readonly token: string };
export type LockRefused = { readonly ok: false; readonly holder: LockHolder; readonly why: string };

/** 默认 1 小时 —— 只防「忘了放」;正常的长任务(查回关翻很多页)也在这之内 */
export const DEFAULT_LOCK_TTL_MS = 60 * 60_000;

const byResource = new Map<string, LockHolder>();
const byToken = new Map<string, LockHolder>();
let seq = 0;

function drop(h: LockHolder): void {
  byResource.delete(h.resource);
  byToken.delete(h.token);
}

/** 过期的就收回(要响) */
function live(resource: string, now: number): LockHolder | null {
  const h = byResource.get(resource);
  if (!h) return null;
  if (now - h.since > h.ttlMs) {
    drop(h);
    console.error(`[lock] ⚠️ ${resource} 的锁超时被收回:「${h.purpose}」(${h.caller})占了 ${Math.round((now - h.since) / 1000)} 秒没放 —— 持有方漏了 release,要查`);
    return null;
  }
  return h;
}

function describe(h: LockHolder, now: number): string {
  return `${h.purpose}(${h.caller},已 ${Math.max(0, Math.round((now - h.since) / 1000))} 秒)`;
}

export function acquireLock(
  resource: string, purpose: string, caller: string, opts?: { readonly ttlMs?: number; readonly now?: number },
): LockAcquired | LockRefused {
  const now = opts?.now ?? Date.now();
  const cur = live(resource, now);
  if (cur) return { ok: false, holder: cur, why: describe(cur, now) };
  seq += 1;
  const h: LockHolder = { token: `${resource}#${seq}:${now.toString(36)}`, resource, purpose, caller, since: now, ttlMs: opts?.ttlMs ?? DEFAULT_LOCK_TTL_MS };
  byResource.set(resource, h);
  byToken.set(h.token, h);
  return { ok: true, token: h.token };
}

/** 只有持有者能放;不是(拿错 / 已放 / 已超时收回)返 false 并说出来 */
export function releaseLock(token: string): boolean {
  const h = byToken.get(token);
  if (!h || byResource.get(h.resource)?.token !== token) {
    console.warn(`[lock] release 没放任何东西:token ${token} 不是现在的持有者(已放过 / 超时被收回 / 拿错了)`);
    return false;
  }
  drop(h);
  return true;
}

export function lockHolder(resource: string, now: number = Date.now()): LockHolder | null {
  return live(resource, now);
}

/** 这个 token 现在是不是还持有这个资源(调用方带着自己的锁进来时用) */
export function holdsLock(token: string, resource: string, now: number = Date.now()): boolean {
  return live(resource, now)?.token === token;
}

/**
 * 资源本身没了(网页销毁)/ 持有方没了(renderer 关掉)时强制收回 —— **要响**,说清收回了谁的。
 * @returns 收回了几把
 */
export function revokeLocks(pred: (h: LockHolder) => boolean, why: string): number {
  const hit = [...byResource.values()].filter(pred);
  for (const h of hit) {
    drop(h);
    console.warn(`[lock] 收回 ${h.resource} 的锁「${h.purpose}」(${h.caller}):${why}`);
  }
  return hit.length;
}

/** 体检 / 给 AI 读:现在谁占着什么 */
export function listLocks(now: number = Date.now()): readonly LockHolder[] {
  return [...byResource.keys()].map((r) => live(r, now)).filter((h): h is LockHolder => h !== null);
}

/** 测试用 */
export function _resetLocks(): void {
  byResource.clear();
  byToken.clear();
}
