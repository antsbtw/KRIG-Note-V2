/**
 * 待发草稿的界面这份(发推第②期,2026-10-27)—— renderer
 *
 * 草稿在主进程(x-post-draft.ts);界面经能力 x.post.pending 每秒问一次(X 没有推送通道,同抽查)。
 * 预览窗和左边 X 网页顶上的确认条都从这里读,一个 ws 只一个轮询(有人订阅才问)。
 * 超时撤回是主进程自己做的,界面只是看见它没了、读到上一份怎么结束的。
 */
import { xDataCall } from './x-data-types';
import type { DraftEnded, PendingView } from './x-post-draft';

export type PendingSnap = { readonly pending: PendingView | null; readonly ended: DraftEnded | null };

const POLL_MS = 1000;
const EMPTY: PendingSnap = { pending: null, ended: null };

type Entry = { snap: PendingSnap; subs: Set<() => void>; timer?: ReturnType<typeof setInterval> };
const byWs = new Map<string, Entry>();

const entry = (wsId: string): Entry => {
  let e = byWs.get(wsId);
  if (!e) { e = { snap: EMPTY, subs: new Set() }; byWs.set(wsId, e); }
  return e;
};

/** 马上问一次(fill / cancel 刚回来时调,不等下一秒) */
export async function refreshPending(wsId: string): Promise<void> {
  const r = await xDataCall({ op: 'postPending', wsId });
  if (r.status !== 'ok') return;
  const e = entry(wsId);
  const next = r.value as PendingSnap;
  if (JSON.stringify(next) === JSON.stringify(e.snap)) return;
  e.snap = next;
  for (const cb of e.subs) cb();
}

export function pendingSnap(wsId: string): PendingSnap {
  return byWs.get(wsId)?.snap ?? EMPTY;
}

export function subscribePending(wsId: string, cb: () => void): () => void {
  const e = entry(wsId);
  e.subs.add(cb);
  if (!e.timer) {
    void refreshPending(wsId);
    e.timer = setInterval(() => { void refreshPending(wsId); }, POLL_MS);
  }
  return () => {
    e.subs.delete(cb);
    if (e.subs.size === 0 && e.timer) { clearInterval(e.timer); e.timer = undefined; }
  };
}

/** 草稿是从哪个 note 编辑器填出去的(确认条「回 note 改」要回到它)—— 只在本窗口有意义 */
const noteOfDraft = new Map<string, string>();
export const rememberDraftNote = (draftId: string, instanceId: string): void => { noteOfDraft.set(draftId, instanceId); };
export const draftNote = (draftId: string): string | undefined => noteOfDraft.get(draftId);
