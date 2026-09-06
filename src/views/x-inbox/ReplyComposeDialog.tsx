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
import type { ReplyDraft, ReplySkip, ReplySkipReason, PosterKind } from '@shared/types/x-reply-types';

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

const SKIP_LABEL: Record<ReplySkipReason, string> = {
  ai_declined:     'AI 判定这条不值得回',
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

  const xApi = requireCapabilityApi<XExtractionApi>('x-extraction');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await api()?.planOneReply(workspaceId, tweet.tweet_id);
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
  const recordFeedback = async (action: 'filled' | 'dismissed', finalText: string) => {
    if (!draft) return;
    await api()?.submitReplyFeedback({
      tweet_id:   tweet.tweet_id,
      tweet_text: tweet.text ?? '',
      lang:       draft.lang,
      ai_text:    draft.text,
      source:     draft.source,
      final_text: finalText,
      action,
      confidence: draft.confidence,
      ref:        draft.ref,
      wsId:       workspaceId,
      // 推断链一并存档 —— 只记正文的话,回错了无从复查是哪一步坏的
      poster_kind: draft.trace?.posterKind,
      poster_read: draft.trace?.posterRead,
      trigger:     draft.trace?.trigger,
      ai_reason:   draft.reason,
      in_thread:   draft.inThread,
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

  const dismiss = async () => {
    if (draft) await recordFeedback('dismissed', text);
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
          <div style={{ fontSize: 12, color: '#fca5a5', padding: '10px 2px' }}>{status}</div>
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
                  ⓘ ①是 AI 读正文得出的推断，<b>不是账号资料</b>（库里没存粉丝数/注册时间）。
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

            <div style={{ display: 'flex', gap: 6, marginTop: 10, alignItems: 'center' }}>
              <Btn primary onClick={fillIntoX} disabled={!text.trim()}>
                {filled ? '↗ 再填一次' : '填入 X'}
              </Btn>
              <Btn onClick={dismiss}>跳过这条</Btn>
              <Btn onClick={onClose} style={{ marginLeft: 'auto' }}>关闭</Btn>
            </div>
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
