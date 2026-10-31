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
import { fillBlock, formNotFillable, type PostDraft, type PostForm, type PostMedia, type PostPlan, type ThreadEdit, type ThreadLayout } from './x-post-compose';
import { mergeNext, moveMedia, splitBefore } from './x-post-layout';
import type { ArticleDraft, ArticleStep } from './x-post-article';
import { X_POST_LIMIT } from './x-post-length';
import type { PendingSnap } from './x-post-pending-store';
import type { PostedBefore } from './x-post-repo';

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
  /** 推串手动分条改了(null = 恢复自动排) */
  readonly onLayout: (l: ThreadLayout | null) => void;
  /** 这段字以前发过的(x.post.history)—— 只提醒,不拦(用户 10-21「有问题提示就好了」) */
  readonly posted: readonly PostedBefore[];
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

const RENDER_NAME: Record<string, string> = { math: '公式', code: '代码', mermaid: 'Mermaid', table: '表格', mathVisual: '函数图像', html: 'HTML', svg: 'SVG 图', inlineMath: '行内公式段', section: '这一节', columns: '分栏' };
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
    <div style={{ ...cell, flexDirection: 'column', padding: 6, fontSize: 11, color: m.error ? '#e5484d' : 'var(--text)' }} title={m.error ?? m.source}>
      <div>{RENDER_NAME[m.what] ?? m.what} {m.error ? '没转成图' : '→ 图(转换中…)'}</div>
      <div style={{ opacity: 0.6, maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{(m.error ?? m.source).slice(0, 40)}</div>
    </div>
  );
}

