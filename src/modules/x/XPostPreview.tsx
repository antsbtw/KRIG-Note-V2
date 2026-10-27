/**
 * ⭐ 发推预览窗(发推第①期,2026-10-27)—— 设计 docs/10-business-design/x/x-posting-design.md §3.1
 *
 * note 右键「𝕏 发到 X」→ 浮在右边(不点外面就关,人要回 note 改字):建议的发法 + 显示成 X 上的样子;
 * 可以换发法;note 一改这里跟着变(x-post-preview.ts 盯着那段内容)。
 * 「发布 ▸」(第②期):调能力 x.post.fill 把这条填进左边 X 的发推框(不发),到 X 顶上的确认条里确认 / 取消。
 *   界面不驱动网页 —— 填、清、占网页全在主进程能力里。「定时」第⑦期。
 * ⚠️ 字不能在这里改(用户 10-27 定 B:字只在 note 里改,note 是唯一原文)。
 */
import { useEffect, useState } from 'react';
import type { PostDraft, PostForm, PostMedia, PostPlan } from './x-post-compose';
import { X_POST_LIMIT } from './x-post-length';
import type { PendingSnap } from './x-post-pending-store';

export type PreviewState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ok'; readonly plan: PostPlan }
  | { readonly kind: 'failed'; readonly why: string }
  /** note 关了 */
  | { readonly kind: 'gone' };

/** 「发布 ▸」那一下的进度(草稿本身的状态看 pending) */
export type FillState =
  | { readonly phase: 'idle' }
  | { readonly phase: 'filling'; readonly step: string }
  | { readonly phase: 'failed'; readonly why: string };

export type PreviewProps = {
  readonly state: PreviewState;
  readonly handle: string | null;
  readonly wholeDoc: boolean;
  /** 打开时想先看的发法(「发布为 X 文章」进来是 article) */
  readonly initialForm?: PostForm;
  readonly fill: FillState;
  readonly pending: PendingSnap;
  /** 预览窗打开的时刻 —— 只说这之后结束的草稿 */
  readonly openedAt: number;
  readonly onBackToNote: () => void;
  readonly onClose: () => void;
  readonly onPublish: (form: PostForm) => void;
};

const ENDED_TEXT: Record<string, string> = { user: '你点了取消', 'back-to-note': '你回 note 改了', timeout: '10 分钟没确认,自动撤回' };
const mmss = (ms: number): string => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

/** 草稿在 X 上等确认时,每秒刷新剩余时间 */
function useNow(on: boolean): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!on) return undefined;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [on]);
  return now;
}

const RENDER_NAME: Record<string, string> = { math: '公式', code: '代码', mermaid: 'Mermaid', table: '表格', mathVisual: '函数图像', html: 'HTML' };
const box = { border: '1px solid var(--border-popup)', borderRadius: 8 } as const;
const btn = {
  background: 'transparent', border: '1px solid var(--border-popup)', borderRadius: 4,
  color: 'var(--text)', cursor: 'pointer', fontSize: 12, padding: '4px 12px', fontFamily: 'inherit',
} as const;
const btnOff = { ...btn, cursor: 'default', opacity: 0.4 } as const;
const btnMain = { ...btn, background: '#1d9bf0', borderColor: 'transparent', color: '#fff' } as const;

