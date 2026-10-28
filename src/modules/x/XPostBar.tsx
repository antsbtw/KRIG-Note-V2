/**
 * ⭐ X 网页顶上的 KRIG 确认条(发推第②期,2026-10-27)—— 设计 x-posting-design.md §5.2
 *
 * 用户 10-26:「发推后,发到 x 上再确定如何?多一个确认环节」:note 那边点「发布 ▸」只是填进 X 的发推框,
 * 人在这里看着 X 上的真实样子,再点「确认发布」或「取消」。
 * 画在 KRIG 自己的界面里(X 网页上方),不往 X 页面里注入。
 * ⚠️ 「确认发布」第③期才接能力 x.post.publish;本期点了只说明「这次没发」。
 * ⚠️ 取消 / 回 note 改走能力 x.post.cancel(清框、关弹窗、放网页都在主进程)。
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import type { TextEditingApi } from '@capabilities/text-editing/types';
import { xDataCall } from './x-data-types';
import { draftNote, pendingSnap, refreshPending, subscribePending } from './x-post-pending-store';

const btn = {
  background: 'transparent', border: '1px solid var(--border-popup)', borderRadius: 4,
  color: 'var(--text)', cursor: 'pointer', fontSize: 12, padding: '3px 10px', fontFamily: 'inherit', flex: 'none',
} as const;
const mmss = (ms: number): string => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

export function XPostBar({ wsId }: { wsId: string }) {
  const snap = useSyncExternalStore((cb) => subscribePending(wsId, cb), () => pendingSnap(wsId));
  const draft = snap.pending;
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);
  useEffect(() => {
    if (!draft) return undefined;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [draft]);
  useEffect(() => { setNote(null); }, [draft?.draftId]);
  /** 撤回了但框没清掉:草稿已结束,条不能跟着消失 —— 否则「请手动删」没人看见(10-27 真机) */
  const stale = snap.ended && !snap.ended.cleared ? snap.ended : null;
  if (!draft && stale && dismissed !== stale.draftId) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', flex: '0 0 auto',
        background: 'var(--accent-bg)', borderBottom: '1px solid var(--border-popup)', color: 'var(--text-bright)', fontSize: 13,
      }}>
        <b style={{ flex: 'none' }}>KRIG</b>
        <span style={{ flex: 1, color: '#d97706' }}>⚠️ 撤回了,但发推框里的字没清掉 —— 请在下面 X 的发推框里手动删掉(没发出去)。</span>
        <button type="button" style={btn} onClick={() => setDismissed(stale.draftId)}>知道了</button>
      </div>
    );
  }
  if (!draft) return null;

  const cancel = async (why: 'user' | 'back-to-note'): Promise<void> => {
    setBusy(true);
    const r = await xDataCall({ op: 'postCancel', wsId, draftId: draft.draftId, why });
    setBusy(false);
    if (r.status !== 'ok') { setNote(`❌ ${r.reason}`); console.warn(`[x-post] 撤回草稿没成:${r.reason}`); }
    if (why === 'back-to-note') {
      const inst = draftNote(draft.draftId);
      if (inst) requireCapabilityApi<TextEditingApi>('text-editing').api.focusInstance(inst);
    }
    await refreshPending(wsId);
  };

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', flex: '0 0 auto', flexWrap: 'wrap',
      background: 'var(--accent-bg)', borderBottom: '1px solid var(--border-popup)', color: 'var(--text-bright)', fontSize: 13,
    }}>
      <b style={{ flex: 'none' }}>KRIG</b>
      <span style={{ flex: 1, minWidth: 200 }}>
        已填进下面的发推框 —— 这就是发出去的样子,核对一下。
        <span style={{ color: 'var(--text-muted)' }}> {mmss(draft.expiresAt - now)} 后没确认自动撤回</span>
        {note && <div style={{ fontSize: 12, color: note.startsWith('❌') ? '#e5484d' : '#d97706', marginTop: 2 }}>{note}</div>}
      </span>
      <button type="button" style={{ ...btn, background: '#1d9bf0', borderColor: 'transparent', color: '#fff' }} disabled={busy}
        title="第③期接:点了会替你点 X 的「发布」并核对发出去了"
        onClick={() => setNote('ⓘ 第③期才会真的发出去 —— 这次没发。看完点「取消」清掉框里的字。')}>
        ✅ 确认发布
      </button>
      <button type="button" style={btn} disabled={busy} title="撤回这份草稿,回到 note 改字(改完重新点发布)" onClick={() => { void cancel('back-to-note'); }}>
        ✏ 回 note 改
      </button>
      <button type="button" style={btn} disabled={busy} title="清掉发推框里的字,关掉弹窗,不发" onClick={() => { void cancel('user'); }}>
        取消
      </button>
    </div>
  );
}