/** X 的 1 / 2 / 3 / 4 图版式:2 = 左右;3 = 左大右二;4 = 田字 */
function MediaGrid({ media }: { media: readonly PostMedia[] }) {
  if (media.length === 0) return null;
  /** 单张图 X 按原比例整张显示(10-29 真机:X 发推框里转图整张都在),预览别再按 16:9 裁 */
  const only = media[0];
  if (media.length === 1 && only.kind === 'image') {
    return <div style={{ ...box, overflow: 'hidden', marginTop: 8 }}><img src={only.src} alt={only.alt} style={{ display: 'block', width: '100%', height: 'auto' }} /></div>;
  }
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

/**
 * 推串调整分条(用户 10-29「让用户自己拖动合并」):每条拆成件 —— 字一段段列出,段之间能「从这里分开」;
 * 相邻两条之间能「合并」;图能拖到别的条。字不能在这里改(字只在 note 里改)。
 */
function ThreadEditor({ edit, posts, limit, onLayout }: { edit: ThreadEdit; posts: readonly PostDraft[]; limit: number | null; onLayout: (l: ThreadLayout) => void }) {
  const [over, setOver] = useState<number | null>(null);
  const link = { ...btn, border: 'none', padding: '2px 6px', fontSize: 11, color: '#1d9bf0' } as const;
  return (
    <div>
      {edit.posts.map((idx, k) => {
        const texts = idx.filter((i) => edit.items[i].k === 'text');
        const media = idx.filter((i) => edit.items[i].k === 'media');
        const post = posts[k];
        const bad = post && limit !== null && post.weight > limit;
        return (
          <div key={k}>
            <div
              onDragOver={(e) => { e.preventDefault(); setOver(k); }}
              onDragLeave={() => setOver((o) => (o === k ? null : o))}
              onDrop={(e) => {
                e.preventDefault();
                setOver(null);
                const item = Number(e.dataTransfer.getData('text/x-post-item'));
                if (Number.isInteger(item)) onLayout(moveMedia(edit.key, edit.posts, item, k));
              }}
              style={{ ...box, padding: 8, background: over === k ? 'var(--accent-bg)' : 'transparent' }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>
                第 {k + 1} 条{post ? ` · ${post.weight}${limit !== null ? ` / ${limit}` : ''}` : ''}{bad ? ' ⚠ 超了' : ''}{media.length > 4 ? ' ⚠ 图超过 4 张' : ''}
              </div>
              {texts.map((i, j) => {
                const it = edit.items[i];
                return (
                  <div key={i}>
                    {j > 0 && <button type="button" style={link} onClick={() => onLayout(splitBefore(edit.key, edit.items, edit.posts, k, i))}>✂ 从这里分开</button>}
                    <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 13, lineHeight: 1.5 }}>{it.k === 'text' ? it.text : ''}</div>
                  </div>
                );
              })}
              {media.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                  {media.map((i) => {
                    const it = edit.items[i];
                    const m = it.k === 'media' ? it.m : null;
                    return (
                      <div key={i} draggable title="拖到别的条" onDragStart={(e) => e.dataTransfer.setData('text/x-post-item', String(i))}
                        style={{ width: 88, height: 66, ...box, overflow: 'hidden', cursor: 'grab', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11 }}>
                        {m?.kind === 'image' ? <img src={m.src} alt={m.alt} draggable={false} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                          : m?.kind === 'render' ? (RENDER_NAME[m.what] ?? m.what) : '🎬'}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            {k < edit.posts.length - 1 && (
              <div style={{ textAlign: 'center', margin: '4px 0' }}>
                <button type="button" style={link} onClick={() => onLayout(mergeNext(edit.key, edit.items, edit.posts, k))}>⊕ 和下一条合并</button>
              </div>
            )}
          </div>
        );
      })}
      {edit.posts.length > 1 && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>图可以拖到别的条;字在 note 里改</div>}
    </div>
  );
}

/** 标在 X 自己功能 / 转图块旁边的小字:这一块到了 X 文章里是什么 */
const tag = (s: string) => <span style={{ float: 'right', fontSize: 10, color: 'var(--text-muted)', marginLeft: 6 }}>{s}</span>;

function tableRows(md: string): string[][] {
  return md.split('\n').filter((l, i) => i !== 1).map((l) => l.replace(/^\|\s?|\s?\|$/g, '').split(/\s?(?<!\\)\|\s?/).map((c) => c.replace(/\\\|/g, '|')));
}

function ArticleStepView({ s }: { s: ArticleStep }) {
  const mono = { fontFamily: 'Menlo, monospace', fontSize: 12, background: 'var(--bg-card)', borderRadius: 6, padding: 8, whiteSpace: 'pre-wrap', wordBreak: 'break-all' } as const;
  switch (s.k) {
    /** html 是 x-post-article 自己转义拼出来的(只有 p / strong / em / s / a / ul / ol / li / blockquote / br) */
    case 'html': return <div className="x-article-html" style={{ fontSize: 15, lineHeight: 1.6 }} dangerouslySetInnerHTML={{ __html: s.html }} />;
    case 'heading': return <div style={{ fontSize: s.level === 1 ? 20 : 17, fontWeight: 700, margin: '6px 0 2px' }}>{s.text}</div>;
    case 'latex': return <div style={mono}>{tag('X 公式')}{s.latex}</div>;
    case 'code': return <div style={mono}>{tag(`X 代码块${s.language ? ` · ${s.language}` : ''}`)}{s.code}</div>;
    case 'table': return (
      <div>{tag('X 表格')}
        <table style={{ borderCollapse: 'collapse', fontSize: 12, width: '100%' }}><tbody>
          {tableRows(s.markdown).map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} style={{ border: '1px solid var(--border-popup)', padding: '2px 6px', fontWeight: i === 0 ? 700 : 400 }}>{c}</td>)}</tr>)}
        </tbody></table>
      </div>
    );
    case 'divider': return <hr style={{ border: 0, borderTop: '1px solid var(--border-popup)', width: '100%' }} />;
    case 'media': {
      const m = s.m;
      if (m.kind === 'image') return <div>{m.fromBlock && tag(`${RENDER_NAME[m.fromBlock] ?? m.fromBlock} → 图`)}<img src={m.src} alt={m.alt} style={{ display: 'block', width: '100%', height: 'auto', borderRadius: 6 }} /></div>;
      return <div style={{ ...box, padding: 8 }}><MediaCell m={m} /></div>;
    }
    default: return null;
  }
}

/** X 文章的样子:封面(5:2)/ 标题 / 一块块正文 —— X 自己功能做的块旁边标一下 */
function ArticleView({ a }: { a: ArticleDraft }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <style>{'.x-article-html p{margin:0 0 8px}.x-article-html blockquote{margin:0 0 8px;padding-left:12px;border-left:3px solid var(--border-popup);color:var(--text)}.x-article-html ul,.x-article-html ol{margin:0 0 8px;padding-left:22px}.x-article-html a{color:#1d9bf0}'}</style>
      <div style={{ ...box, aspectRatio: '5 / 2', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
        {a.coverDefault ? <img src={a.coverDefault} alt="封面" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : '没有封面(note 里没有图片)'}
      </div>
      <div style={{ fontSize: 22, fontWeight: 800, lineHeight: 1.3 }}>{a.title || <span style={{ color: '#d97706' }}>(没有标题)</span>}</div>
      {a.steps.map((s, i) => <ArticleStepView key={i} s={s} />)}
    </div>
  );
}

export function XPostPreview({ state, handle, wholeDoc, initialForm, fill, pending, openedAt, onBackToNote, onClose, onPublish, onLayout, posted }: PreviewProps) {
  const [form, setForm] = useState<PostForm | null>(initialForm ?? null);
  /** 推串「调整分条」模式 */
  const [editing, setEditing] = useState(false);
  const plan = state.kind === 'ok' ? state.plan : null;
  /** 人没选过 → 跟着建议走(note 改了建议可能变);人选的那种变得不可用 → 回到建议 */
  useEffect(() => {
    if (!plan || form === null) return;
    if (!plan.options.find((o) => o.form === form)?.available) setForm(null);
  }, [plan, form]);
  /**
   * 人没选过时先选哪种:建议的那种现在能填就选它;还不能填(长推 / X 文章没做)就先选现在能发的
   * —— 否则一打开发布键就是灰的(10-28 用户:「发不出去?」)。建议照样标 ✓,只是不默认选中。
   */
  const fallback = plan?.options.find((o) => o.available && formNotFillable(o.form) === null && fillBlock(o) === null)?.form
    ?? plan?.options.find((o) => o.available && formNotFillable(o.form) === null)?.form;
  const preferred = plan ? (formNotFillable(plan.suggested) === null ? plan.suggested : fallback ?? plan.suggested) : undefined;
  const current = plan ? plan.options.find((o) => o.form === (form ?? preferred)) : undefined;
  const limit = current?.form === 'single' || current?.form === 'thread' || current?.form === 'image' ? X_POST_LIMIT : current?.form === 'longPost' ? 25000 : null;
  const draft = pending.pending;
  const now = useNow(draft !== null);
  const ended = pending.ended && pending.ended.at >= openedAt ? pending.ended : null;
  /** 发布按钮能不能点 —— 不能的话为什么(按钮上方写出来,提示里也有) */
  const blockWhy = !plan || plan.empty || !current ? '没有可发的内容'
    : draft ? '左边 X 上已经有一份在等你确认'
      : fill.phase === 'filling' ? '正在填'
        : fillBlock(current);

  return (
    <div style={{
      /** 手机屏那么大(用户 10-29:「至少像一台手机屏幕」;iPhone 约 440×956)—— 看到的和读者手机上的宽度一样;窗口不够高就占满 */
      position: 'fixed', top: 56, right: 16, width: 440, height: 'min(956px, calc(100vh - 80px))', zIndex: 9000,
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
              {form === null && preferred !== plan.suggested && (
                <span style={{ color: '#d97706' }}>(还不能填进 X,先给你选了「{current.label}」)</span>
              )}
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
                  {o.label}{(o.form === 'thread' || o.form === 'image') && o.available ? ` ${o.posts.length} 条` : ''}{o.form === plan.suggested ? ' ✓' : ''}
                </button>
              ))}
            </div>
            {current.note && <div style={{ fontSize: 11, color: '#d97706', marginBottom: 8 }}>ⓘ {current.note}</div>}
            {current.form === 'thread' && (
              <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', marginBottom: 6 }}>
                {plan.threadEdit.manual && <button type="button" style={btn} onClick={() => onLayout(null)} title="丢掉手动排的,回到自动分条">↺ 恢复自动</button>}
                <button type="button" style={editing ? btnMain : btn} onClick={() => setEditing(!editing)}
                  title="合并相邻两条、从某段字前分开、把图拖到别的条">{editing ? '✓ 调好了' : '✎ 调整分条'}</button>
              </div>
            )}
            <div style={{ ...box, padding: 12 }}>
              {current.form === 'article' && current.article ? <ArticleView a={current.article} />
                : current.form === 'thread' && editing
                ? <ThreadEditor edit={plan.threadEdit} posts={current.posts} limit={limit} onLayout={onLayout} />
                : current.posts.map((p, i) => <PostCard key={i} post={p} handle={handle} limit={limit} last={i === current.posts.length - 1} />)}
            </div>
            {posted.length > 0 && (
              <div style={{ marginTop: 8, fontSize: 12, color: '#d97706' }}>
                {posted.map((b) => (
                  <div key={b.draftId}>
                    ⚠ {b.endedAt.slice(5, 16).replace('T', ' ')} 已用 @{b.handle} 发过这段{b.status === 'unseen' ? '(当时没核对上,可能发出去了)' : ''}
                    {b.tweetId ? ` · 推文 ${b.tweetId}` : ''} —— 再发会重复(只提醒,照样能发)
                  </div>
                ))}
              </div>
            )}
            {(current.article?.warnings ?? plan.warnings).length > 0 && (
              <div style={{ marginTop: 8, fontSize: 12, color: '#d97706' }}>
                {(current.article?.warnings ?? plan.warnings).map((w) => <div key={w}>⚠ {w}</div>)}
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
              {ended.why === 'published'
                ? `上一份已发布:${ended.outcome === 'sent' ? '✅ 核对上了' : ended.outcome === 'unseen' ? '⚠️ 没核对上' : '❌ 没发出去'}`
                : `上一份草稿已撤回(${ENDED_TEXT[ended.why] ?? ended.why})${ended.cleared ? '' : ' ⚠️ 框里的字没清掉,请在 X 上手动删'}`}
            </div>
          )}
        </div>
      )}

      {/** 不能发的原因写出来 —— 只放在按钮提示里,截图上看着像坏了(10-28 用户:「带图片的推文还发不了呀?」) */}
      {blockWhy && fill.phase !== 'filling' && (
        <div style={{ padding: '8px 12px 0', fontSize: 12, color: '#d97706', borderTop: '1px solid var(--border-popup)' }}>现在不能发:{blockWhy}</div>
      )}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', padding: '10px 12px', borderTop: blockWhy && fill.phase !== 'filling' ? 'none' : '1px solid var(--border-popup)' }}>
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