function MediaCell({ m }: { m: PostMedia }) {
  const cell = { background: 'var(--bg-card)', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 0 } as const;
  if (m.kind === 'image') return <div style={cell}><img src={m.src} alt={m.alt} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /></div>;
  if (m.kind === 'video') return <div style={cell}>🎬 视频</div>;
  return (
    <div style={{ ...cell, flexDirection: 'column', padding: 6, fontSize: 11, color: 'var(--text)' }} title={m.source}>
      <div>{RENDER_NAME[m.what] ?? m.what} → 图</div>
      <div style={{ opacity: 0.6, maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.source.slice(0, 40)}</div>
    </div>
  );
}

/** X 的 1 / 2 / 3 / 4 图版式:2 = 左右;3 = 左大右二;4 = 田字 */
function MediaGrid({ media }: { media: readonly PostMedia[] }) {
  if (media.length === 0) return null;
  const n = Math.min(media.length, 4);
  const areas = n === 1 ? '"a"' : n === 2 ? '"a b"' : n === 3 ? '"a b" "a c"' : '"a b" "c d"';
  return (
    <div style={{ ...box, display: 'grid', gridTemplateAreas: areas, gridTemplateColumns: n === 1 ? '1fr' : '1fr 1fr', gap: 2, aspectRatio: '16 / 9', overflow: 'hidden', marginTop: 8 }}>
      {media.slice(0, 4).map((m, i) => <div key={i} style={{ gridArea: 'abcd'[i], display: 'grid', minHeight: 0 }}><MediaCell m={m} /></div>)}
    </div>
  );
}

function PostCard({ post, handle, limit, last }: { post: PostDraft; handle: string | null; limit: number | null; last: boolean }) {
  const over = limit !== null && post.weight > limit;
  return (
    <div style={{ display: 'flex', gap: 8 }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--accent-bg)', flex: 'none' }} />
        {!last && <div style={{ width: 2, flex: 1, background: 'var(--border-popup)', marginTop: 4 }} />}
      </div>
      <div style={{ flex: 1, minWidth: 0, paddingBottom: last ? 0 : 14 }}>
        <div style={{ fontSize: 12, color: 'var(--text)' }}>{handle ? `@${handle}` : '(还没认号)'}</div>
        <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 14, lineHeight: 1.5, marginTop: 2 }}>{post.text}</div>
        <MediaGrid media={post.media} />
        {limit !== null && (
          <div style={{ textAlign: 'right', fontSize: 11, marginTop: 4, color: over ? '#e5484d' : 'var(--text-muted)' }}>{post.weight} / {limit}</div>
        )}
      </div>
    </div>
  );
}

