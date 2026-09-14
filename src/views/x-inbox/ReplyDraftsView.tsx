/**
 * 回放验证台 —— 拿历史人工标注样本跑规划器,看 AI 现在写得怎么样。
 *
 * ⚠️ 这里**不做日常回复**。用户 2026-09-06 指出:
 *   「回复应该是针对每一条推文,而不是总体只有一个 button」——对。
 *   日常回复的入口是**每条卡片上的「送入回复」**(ReplyComposeDialog),
 *   那里能看到原推全文、置信度、作者,是判断「该不该这么回」的地方。
 *   本页原有的「🤖 规划草稿」批量按钮已删 —— 它正是那个「总体一个 button」。
 *
 * ⚠️⚠️ 写方向最高红线:**只填不发**。
 *   「填入 X」走 pasteReply(它自己也只填不点),发布那一下永远由用户在 X 页面上点。
 *   本视图不存在任何「一键全发」——刻意不做,不是没来得及做。
 *
 * 保留它的唯一理由:回放能拿 7000+ 条不可再生的人工标注**离线验证**生成质量,
 * 不需要等新数据、不产生任何副作用。
 *
 * 三处刻意的设计(都有实测依据,别顺手改):
 *  ① **正文可改,但改动不回写模板库** —— 手滑污染模板会影响之后所有回复。
 *  ② **填入后不自动标已回复** —— 填进去 ≠ 你点了发布。库里 replied 采自 X 的
 *     权威字段,让它自己认;没点发布的下次还能再填。
 *  ③ **英文文案标「待审核」** —— 全库 1095 条自身回复里像英文句子的是 0 条,
 *     英文是新写的、未经实战检验。发出去的是产品承诺,得让用户知情。
 */
import { useState } from 'react';
import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import type { XExtractionApi } from '@capabilities/x-extraction';
import type { ReplyDraft, ReplySkip, ReplySkipReason, ReplyTemplateId } from '@shared/types/x-reply-types';
import { REPLY_TEMPLATES, renderTemplate, getTemplate, templatesFor } from '@shared/types/x-reply-types';

const api = () => window.electronAPI?.xTimeline;

/** 跳过原因的人话 —— 让「为什么没回这条」一眼看懂 */
const SKIP_LABEL: Record<ReplySkipReason, string> = {
  ai_declined:     '模型判定不值得回',
  low_confidence:  '置信度不足',
  duplicate_text:  '模板刷屏',
  author_recent:   '该作者近期已回过',
  already_replied: '这条已回过',
  blocked_author:  '已屏蔽',
};

interface Props {
  workspaceId: string;
  onBack: () => void;
}

/** 单条草稿在本次会话里的编辑态 */
interface DraftEdit {
  text: string;
  templateId: ReplyTemplateId;
  /** 已填进 X —— 只是本次会话的痕迹,不写库(填入 ≠ 已发布) */
  filled?: boolean;
}

