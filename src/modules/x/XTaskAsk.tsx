/**
 * ⭐⭐ 求关卡(2026-10-17,第 1 阶段:采推文 → 选推文 → 拟留言)
 *
 * 用户 10-17:「采集这个人的前10条推文,分析完毕,选择一条和互关相关的,点赞、留言求关、关注。三个动作。
 *  分析--要用那一条推文求关?留言--需要AI学习我的求关习惯,给出建议,我来修正。」
 * 「如果没有求关,bio也没有求关,先放弃这个人。」
 *
 * 勾的这一批逐个人来:准备(主进程采他主页最新一页 + 选推文)→ 出卡 → 人看 / 换一条 / 改留言 / 跳过。
 * ⚠️ 第 1 阶段**不执行**三个动作(第 2 阶段接上);留言先给模板 —— 模板是我(Claude)定的占位,不是用户的写法,
 *    第 3 阶段换成 AI 学用户的求关回复。
 */
import { useEffect, useState, type ReactElement } from 'react';
import { xDataCall } from './x-data-types';
import type { AskPrepared } from './x-ask-prepare';
import type { AskTweet } from './x-ask-plan';

export type AskWho = { readonly restId: string; readonly handle: string; readonly name?: string };

/** ⚠️ 占位模板(Claude 10-17 拟的,不是用户的话)—— 第 3 阶段由 AI 按用户习惯给建议 */
const DRAFT_TEMPLATE = '你好～看到你在找互关，已关注你啦，求回关 🙏';

type Done = { readonly who: AskWho; readonly outcome: string };

export function AskRun({ wsId, queue, onEnd }: { wsId: string; queue: readonly AskWho[]; onEnd: (done: readonly Done[]) => void }): ReactElement {
  const [i, setI] = useState(0);
  const [prep, setPrep] = useState<AskPrepared | null>(null);
  const [loading, setLoading] = useState(false);
  const [sel, setSel] = useState<AskTweet | null>(null);
  const [draft, setDraft] = useState(DRAFT_TEMPLATE);
  const [done, setDone] = useState<Done[]>([]);
  const who = queue[i];

  useEffect(() => {
    if (!who) return;
    let alive = true;
    setLoading(true); setPrep(null); setSel(null); setDraft(DRAFT_TEMPLATE);
    void xDataCall({ op: 'askPrepare', wsId, restId: who.restId, handle: who.handle }).then((r) => {
      if (!alive) return;
      setLoading(false);
      const v: AskPrepared = r.status === 'ok' ? (r.value as AskPrepared) : { ok: false, why: r.reason };
      setPrep(v);
      if (v.ok && v.plan.kind !== 'skip') setSel(v.plan.tweet);
    });
    return () => { alive = false; };
  }, [wsId, who]);

  const next = (outcome: string): void => {
    const d = [...done, { who: who!, outcome }];
    setDone(d);
    if (i + 1 >= queue.length) onEnd(d); else setI(i + 1);
  };

  if (!who) return <div />;
  const plan = prep?.ok ? prep.plan : null;
  /** 换一条:相关的在前,再按时间 */
  const pool = plan ? [...plan.recent.filter((t) => t.related), ...plan.recent.filter((t) => !t.related)] : [];
  const cycle = (): void => {
    if (pool.length === 0) return;
    const at = pool.findIndex((t) => t.id === sel?.id);
    setSel(pool[(at + 1) % pool.length]);
  };

  return (
    <div style={{ border: '1px solid var(--border-color, #2a2a2a)', borderRadius: 6, padding: 10, fontSize: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <strong>求关 {i + 1}/{queue.length}:{who.name ?? who.handle} @{who.handle}</strong>
        <button type="button" style={{ fontSize: 11 }} onClick={() => onEnd(done)}>结束这一批</button>
      </div>
      {loading && <div style={{ marginTop: 6, opacity: 0.8 }}>正在采他主页最新的推文(左边会跳到他主页)…</div>}
      {prep && !prep.ok && (
        <div style={{ marginTop: 6 }}>
          <div style={{ color: '#f87171' }}>没准备好:{prep.why}</div>
          <button type="button" style={{ marginTop: 6 }} onClick={() => next(`没准备好:${prep.why}`)}>下一个</button>
        </div>
      )}
      {prep?.ok && prep.ledgerProblem && <div style={{ marginTop: 6, color: '#fbbf24' }}>⚠️ 这一页账没对上:{prep.ledgerProblem}</div>}
      {plan?.kind === 'skip' && (
        <div style={{ marginTop: 6 }}>
          <div>放弃:{plan.why}</div>
          {plan.recent.length > 0 && prep?.ok && !prep.ledgerProblem
            ? <div style={{ opacity: 0.7 }}>已记成「算法排除」,不再出现在候选里(人可以在人卡里取消排除)</div>
            : <div style={{ opacity: 0.7 }}>没排除 —— 是我们没采到,不算他没求关</div>}
          <button type="button" style={{ marginTop: 6 }} onClick={() => next(`放弃:${plan.why}`)}>下一个</button>
        </div>
      )}
      {plan && plan.kind !== 'skip' && sel && (
        <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ opacity: 0.75 }}>{plan.why}</div>
          <div style={{ padding: 8, background: 'var(--accent-bg, rgba(45,74,107,0.35))', borderRadius: 4 }}>
            <div style={{ opacity: 0.6 }}>
              用这条求关{sel.related ? '(和互关相关)' : '(他最新的原创)'}{sel.createdAt ? ` · ${new Date(sel.createdAt).toLocaleString()}` : ''}
            </div>
            <div style={{ whiteSpace: 'pre-wrap', marginTop: 4 }}>{sel.text}</div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" disabled={pool.length < 2} onClick={cycle}>换一条({pool.length} 条可选)</button>
            <button type="button" onClick={() => next('跳过(人)')}>跳过此人</button>
          </div>
          <div style={{ opacity: 0.6 }}>留言(现在是模板;以后 AI 学你的求关回复给建议,你来改)</div>
          <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={3} style={{ width: '100%', boxSizing: 'border-box' }} />
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button type="button" disabled title="下一步接上:点赞 → 留言 → 关注,每步核对">点赞 · 留言 · 关注</button>
            <span style={{ opacity: 0.6 }}>(三个动作下一步接上)</span>
            <button type="button" onClick={() => next(`看过,未执行 · 推文 ${sel.id}`)}>下一个</button>
          </div>
        </div>
      )}
    </div>
  );
}
