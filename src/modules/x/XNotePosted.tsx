/**
 * ⭐ note 顶上「这篇发过」那行(发推第③b期,2026-10-28)—— 设计 x-posting-design.md §3.4 / §4
 *
 * 用户 10-26 选的效果:「发后 note 顶部提示 + note 记着发过」。
 * 挂在 note 的顶部提示挂点(view-notice-registry)上:note 不认识 X,删 X 这行就没了。
 * 数据走能力 x.post.ofNote(按 note id 查 x_post;撤回的不算)。
 * 没发过就不画。最近一次:✅ 发出去 / ⚠️ 点了发布没核对上 / ❌ 没发出去(写原因);多次可展开。
 * 「查看 ↗」:X 不在台上先在 note 另一栏打开,再经能力 x.post.show 打开那条推。
 */
import { useCallback, useEffect, useState } from 'react';
import type { ViewNoticeProps } from '@slot/interaction-registries/view-notice-registry/view-notice-registry';
import { xDataCall } from './x-data-types';
import type { NotePost } from './x-post-repo';
import { subscribeEnded } from './x-post-pending-store';
import { ensureXOpen } from './x-post-preview';

const MARK: Record<NotePost['status'], [string, string]> = {
  sent: ['✅', '发出去了'],
  unseen: ['⚠️', '点了发布,没核对上 —— 请在 X 上看一眼'],
  failed: ['❌', '没发出去'],
};
const COLOR: Record<NotePost['status'], string> = { sent: 'var(--text)', unseen: '#d97706', failed: '#e5484d' };

const when = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

const link = {
  background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', fontSize: 12,
  color: 'var(--text-muted)', fontFamily: 'inherit', textDecoration: 'underline',
} as const;

export function XNotePosted({ wsId, subjectId: noteId, instanceId }: ViewNoticeProps) {
  const [posts, setPosts] = useState<readonly NotePost[]>([]);
  const [open, setOpen] = useState(false);
  const [why, setWhy] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    const r = await xDataCall({ op: 'postOfNote', noteId });
    if (r.status !== 'ok') { console.warn(`[x-post] 查这篇 note 发过没,没成:${r.reason}`); return; }
    setPosts((r.value as { posts: NotePost[] }).posts);
  }, [noteId]);

  useEffect(() => {
    setPosts([]); setOpen(false); setWhy(null);
    void load();
    /** 发布刚结束(哪个 ws 都算:同一篇 note 可能在别的窗口发)→ 重查 */
    return subscribeEnded((_ws, ended) => { if (ended.why === 'published') void load(); });
  }, [load]);

  const show = async (tweetId: string): Promise<void> => {
    setWhy(null);
    const notOpen = await ensureXOpen(wsId, instanceId);
    if (notOpen) { setWhy(notOpen); return; }
    const r = await xDataCall({ op: 'postShow', wsId, tweetId });
    if (r.status !== 'ok') { setWhy(r.reason); console.warn(`[x-post] 打开推文 ${tweetId} 没成:${r.reason}`); }
  };

  if (posts.length === 0) return null;
  const last = posts[0];
  const sent = posts.filter((p) => p.status === 'sent').length;
  const line = (p: NotePost, i: number) => (
    <div key={p.draftId} style={{ display: 'flex', gap: 8, alignItems: 'baseline', color: COLOR[p.status], fontSize: i < 0 ? 13 : 12 }}>
      <span>{MARK[p.status][0]} {when(p.endedAt)} @{p.handle}{p.media > 0 ? ` · ${p.media} 张图` : ''} · {p.status === 'failed' && p.detail ? `没发出去:${p.detail}` : MARK[p.status][1]}</span>
      {p.tweetId && <button type="button" style={link} title={`在 X 上打开 ${p.tweetId}`} onClick={() => { void show(p.tweetId!); }}>查看 ↗</button>}
    </div>
  );

  return (
    <div style={{
      border: '1px solid var(--border-popup)', borderRadius: 6, padding: '6px 10px', fontSize: 13,
      color: 'var(--text)', display: 'flex', flexDirection: 'column', gap: 4,
    }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
        <b style={{ flex: 'none' }}>𝕏</b>
        <span style={{ color: 'var(--text-muted)', flex: 'none' }}>
          {sent > 0 ? `这篇发过 ${sent} 次` : '这篇还没发出去过'}{posts.length > sent ? `(另有 ${posts.length - sent} 次没成 / 没核对上)` : ''} · 最近:
        </span>
        {line(last, -1)}
        {posts.length > 1 && (
          <button type="button" style={link} onClick={() => setOpen((v) => !v)}>{open ? '收起' : `全部 ${posts.length} 次 ▾`}</button>
        )}
      </div>
      {open && posts.slice(1).map((p, i) => line(p, i))}
      {why && <div style={{ fontSize: 12, color: '#e5484d' }}>❌ {why}</div>}
    </div>
  );
}
