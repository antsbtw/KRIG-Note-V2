/**
 * 回复确认弹窗 —— 卡片上点「送入回复」后原地弹开。
 *
 * 用户 2026-09-05 定的形态:「放在每一条送入回复这个 button,点击后弹开,
 *   用户确认后就可以回复。如果是人工智能执行,点开后就是人工智能回复后的结果,
 *   最终用户可以对他做再纠正的学习。」
 *
 * ⚠️ 为什么入口在卡片而不是独立页:独立页看不到**原推全文、置信度依据、作者是谁**,
 * 而这些正是判断「该不该这么回」的依据。把草稿拉到另一个页面,
 * 等于让用户在信息更少的地方做同一个决定。
 *
 * ⚠️⚠️ 红线:本弹窗只把正文**填进** X 回复框(走 pasteReply,它也只填不点),
 * **发布那一下永远由用户在 X 页面上点**。刻意没有「确认并发布」。
 *
 * 学习期:每次「填入 X」或「跳过」都记一条 x_reply_feedback
 * (AI 原文 vs 用户最终发的),这是「什么时候能放手自动」的唯一判据来源。
 */
import { useEffect, useState } from 'react';
import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import type { XExtractionApi } from '@capabilities/x-extraction';
import type { TweetInboxRecord } from '@shared/types/x-timeline-types';
import type { ReplyDraft, ReplySkip, ReplySkipReason, PosterKind, ReplyDismissReason } from '@shared/types/x-reply-types';

const api = () => window.electronAPI?.xTimeline;

/** ① 的显示 —— 刻意区分「判断」与「事实」,unclear 不该被藏起来 */
const POSTER_LABEL: Record<PosterKind, string> = {
  genuine:  '像真实用户',
  promoter: '像同行推广',
  bot:      '像机器人/水军',
  unclear:  '看不出来',
};
const POSTER_COLOR: Record<PosterKind, string> = {
  genuine:  '#16a34a',
  promoter: '#b45309',
  bot:      '#7f1d1d',
  unclear:  '#57534e',
};

/**
 * ⭐ 否决原因的人话标签。
 * ⚠️ 用枚举不用自由文本:自由文本统计不出规律,而这层的目的正是统计。
 * ⚠️ `Record<ReplyDismissReason, string>` —— 加了新原因忘写标签会**编译不过**。
 */
const DISMISS_LABEL: Record<ReplyDismissReason, string> = {
  off_topic: '答非所问',
  too_salesy: '太像广告',
  wrong_tone: '语气不对',
  factual_error: '事实错误',
  should_not_reply: '这条不该回',
  other: '其他',
};

const SKIP_LABEL: Record<ReplySkipReason, string> = {
  ai_declined:     'AI 判定这条不值得回',
  /** ⚠️ 与 ai_declined 分开:模型**没答**这条(故障,可重跑),不是「说不该回」 */
  ai_no_answer: '模型没答(可重跑)',
  low_confidence:  'AI 置信度不足',
  duplicate_text:  '模板刷屏(同一句话反复出现)',
  author_recent:   '该作者近期已回过',
  already_replied: '这条已经回过了',
  blocked_author:  '该作者在屏蔽名单里',
};

interface Props {
  tweet: TweetInboxRecord;
  workspaceId: string;
  onClose: () => void;
  /** 填入成功后通知外层(用于把卡片标记成已处理) */
  onFilled?: (tweetId: string) => void;
}