export function XPostPreview({ state, handle, wholeDoc, initialForm, fill, pending, openedAt, onBackToNote, onClose, onPublish }: PreviewProps) {
  const [form, setForm] = useState<PostForm | null>(initialForm ?? null);
  const plan = state.kind === 'ok' ? state.plan : null;
  /** 人没选过 → 跟着建议走(note 改了建议可能变);人选的那种变得不可用 → 回到建议 */
  useEffect(() => {
    if (!plan || form === null) return;
    if (!plan.options.find((o) => o.form === form)?.available) setForm(null);
  }, [plan, form]);
  const current = plan ? plan.options.find((o) => o.form === (form ?? plan.suggested)) : undefined;
  const limit = current?.form === 'single' || current?.form === 'thread' ? X_POST_LIMIT : current?.form === 'longPost' ? 25000 : null;
  const draft = pending.pending;
  const now = useNow(draft !== null);
  const ended = pending.ended && pending.ended.at >= openedAt ? pending.ended : null;
  /** 发布按钮能不能点 —— 不能的话为什么(写在按钮的提示里) */
  const blockWhy = !plan || plan.empty || !current ? '没有可发的内容'
    : draft ? '左边 X 上已经有一份在等你确认'
      : fill.phase === 'filling' ? '正在填'
        : current.form !== 'single' ? `「${current.label}」还不能填进 X(第②期只做单条推)`
          : current.posts[0]?.media.length ? '带图第④期才能填进 X'
            : limit !== null && (current.posts[0]?.weight ?? 0) > limit ? '超过字数了'
              : null;

  return (
    <div style={{
      position: 'fixed', top: 56, right: 16, width: 400, maxHeight: 'calc(100vh - 80px)', zIndex: 9000,
      display: 'flex', flexDirection: 'column', background: 'var(--bg-popup)', color: 'var(--text-bright)',
      ...box, boxShadow: '0 8px 24px rgba(0,0,0,0.35)', fontSize: 13,
      fontFamily: '-apple-system, BlinkMacSystemFont, "PingFang SC", "Segoe UI", sans-serif',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', padding: '10px 12px', borderBottom: '1px solid var(--border-popup)' }}>
        <b style={{ flex: 1 }}>𝕏 发到 X{handle ? ` · @${handle}` : ''}</b>
        <span style={{ fontSize: 11, color: 'var(--text-muted)', marginRight: 8 }}>{wholeDoc ? '整篇' : '选中的部分'}</span>
        <button type="button" onClick={onClose} title="关闭" style={{ ...btn, border: 'none', padding: '2px 6px' }}>✕</button>
      </div>

      <div style={{ padding: 12, overflowY: 'auto', flex: 1 }}>
        {state.kind === 'loading' && <div style={{ color: 'var(--text)' }}>排版中…</div>}
        {state.kind === 'failed' && <div style={{ color: '#e5484d' }}>❌ 排版没成:{state.why}</div>}
        {state.kind === 'gone' && <div style={{ color: '#d97706' }}>⚠️ note 已关闭,预览停在最后的样子。</div>}
        {plan && plan.empty && <div style={{ color: 'var(--text)' }}>这段内容是空的,没有可发的。</div>}
        {plan && !plan.empty && current && (
          <>
            <div style={{ marginBottom: 8 }}>
              建议:<b>{plan.options.find((o) => o.form === plan.suggested)?.label}</b>
              <span style={{ color: 'var(--text)' }}> —— {plan.reason}</span>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
              {plan.options.map((o) => (
                <button key={o.form} type="button" disabled={!o.available} title={o.why ?? o.note ?? ''} onClick={() => setForm(o.form)}
                  style={{
                    fontSize: 12, padding: '3px 10px', borderRadius: 12, opacity: o.available ? 1 : 0.45, fontFamily: 'inherit',
                    cursor: o.available ? 'pointer' : 'default',
                    border: '1px solid var(--border-popup)',
                    background: o.form === current.form ? 'var(--accent-bg)' : 'transparent', color: 'inherit',
                  }}>
                  {o.label}{o.form === 'thread' && o.available ? ` ${o.posts.length} 条` : ''}{o.form === plan.suggested ? ' ✓' : ''}
                </button>
              ))}
            </div>
            {current.note && <div style={{ fontSize: 11, color: '#d97706', marginBottom: 8 }}>ⓘ {current.note}</div>}
            {current.form === 'article' && plan.title && <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>{plan.title}</div>}
            <div style={{ ...box, padding: 12 }}>
              {current.posts.map((p, i) => <PostCard key={i} post={p} handle={handle} limit={limit} last={i === current.posts.length - 1} />)}
            </div>
            {plan.warnings.length > 0 && (
              <div style={{ marginTop: 8, fontSize: 12, color: '#d97706' }}>
                {plan.warnings.map((w) => <div key={w}>⚠ {w}</div>)}
              </div>
            )}
          </>
        )}
      </div>

      {(draft || fill.phase !== 'idle' || ended) && (
        <div style={{ padding: '8px 12px', borderTop: '1px solid var(--border-popup)', fontSize: 12, lineHeight: 1.5 }}>
          {fill.phase === 'filling' && <div>⏳ {fill.step}</div>}
          {fill.phase === 'failed' && <div style={{ color: '#e5484d' }}>❌ 没填进 X:{fill.why}</div>}
          {draft && (
            <div>
              ✅ 已填进 X 的发推框(@{draft.handle})—— 到 X 上看一眼,在顶上的 KRIG 条里点「确认发布」或「取消」。
              <span style={{ color: 'var(--text-muted)' }}> {mmss(draft.expiresAt - now)} 后自动撤回</span>
            </div>
          )}
          {!draft && ended && (
            <div style={{ color: 'var(--text-muted)' }}>
              上一份草稿已撤回({ENDED_TEXT[ended.why] ?? ended.why}){ended.cleared ? '' : ' ⚠️ 框里的字没清掉,请在 X 上手动删'}
            </div>
          )}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', padding: '10px 12px', borderTop: '1px solid var(--border-popup)' }}>
        <button type="button" style={btn} onClick={onBackToNote} title="字只在 note 里改;改了这里跟着变">回 note 改</button>
        <button type="button" style={btnOff} disabled title="定时发:第⑦期">⏰ 定时</button>
        <button type="button" style={blockWhy ? { ...btnMain, opacity: 0.4, cursor: 'default' } : btnMain} disabled={blockWhy !== null}
          title={blockWhy ?? '先填进左边 X 的发推框(不发),你在 X 上看过再确认'}
          onClick={() => { if (current && !blockWhy) onPublish(current.form); }}>
          {fill.phase === 'filling' ? '填进 X…' : '发布 ▸'}
        </button>
      </div>
    </div>
  );
}