export function ReplyDraftsView({ workspaceId, onBack }: Props) {
  const [drafts, setDrafts] = useState<ReplyDraft[]>([]);
  const [skips, setSkips] = useState<ReplySkip[]>([]);
  const [edits, setEdits] = useState<Record<string, DraftEdit>>({});
  const [planning, setPlanning] = useState(false);
  const [status, setStatus] = useState('');
  const [showSkips, setShowSkips] = useState(false);
  const [score, setScore] = useState<{
    tp: number; fp: number; tn: number; fn: number;
    precision: number | null; recall: number | null;
  } | null>(null);

  const xApi = requireCapabilityApi<XExtractionApi>('x-extraction');

  /**
   * 回放:拿历史人工标注样本跑一遍规划器。
   *
   * 用途:活动专题还没抓到数据时(worth 只剩个位数、x_campaign_reply 为 0),
   * 先用那 7000+ 条不可再生的人工标注看整套流程的实际效果。
   * ⚠️ 只算不发、不写库;样本自带人工 verdict,故能直接给出一致率。
   */
  const replay = async () => {
    setPlanning(true);
    setStatus('正在回放历史标注样本…(模型判断需要几十秒)');
    try {
      const r = await api()?.replayReplies(workspaceId, 10, 10);
      if (!r?.success) {
        setStatus(`回放失败:${r?.error ?? '未知错误'}`);
        setDrafts([]); setSkips([]); setScore(null);
        return;
      }
      setDrafts(r.drafts ?? []);
      setSkips(r.skips ?? []);
      setScore(r.score ?? null);
      setEdits({});
      setStatus(`回放 ${r.scanned ?? 0} 条历史样本 · 草稿 ${r.drafts?.length ?? 0} 条`);
    } catch (err) {
      setStatus(`回放失败:${String(err)}`);
    } finally {
      setPlanning(false);
    }
  };

  const editOf = (d: ReplyDraft): DraftEdit =>
    edits[d.tweetId] ?? { text: d.text, templateId: d.templateId };

  const setEdit = (tweetId: string, patch: Partial<DraftEdit>) =>
    setEdits((prev) => ({
      ...prev,
      [tweetId]: { ...(prev[tweetId] ?? { text: '', templateId: 'otun_full' }), ...patch } as DraftEdit,
    }));

  /** 换模板 —— 正文跟着换,ref 沿用本批的(ref 按批次,换模板不该换 ref) */
  const switchTemplate = (d: ReplyDraft, templateId: ReplyTemplateId) => {
    const t = getTemplate(templateId);
    setEdit(d.tweetId, { templateId, text: renderTemplate(t, d.ref) });
  };

  /**
   * 填进 X 的回复框。**不点发布** —— 那一下永远是用户的。
   * 也不写 markReplied:填进去不等于发出去,让 X 采集回来的 replied 字段说了算。
   */
  const fillIntoX = async (d: ReplyDraft) => {
    const e = editOf(d);
    if (!e.text.trim()) { setStatus('正文为空,没什么可填的'); return; }
    setStatus(`正在打开 @${d.authorHandle} 的推文并填入…`);
    try {
      const wcId = xApi.getXHostWcId(workspaceId) ?? undefined;
      const r = await xApi.pasteReply('x', d.tweetUrl, e.text, wcId);
      if (r?.success) {
        setEdit(d.tweetId, { filled: true });
        setStatus(
          r.publishReady
            ? `已填入 @${d.authorHandle} 的回复框 —— 请在 X 页面确认后点「回复」发布`
            : `已填入,但没找到发布按钮(可能需要你在页面上点开回复框)`,
        );
      } else {
        setStatus(`填入失败:${r?.error ?? '未知错误'}`);
      }
    } catch (err) {
      setStatus(`填入失败:${String(err)}`);
    }
  };

  const dismiss = (tweetId: string) =>
    setDrafts((prev) => prev.filter((d) => d.tweetId !== tweetId));

  return (
    <div style={{ padding: 12, height: '100%', overflow: 'auto', color: 'var(--text)' }}>
      {/* ── 顶栏 ── */}
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 10, flexWrap: 'wrap' }}>
        <Btn onClick={onBack}>← 返回收件箱</Btn>
        <Btn primary onClick={replay} disabled={planning}>
          {planning ? '回放中…' : '🔁 回放历史样本'}
        </Btn>
        <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 4 }}>{status}</span>
      </div>

      {/* ── 红线提示:让用户始终知道这里不会替他发布 ── */}
      <div style={{
        fontSize: 11, color: 'var(--text-muted)', background: 'var(--bg-secondary)',
        border: '1px solid var(--border)', borderRadius: 6, padding: '6px 9px', marginBottom: 10,
      }}>
        ⚠️ 本页只把正文<b>填进</b> X 的回复框，<b>不会替你点发布</b>。
        发布那一下永远在 X 页面上由你自己点。
      </div>

      {/* ── 回放对账:模型 vs 人工当时的判断 ── */}
      {score && (
        <div style={{
          fontSize: 11, border: '1px solid var(--border)', borderRadius: 6,
          padding: '7px 9px', marginBottom: 10, background: 'var(--bg-secondary)',
        }}>
          <b>回放对账</b>(拿历史人工标注当答案,只算不发)
          <div style={{ marginTop: 4, color: 'var(--text-muted)' }}>
            精确率 {score.precision === null ? '—' : `${(score.precision * 100).toFixed(1)}%`}
            <span style={{ color: 'var(--text-faint)' }}>(说该回的里真该回的)</span>
            {'　'}
            召回率 {score.recall === null ? '—' : `${(score.recall * 100).toFixed(1)}%`}
            <span style={{ color: 'var(--text-faint)' }}>(真该回的抓住了多少)</span>
          </div>
          <div style={{ marginTop: 3, color: 'var(--text-faint)' }}>
            真阳 {score.tp} · 假阳 {score.fp} · 真阴 {score.tn} · 假阴 {score.fn}
          </div>
        </div>
      )}

      {/* ── 草稿列表 ── */}
      {drafts.length === 0 && !planning && (
        <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '18px 4px' }}>
          点「🔁 回放历史样本」拿历史人工标注跑一遍，看看 AI 现在写得怎么样。
          <div style={{ marginTop: 6, color: 'var(--text-faint)' }}>
            日常回复请回收件箱，在每条推文卡片上点「送入回复」——
            回复是逐条的事，这里只做验证。
          </div>
        </div>
      )}

      {drafts.map((d) => {
        const e = editOf(d);
        const pool = templatesFor(d.lang);
        const dirty = e.text !== d.text;
        return (
          <div key={d.tweetId} style={{
            border: '1px solid var(--border)', borderRadius: 8, padding: 10, marginBottom: 9,
            background: 'var(--bg-secondary)', opacity: e.filled ? 0.65 : 1,
          }}>
            {/* 头:作者 + 置信度 + 语言 */}
            <div style={{ display: 'flex', gap: 7, alignItems: 'center', fontSize: 11, marginBottom: 6, flexWrap: 'wrap' }}>
              <b style={{ fontSize: 12 }}>@{d.authorHandle}</b>
              <span style={{ color: 'var(--text-muted)' }}>置信 {d.confidence.toFixed(2)}</span>
              <span style={{
                padding: '1px 5px', borderRadius: 4, fontSize: 10,
                background: 'var(--border)', color: 'var(--text-muted)',
              }}>{d.lang === 'zh' ? '中文' : 'EN'}</span>
              <span style={{ color: 'var(--text-muted)' }}>{d.reason}</span>
            </div>

            {/* 待发正文 —— 可改,改动不回写模板库 */}
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4 }}>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>待发正文</span>
              <select
                value={e.templateId}
                onChange={(ev) => switchTemplate(d, ev.target.value as ReplyTemplateId)}
                style={{
                  fontSize: 11, background: 'var(--bg)', color: 'var(--text)',
                  border: '1px solid var(--border)', borderRadius: 4, padding: '1px 4px',
                }}
              >
                {pool.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>
              {dirty && (
                <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                  ✎ 已手改(仅本条，不影响模板库)
                </span>
              )}
            </div>

            <textarea
              value={e.text}
              onChange={(ev) => setEdit(d.tweetId, { text: ev.target.value })}
              rows={4}
              style={{
                width: '100%', boxSizing: 'border-box', fontSize: 12, lineHeight: 1.5,
                background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--border)',
                borderRadius: 5, padding: 7, fontFamily: 'inherit', resize: 'vertical',
              }}
            />

            {/* 英文文案没有语料依据 —— 必须显眼提示 */}
            {d.needsHumanReview && (
              <div style={{
                fontSize: 11, color: '#fbbf24', marginTop: 5,
                background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.3)',
                borderRadius: 5, padding: '5px 8px',
              }}>
                ⚠️ 这条英文文案<b>没有语料依据</b>（历史回复里没有英文句子），
                是按中文原意新写的，<b>未经实战检验</b> —— 发之前请先过目。
              </div>
            )}

            <div style={{ display: 'flex', gap: 5, marginTop: 7, alignItems: 'center', flexWrap: 'wrap' }}>
              <Btn primary onClick={() => fillIntoX(d)}>
                {e.filled ? '↗ 再填一次' : '填入 X'}
              </Btn>
              <Btn onClick={() => dismiss(d.tweetId)}>跳过</Btn>
              {e.filled && (
                <span style={{ fontSize: 11, color: '#22c55e' }}>
                  已填入，待你在 X 点发布
                </span>
              )}
              <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--text-faint)' }}>
                ref={d.ref}
              </span>
            </div>
          </div>
        );
      })}

      {/* ── 跳过的:折叠,但能展开看原因(不静默丢) ── */}
      {skips.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <Btn sm onClick={() => setShowSkips((v) => !v)}>
            {showSkips ? '▾' : '▸'} 已跳过 {skips.length} 条
          </Btn>
          {showSkips && (
            <div style={{ marginTop: 6 }}>
              {skips.map((s) => (
                <div key={s.tweetId} style={{
                  fontSize: 11, color: 'var(--text-muted)', padding: '3px 6px',
                  borderBottom: '1px solid var(--border)',
                }}>
                  <b>@{s.authorHandle || '?'}</b>
                  <span style={{ marginLeft: 6 }}>{SKIP_LABEL[s.skipReason] ?? s.skipReason}</span>
                  {s.detail && <span style={{ marginLeft: 6, color: 'var(--text-faint)' }}>{s.detail}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// 与 XInboxView 的 Btn 同款(该文件内联定义,这里重复一份避免跨文件导出改动)
function Btn({ onClick, primary, sm, disabled, children, style }: {
  onClick?: () => void; primary?: boolean; sm?: boolean; disabled?: boolean;
  children: React.ReactNode; style?: React.CSSProperties;
}) {
  return (
    <button
      type="button" onClick={onClick} disabled={disabled}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        padding: sm ? '2px 7px' : '3px 10px',
        borderRadius: 5, fontSize: sm ? 11 : 12, cursor: disabled ? 'not-allowed' : 'pointer',
        border: '1px solid',
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
