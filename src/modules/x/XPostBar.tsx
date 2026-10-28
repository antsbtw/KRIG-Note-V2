/**
 * ⭐ X 网页顶上的 KRIG 确认条(发推第②期,2026-10-27)—— 设计 x-posting-design.md §5.2
 *
 * 用户 10-26:「发推后,发到 x 上再确定如何?多一个确认环节」:note 那边点「发布 ▸」只是填进 X 的发推框,
 * 人在这里看着 X 上的真实样子,再点「确认发布」或「取消」。
 * 画在 KRIG 自己的界面里(X 网页上方),不往 X 页面里注入。
 * 「确认发布」走能力 x.post.publish(第③期:点 X 的发布 → 去主页核对);取消 / 回 note 改走 x.post.cancel。
 * 点 X、核对、放网页都在主进程;这里只发请求、显示结局。
 * 结局(发出去 / 说不清 / 没成 / 撤回没清掉)在条上留着,人点「知道了」才收起。
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
const bar = {
  display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', flex: '0 0 auto',
  background: 'var(--accent-bg)', borderBottom: '1px solid var(--border-popup)', color: 'var(--text-bright)', fontSize: 13,
} as const;
const mmss = (ms: number): string => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

export function XPostBar({ wsId, onOpen }: { wsId: string; onOpen: (url: string) => void }) {
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
  /**
   * 草稿结束后条不跟着消失的两种:撤回了但框没清掉(「请手动删」要有人看见,10-27 真机)/ 发布的结局。
   * 撤回清干净了就直接收起。
   */
  const end = snap.ended;
  const showEnd = !draft && end && dismissed !== end.draftId && (end.why === 'published' || !end.cleared);
  if (showEnd) {
    const url = end.tweetId && end.handle ? `https://x.com/${end.handle}/status/${end.tweetId}` : null;
    const [color, text] = end.why !== 'published'
      ? ['#d97706', '⚠️ 撤回了,但发推框里的字没清掉 —— 请在下面 X 的发推框里手动删掉(没发出去)。']
      : end.outcome === 'sent' ? ['#16a34a', `✅ 已发到 X(@${end.handle ?? '?'}),在你主页上核对过了。`]
        : end.outcome === 'unseen' ? ['#d97706', `⚠️ 点了发布,但没核对上:${end.detail ?? ''}`]
          : ['#e5484d', `❌ 没发出去:${end.detail ?? ''}`];
    return (
      <div style={{ ...bar, flexWrap: 'wrap' }}>
        <b style={{ flex: 'none' }}>KRIG</b>
        <span style={{ flex: 1, minWidth: 200, color }}>{text}</span>
        {url && <button type="button" style={btn} title={url} onClick={() => onOpen(url)}>查看 ↗</button>}
        <button type="button" style={btn} onClick={() => setDismissed(end.draftId)}>知道了</button>
      </div>
    );
  }
  if (!draft) return null;

  const publish = async (): Promise<void> => {
    setBusy(true);
    setNote('ⓘ 正在点 X 的发布,再去你主页核对…(别动左边网页)');
    const r = await xDataCall({ op: 'postPublish', wsId, draftId: draft.draftId });
    setBusy(false);
    if (r.status !== 'ok') console.warn(`[x-post] 发布没核对上:${r.reason}`);
    /** 结局由 pending store 的 ended 显示(主进程记的那份),这里不另存一份 */
    await refreshPending(wsId);
  };

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
    <div style={{ ...bar, flexWrap: 'wrap' }}>
      <b style={{ flex: 'none' }}>KRIG</b>
      <span style={{ flex: 1, minWidth: 200 }}>
        已填进下面的发推框 —— 这就是发出去的样子,核对一下。
        <span style={{ color: 'var(--text-muted)' }}> {mmss(draft.expiresAt - now)} 后没确认自动撤回</span>
        {note && <div style={{ fontSize: 12, color: note.startsWith('❌') ? '#e5484d' : '#d97706', marginTop: 2 }}>{note}</div>}
      </span>
      <button type="button" style={{ ...btn, background: '#1d9bf0', borderColor: 'transparent', color: '#fff' }} disabled={busy}
        title="替你点 X 的「发布」(真的发出去),再去你主页核对"
        onClick={() => { void publish(); }}>
        {busy ? '发布中…' : '✅ 确认发布'}
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
