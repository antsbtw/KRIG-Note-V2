/**
 * ⭐⭐⭐ X 网页占用 —— 平台资源锁的 X 薄壳(Module5-04 第 1 步,2026-10-23)
 *
 * 一个 X 网页(wcId)同一时刻只有一个占用者:查回关 / 关系采集 / 关注队列 / 求关发送 / 卡片准备 /
 * 后台采集 / 操作台 / 人卡 …… 都在这里申请,在 finally 里用**自己的 token** 放。
 * 别人放不掉你的锁(旧的 `setXHostBusy(wcId, null)` 谁都能清,这正是 Module5-04 §1.3 的 bug 1)。
 *
 * ⚠️ 只在主进程用。renderer 只能问 IPC `pageBusy`;要用网页调能力,执行器占锁。
 */
import { acquireLock, holdsLock, lockHolder, releaseLock, revokeLocks } from '@platform/main/flow/resource-lock';

export const pageResource = (wcId: number): string => `page:${wcId}`;

export type PageAcquire = { readonly ok: true; readonly token: string } | { readonly ok: false; readonly why: string };

/** 被拒时 why = 「X 网页正忙:<占用者在干什么>(<谁>,已 N 秒)」 */
export function acquirePage(wcId: number, purpose: string, caller: string): PageAcquire {
  const r = acquireLock(pageResource(wcId), purpose, caller);
  return r.ok ? r : { ok: false, why: `X 网页正忙:${r.why}` };
}

export function releasePage(token: string): boolean {
  return releaseLock(token);
}

/** 正忙的话返回占用者在干什么;空着返回 null */
export function pageBusy(wcId: number): string | null {
  return lockHolder(pageResource(wcId))?.purpose ?? null;
}

export function holdsPage(token: string, wcId: number): boolean {
  return holdsLock(token, pageResource(wcId));
}

/** 网页销毁:它上面的锁一并收回(要响) */
export function revokePage(wcId: number, why: string): number {
  return revokeLocks((h) => h.resource === pageResource(wcId), why);
}

/**
 * 占住网页做一件事;占不到就不做,返回 refused 的原因。
 * ⚠️ 锁在 finally 里放 —— fn 抛错也放,错原样往上抛。
 */
export async function withPage<T>(
  wcId: number, purpose: string, caller: string, fn: () => Promise<T>,
): Promise<{ readonly ok: true; readonly value: T } | { readonly ok: false; readonly why: string }> {
  const a = acquirePage(wcId, purpose, caller);
  if (!a.ok) return a;
  try {
    return { ok: true, value: await fn() };
  } finally {
    releasePage(a.token);
  }
}