export function ReplyComposeDialog({ tweet, workspaceId, onClose, onFilled }: Props) {
  const [draft, setDraft] = useState<ReplyDraft | null>(null);
  const [skip, setSkip] = useState<ReplySkip | null>(null);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('AI 正在为这条写回复…');
  const [filled, setFilled] = useState(false);
  /**
   * ⭐⭐ **否决原因** —— 学习信号第一层(2026-09-24 用户拍板)。
   *
   * ── 为什么只在否决时问 ──
   * 实测 425 条反馈里 `filled` **424**、`dismissed` **1**,
   * `edited` **425/425 全 false` —— 学习信号几乎只有「采用」,
   * 模型**学不到「哪里不好」**。
   * ⭐ 正因否决只占 1/425,**每一条都金贵**,值得多问一句;
   *   而采用是常态,弹窗会打断人的正常节奏 —— 所以**只在否决时问**。
   */
  const [askingWhy, setAskingWhy] = useState(false);
  const [whyNote, setWhyNote] = useState('');

  const xApi = requireCapabilityApi<XExtractionApi>('x-extraction');

  const [retrying, setRetrying] = useState(false);

  /**
   * 重新生成 —— 主要用途是**画像没采到时再试一次**。
   * 采不到的原因分两类:网络慢/页面没加载完(重试有用)、
   * 私密号/已注销(重试无用)。决定权交给用户,别替他判定「这条不许回」。
   */
  const regenerate = async () => {
    setRetrying(true);
    setStatus('正在重新采集账号资料并生成…');
    try {
      const wcId = xApi.getXHostWcId(workspaceId) ?? undefined;
      const r = await api()?.planOneReply(workspaceId, tweet.tweet_id, wcId);
      if (!r?.success) { setStatus(`重试失败:${r?.error ?? '未知错误'}`); return; }
      if (r.draft) { setDraft(r.draft); setText(r.draft.text); setSkip(null); setStatus(''); }
      else if (r.skip) { setSkip(r.skip); setDraft(null); setStatus(''); }
    } catch (err) {
      setStatus(`重试失败:${String(err)}`);
    } finally {
      setRetrying(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // ⚠️ 必须传 wcId:画像采集/父推抓取都要驱动本 ws 的 X webview,
        //    不传会回退到只在 X 视图挂载时才有值的登记表 → 静默失败
        const wcId = xApi.getXHostWcId(workspaceId) ?? undefined;
        const r = await api()?.planOneReply(workspaceId, tweet.tweet_id, wcId);
        if (cancelled) return;
        if (!r?.success) {
          // fail loud:不给个空框让人以为「AI 没什么可说的」
          setStatus(`生成失败:${r?.error ?? '未知错误'}`);
          return;
        }
        if (r.draft) {
          setDraft(r.draft);
          setText(r.draft.text);
          setStatus('');
        } else if (r.skip) {
          setSkip(r.skip);
          setStatus('');
        } else {
          setStatus('没有产出草稿,也没有给出原因 —— 这不该发生,请重试');
        }
      } catch (err) {
        if (!cancelled) setStatus(`生成失败:${String(err)}`);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [tweet.tweet_id, workspaceId]);

  /** 记学习期反馈 —— 填入与跳过都记,后者说明「这条不该回」 */
  const recordFeedback = async (
    action: 'filled' | 'dismissed',
    finalText: string,
    extra: { dismiss_reason?: ReplyDismissReason; dismiss_note?: string } = {},
  ) => {
    if (!draft) return;
    await api()?.submitReplyFeedback({
      tweet_id:   tweet.tweet_id,
      tweet_text: tweet.text ?? '',
      lang:       draft.lang,
      ai_text:    draft.text,
      source:     draft.source,
      final_text: finalText,
      action,
      ...extra,
      confidence: draft.confidence,
      ref:        draft.ref,
      wsId:       workspaceId,
      // 推断链一并存档 —— 只记正文的话,回错了无从复查是哪一步坏的
      poster_kind: draft.trace?.posterKind,
      poster_read: draft.trace?.posterRead,
      trigger:     draft.trace?.trigger,
      ai_reason:   draft.reason,
      in_thread:   draft.inThread,
      // ⑤ n=1 自动入列要用(回复过的人进追踪名单)
      author_handle: draft.authorHandle,
    }).catch((e: unknown) => {
      // 记不上不该挡住主流程,但要留痕 —— 否则判据会悄悄少样本
      console.error('[ReplyComposeDialog] 反馈记录失败:', e);
    });
  };

  const fillIntoX = async () => {
    if (!draft || !text.trim()) { setStatus('正文为空,没什么可填的'); return; }
    setStatus(`正在打开 @${draft.authorHandle} 的推文并填入…`);
    try {
      const wcId = xApi.getXHostWcId(workspaceId) ?? undefined;
      const r = await xApi.pasteReply('x', draft.tweetUrl, text, wcId);
      if (!r?.success) { setStatus(`填入失败:${r?.error ?? '未知错误'}`); return; }
      await recordFeedback('filled', text);
      setFilled(true);
      onFilled?.(tweet.tweet_id);
      setStatus(r.publishReady
        ? '已填入回复框 —— 请在 X 页面确认后点「回复」发布'
        : '已填入,但没找到发布按钮(可能需要你在页面上点开回复框)');
    } catch (err) {
      setStatus(`填入失败:${String(err)}`);
    }
  };

  /**
   * ⭐ 点「跳过」先问为什么 —— ⚠️ 没有草稿时(模型没给)直接关,没什么可问的。
   */
  const dismiss = () => {
    if (!draft) { onClose(); return; }
    setAskingWhy(true);
  };

  /** 选了原因才真正落库 */
  const dismissWith = async (reason: ReplyDismissReason) => {
    await recordFeedback('dismissed', text, {
      dismiss_reason: reason,
      /** ⚠️ 只有 other 才带自由说明 —— 别的原因带上会让统计混入噪音 */
      dismiss_note: reason === 'other' ? whyNote.trim() || undefined : undefined,
    });
    onClose();
  };

  const edited = !!draft && text.trim() !== draft.text.trim();

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(620px, 92vw)', maxHeight: '86vh', overflow: 'auto',
          background: 'var(--bg)', color: 'var(--text)',
          border: '1px solid var(--border)', borderRadius: 10, padding: 14,
          boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
        }}
      >
        {/* 原推 —— 判断「该不该这么回」的依据,必须在同一屏 */}
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>
          回复 <b style={{ color: 'var(--text)' }}>@{tweet.author_handle?.replace(/^@/, '')}</b>
          {draft && <span style={{ marginLeft: 8 }}>置信 {draft.confidence.toFixed(2)}</span>}
          {draft && (
            <span style={{
              marginLeft: 8, padding: '1px 5px', borderRadius: 4, fontSize: 10,
              background: 'var(--border)',
            }}>{draft.lang === 'zh' ? '中文' : 'EN'}</span>
          )}
        </div>
        <div style={{
          fontSize: 12, lineHeight: 1.6, padding: 8, borderRadius: 6,
          background: 'var(--bg-secondary)', border: '1px solid var(--border)',
          marginBottom: 10, whiteSpace: 'pre-wrap',
        }}>
          {tweet.text}
        </div>

        {loading && (
          <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '14px 2px' }}>
            {status || 'AI 正在为这条写回复…'}
          </div>
        )}

        {/* 被前置规则或 AI 挡掉 —— 说清楚为什么,不给空框 */}
        {!loading && skip && (
          <div style={{
            fontSize: 12, padding: 10, borderRadius: 6, marginBottom: 10,
            background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.3)',
            color: '#fbbf24',
          }}>
            <b>没有生成回复:{SKIP_LABEL[skip.skipReason] ?? skip.skipReason}</b>
            {skip.detail && <div style={{ marginTop: 4, color: 'var(--text-muted)' }}>{skip.detail}</div>}
            <div style={{ marginTop: 6, color: 'var(--text-muted)' }}>
              你仍可以「查看原推」自己手动回复。
            </div>
          </div>
        )}

        {!loading && !skip && !draft && status && (
          // whiteSpace:pre-line —— 错误信息里带换行的修法提示要能显示出来
          // (如「账号未识别」那条会告诉用户具体去哪点哪个按钮)
          <div style={{
            fontSize: 12, color: '#fca5a5', padding: '10px 2px',
            whiteSpace: 'pre-line', lineHeight: 1.6,
          }}>{status}</div>
        )}

        {draft && (
          <>
            {/* 推断链 —— 让用户在发之前就能核对 AI 是怎么想的,
                也是事后回归分析的同一份数据(落进 x_reply_feedback)。 */}
            {draft.trace && (draft.trace.trigger || draft.trace.posterRead) && (
              <div style={{
                fontSize: 11, lineHeight: 1.7, marginBottom: 8, padding: '7px 9px',
                borderRadius: 6, background: 'var(--bg-secondary)',
                border: '1px solid var(--border)', color: 'var(--text-muted)',
              }}>
                <div>
                  <b style={{ color: 'var(--text)' }}>① 对方是</b>{' '}
                  <span style={{
                    padding: '1px 5px', borderRadius: 4, fontSize: 10,
                    background: POSTER_COLOR[draft.trace.posterKind] ?? 'var(--border)',
                    color: '#fff',
                  }}>{POSTER_LABEL[draft.trace.posterKind]}</span>
                  {draft.trace.posterRead && <span>　{draft.trace.posterRead}</span>}
                </div>
                {draft.trace.trigger && (
                  <div><b style={{ color: 'var(--text)' }}>② 因由</b>　{draft.trace.trigger}</div>
                )}
                {draft.reason && (
                  <div><b style={{ color: 'var(--text)' }}>③ 判断</b>　{draft.reason}</div>
                )}
                <div style={{ marginTop: 3, color: 'var(--text-faint)', fontSize: 10 }}>
                  {draft.trace.hasAccountFacts ? (
                    <>ⓘ ①<b>有账号资料撑着</b>（粉丝数/注册时间/简介已采集），不是只读正文猜的。</>
                  ) : (
                    <>
                      ⓘ ①是 AI <b>只读正文</b>得出的印象 —— 这个账号<b>没采到资料</b>，判断可信度有限。
                      {draft.trace.profileError && (
                        <div style={{ marginTop: 2, color: '#fbbf24' }}>
                          原因：{draft.trace.profileError}
                        </div>
                      )}
                      <div style={{ marginTop: 3 }}>
                        <Btn onClick={regenerate} disabled={retrying}
                          style={{ fontSize: 10, padding: '1px 7px' }}>
                          {retrying ? '重试中…' : '🔄 重新采集并生成'}
                        </Btn>
                        <span style={{ marginLeft: 6, color: 'var(--text-faint)' }}>
                          网络慢/页面没加载完时重试有用；私密号或已注销则重试也没用。
                        </span>
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}

            <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4 }}>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                {draft.source === 'generated' ? 'AI 写的回复' : '模板兜底'}
              </span>
              {draft.source === 'template' && draft.fallbackReason && (
                <span style={{ fontSize: 10, color: '#fbbf24' }}>
                  ⚠️ {draft.fallbackReason}
                </span>
              )}
              {edited && (
                <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>✎ 你改过了</span>
              )}
              <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--text-faint)' }}>
                {text.length} 字
              </span>
            </div>

            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={5}
              style={{
                width: '100%', boxSizing: 'border-box', fontSize: 13, lineHeight: 1.6,
                background: 'var(--bg-secondary)', color: 'var(--text)',
                border: '1px solid var(--border)', borderRadius: 6, padding: 8,
                fontFamily: 'inherit', resize: 'vertical',
              }}
            />

            <div style={{
              fontSize: 10, color: 'var(--text-faint)', marginTop: 4,
            }}>
              改动只作用于这一条，不会影响其他回复。ref={draft.ref}
            </div>

            {/* ⚠️ 串里的一条 —— AI 没看到上文,是猜着回的。必须让用户知道。
                生成时只喂了 tweet.text(见 planOneReply):
                对独立求助推没问题(本来就没上文),对串内回复可能答非所问。 */}
            {draft.inThread && (
              <div style={{
                fontSize: 11, color: '#fbbf24', marginTop: 8,
                background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.3)',
                borderRadius: 5, padding: '6px 9px',
              }}>
                ⚠️ 这条推是<b>回复串里的一条</b>，而 AI <b>只看到了它本身、没有上文</b>。
                请点「查看原推」确认对方在说什么，再决定这样回合不合适。
              </div>
            )}

            <div style={{
              fontSize: 11, color: 'var(--text-muted)', marginTop: 8,
              background: 'var(--bg-secondary)', border: '1px solid var(--border)',
              borderRadius: 5, padding: '5px 8px',
            }}>
              ⚠️ 点「填入 X」只是把正文<b>填进</b>回复框，<b>不会替你发布</b>。
              发布请在 X 页面上自己点。
            </div>

            {/**
              * ⭐⭐ **否决时问一句为什么** —— 学习信号第一层。
              * 实测 425 条里否决只有 1 条,**每一条都金贵**;
              * 而采用是常态(424/425),所以**只在这里问**,不打断正常节奏。
              */}
            {askingWhy ? (
              <div style={{ marginTop: 10, padding: 10, border: '1px solid #444', borderRadius: 6 }}>
                <div style={{ marginBottom: 8 }}>
                  <b>这条为什么不用?</b>
                  <span style={{ opacity: 0.7, fontSize: 12 }}>
                    {' '}—— 否决很少见,你的理由是目前最有用的改进依据
                  </span>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {(Object.entries(DISMISS_LABEL) as Array<[ReplyDismissReason, string]>)
                    .map(([k, label]) => (
                      <Btn key={k} onClick={() => void dismissWith(k)}>{label}</Btn>
                    ))}
                </div>
                <input
                  value={whyNote}
                  onChange={(e) => setWhyNote(e.target.value)}
                  placeholder="选「其他」时请简单说明(可留空)"
                  style={{
                    width: '100%', marginTop: 8, padding: '6px 8px',
                    background: '#1a1a1a', border: '1px solid #444',
                    borderRadius: 4, color: 'inherit',
                  }}
                />
                <div style={{ marginTop: 8 }}>
                  <Btn onClick={() => setAskingWhy(false)}>← 返回</Btn>
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', gap: 6, marginTop: 10, alignItems: 'center' }}>
                <Btn primary onClick={fillIntoX} disabled={!text.trim()}>
                  {filled ? '↗ 再填一次' : '填入 X'}
                </Btn>
                <Btn onClick={dismiss}>跳过这条</Btn>
                <Btn onClick={onClose} style={{ marginLeft: 'auto' }}>关闭</Btn>
              </div>
            )}
          </>
        )}

        {status && !loading && (draft || skip) && (
          <div style={{ fontSize: 11, color: filled ? '#22c55e' : 'var(--text-muted)', marginTop: 8 }}>
            {status}
          </div>
        )}
      </div>
    </div>
  );
}

function Btn({ onClick, primary, disabled, children, style }: {
  onClick?: () => void; primary?: boolean; disabled?: boolean;
  children: React.ReactNode; style?: React.CSSProperties;
}) {
  return (
    <button
      type="button" onClick={onClick} disabled={disabled}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        padding: '4px 12px', borderRadius: 5, fontSize: 12,
        cursor: disabled ? 'not-allowed' : 'pointer', border: '1px solid',
        background: primary ? 'var(--accent)' : 'var(--border)',
        color: primary ? '#fff' : 'var(--text)',
        borderColor: primary ? 'var(--accent)' : 'var(--text-faint)',
        opacity: disabled ? 0.5 : 1,
        ...style,
      }}
    >
      {children}
    </button>
  );
}
