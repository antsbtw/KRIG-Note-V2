/**
 * ⭐⭐ 求关卡(2026-10-17,第 1 阶段:采推文 → 选推文 → 拟留言)
 *
 * 用户 10-17:「采集这个人的前10条推文,分析完毕,选择一条和互关相关的,点赞、留言求关、关注。三个动作。
 *  分析--要用那一条推文求关?留言--需要AI学习我的求关习惯,给出建议,我来修正。」
 * 「如果没有求关,bio也没有求关,先放弃这个人。」
 *
 * 勾的这一批逐个人来:准备(主进程采他主页最新一页 + 选推文)→ 出卡 → 人看 / 换一条 / 改留言 / 跳过。
 * 第 2 阶段(10-17):「点赞 · 留言 · 关注」真执行(主进程 x-ask-run.ts,每步核对,哪步没成停在哪步)。
 * ⭐ 留言:10-17 起先由用户亲手写(「看来还是我自己先训练吧」);10-21 用户:「建议这里跳出一个Gemma草拟的答复吧。
 *    如果不满意我再修改,如何?」→ 选好推文自动请 Gemma 4 12B 照你写过的范例草拟一句填进来,你改;可「换一版」。
 *    发出去时带上原稿:一字没改记 ai,改过记 human(只有 human 进范例库)。
 */
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { xDataCall } from './x-data-types';
import { getXHostState } from './x-host-registry';
import { X_PAGE_NAME } from './x-pages';
import { xPageBusy } from './x-unfollow-run';
import { threadForPrompt, type EngageThread } from './x-engage-thread-model';
import type { AskPrepared } from './x-ask-prepare';
import type { AskTweet } from './x-ask-plan';
import type { AskRunResult, StepState } from './x-ask-run';

export type AskWho = {
  readonly restId: string; readonly handle: string; readonly name?: string;
  /** 互动卡:他找过我的那条(回它)—— 2026-10-22 */
  readonly hisTweetId?: string;
};

const STEP: Record<StepState, string> = { ok: '✓', already: '· 本来就是', unseen: '? 没看到', failed: '✗' };
const stepLine = (r: AskRunResult, engage = false): string =>
  `点赞 ${r.liked ? STEP[r.liked] : '—'} · ${engage ? '回复' : '留言'} ${r.replied ? STEP[r.replied] : '—'}${engage ? '' : ` · 关注 ${r.followed ? STEP[r.followed] : '—'}`}`;

type Done = { readonly who: AskWho; readonly outcome: string };

export function AskRun({ wsId, queue, onEnd, onActed, onPersonDone, mode = 'ask' }: {
  wsId: string; queue: readonly AskWho[]; onEnd: (done: readonly Done[]) => void;
  /**
   * ⭐ engage = 已互关蓝V的日常互动卡(2026-10-22,用户选「和求关卡一样」):点赞 + 回复,不关注;
   * Gemma 用日常互动的口吻;记进 x_engage。不给 = 求关卡
   */
  mode?: 'ask' | 'engage';
  /** 动过手(不管成没成)→ 父组件刷新「今天已关注 / 累计」那一行 */
  onActed?: () => void;
  /**
   * ⭐ 每过完一个人(完成 / 放弃 / 跳过)→ 父组件刷新候选名单
   * (用户 10-17:「对于放弃的蓝V就不要再放到列表了」—— 库里已排除,原来要等整批结束才刷新)
   */
  onPersonDone?: () => void;
}): ReactElement {
  const [i, setI] = useState(0);
  const [prep, setPrep] = useState<AskPrepared | null>(null);
  const [loading, setLoading] = useState(false);
  const [sel, setSel] = useState<AskTweet | null>(null);
  const [draft, setDraft] = useState('');
  const [acting, setActing] = useState(false);
  const [result, setResult] = useState<AskRunResult | null>(null);
  const [done, setDone] = useState<Done[]>([]);
  /** ⭐ Gemma 原稿 / 正在草拟 / 草拟没成的原因 */
  const [aiText, setAiText] = useState<string | undefined>(undefined);
  const [drafting, setDrafting] = useState(false);
  /** 点帖子没跳过去的原因 */
  const [viewNote, setViewNote] = useState<string | null>(null);
  /**
   * ⭐ 互动卡:选中那条的来龙去脉(原帖 → 来回 → 这条)。用户 10-22:「原帖是那个,第一轮互动是那些,第二轮互动是那些。
   * 这样才完整。」「最好办法是找到这个互动帖子的原帖。」换了一条就重读。
   */
  const [thread, setThread] = useState<(EngageThread & { fetchNote?: string; forId: string }) | null>(null);
  const [threadLoading, setThreadLoading] = useState(false);
  const [draftNote, setDraftNote] = useState<string | null>(null);
  const draftSeq = useRef(0);
  const who = queue[i];
  const E = mode === 'engage';

  useEffect(() => {
    if (!who) return;
    let alive = true;
    setLoading(true); setPrep(null); setSel(null); setThread(null); setDraft(''); setResult(null); setAiText(undefined); setDraftNote(null); setViewNote(null);
    const prepCall = mode === 'engage'
      ? xDataCall({ op: 'engagePrepare', wsId, restId: who.restId, handle: who.handle, hisTweetId: who.hisTweetId })
      : xDataCall({ op: 'askPrepare', wsId, restId: who.restId, handle: who.handle });
    void prepCall.then((r) => {
      if (!alive) return;
      setLoading(false);
      const v: AskPrepared = r.status === 'ok' ? (r.value as AskPrepared) : { ok: false, why: r.reason };
      setPrep(v);
      if (v.ok && v.plan.kind !== 'skip') {
        setSel(v.plan.tweet);
        setThread(v.thread ? { ...v.thread, forId: v.plan.tweet.id } : { chain: [], gapAbove: true, later: [], forId: v.plan.tweet.id });
      }
    });
    return () => { alive = false; };
  }, [wsId, who, mode]);

  /**
   * ⭐ 请 Gemma 草拟一句(对着当前选中的推文)。后发的请求盖掉先发的(换推文 / 换一版连点时只认最后一次)。
   * ⚠️ 你已经动手改了留言,就不再自动覆盖 —— 只有你点「换一版」才换。
   */
  const requestDraft = useCallback(async (tweetText: string, force: boolean): Promise<void> => {
    const seq = ++draftSeq.current;
    setDrafting(true); setDraftNote(null);
    const r = await xDataCall({ op: 'askDraft', wsId, tweetText, name: prep?.ok ? prep.person.name : undefined, bio: prep?.ok ? prep.person.bio : undefined, mode,
      context: E && threadRef.current ? threadForPrompt(threadRef.current) : undefined });
    if (seq !== draftSeq.current) return;
    setDrafting(false);
    const v = r.status === 'ok' ? (r.value as { ok: boolean; text?: string; why?: string; ms?: number; examples?: number }) : { ok: false, why: r.reason };
    if (!v.ok || !v.text) { setDraftNote(`Gemma 没草拟成:${v.why ?? '?'} —— 你直接写也行,或点「换一版」再试`); return; }
    setAiText(v.text);
    setDraft((cur) => (force || cur.trim() === '' || cur === aiTextRef.current ? v.text! : cur));
    setDraftNote(`Gemma 草拟(照你写过的 ${v.examples ?? 0} 条范例,${Math.round((v.ms ?? 0) / 100) / 10} 秒)—— 不满意就改,改过的算你写的`);
  }, [wsId, prep, mode]);
  const aiTextRef = useRef<string | undefined>(undefined);
  const threadRef = useRef<EngageThread | null>(null);
  threadRef.current = thread;
  aiTextRef.current = aiText;
  /** 互动卡换了一条 → 重读那条的来龙去脉(找原帖) */
  useEffect(() => {
    if (!E || !sel || !who || thread?.forId === sel.id) return;
    let alive = true;
    setThreadLoading(true);
    void xDataCall({ op: 'engageThread', wsId, restId: who.restId, tweetId: sel.id }).then((r) => {
      if (!alive) return;
      setThreadLoading(false);
      if (r.status === 'ok') setThread({ ...(r.value as EngageThread & { fetchNote?: string }), forId: sel.id });
      else setThread({ chain: [], gapAbove: true, later: [], fetchNote: `没读到这条的上下文:${r.reason}`, forId: sel.id });
    });
    return () => { alive = false; };
  }, [E, sel, who, wsId, thread?.forId]);
  /** 选好 / 换了推文 → 自动草拟(留言框空着或还是上一版原稿时才填);互动卡等上下文到了再拟 */
  useEffect(() => {
    if (!sel || !prep?.ok) return;
    if (E && thread?.forId !== sel.id) return;
    void requestDraft(sel.text, false);
  }, [sel, prep, requestDraft, E, thread?.forId]);

  /** 左边 X 网页跳到这条原帖;X 网页忙(采集 / 求关在动手)就不跳,说出来 */
  const showInX = async (tweetId: string): Promise<void> => {
    const wcId = getXHostState(wsId)?.wcId;
    if (wcId === undefined) { setViewNote('X 网页没开'); return; }
    const busy = await xPageBusy(wcId);
    if (busy !== null) { setViewNote(`${busy},没跳转(跳走会打断)`); return; }
    const go = await window.electronAPI!.webDomInvoke({ op: 'goto', pageRef: { wcId }, name: X_PAGE_NAME.status, params: { tweetId } });
    setViewNote(go.status === 'failed' ? `没跳过去:${(go as { reason?: string }).reason ?? '?'}` : null);
  };

  /** 跳过此人 = 你排除的(原因「求关时跳过」),以后不再进候选;写不上就留在这儿说清楚,不假装跳过了 */
  const skipPerson = async (): Promise<void> => {
    if (!who) return;
    const r = await xDataCall({ op: 'setExcluded', restId: who.restId, excluded: true, reason: E ? '互动时跳过' : '求关时跳过' });
    if (r.status === 'failed') { setViewNote(`没记上排除:${r.reason}`); return; }
    next('跳过(以后不再出现;人卡里可取消排除)');
  };

  const next = (outcome: string): void => {
    const d = [...done, { who: who!, outcome }];
    setDone(d);
    onPersonDone?.();
    if (i + 1 >= queue.length) onEnd(d); else setI(i + 1);
  };

  if (!who) return <div />;
  const plan = prep?.ok ? prep.plan : null;
  /** 换一条:相关的在前,再按时间 */
  const pool = plan ? [...plan.recent.filter((t) => t.related), ...plan.recent.filter((t) => !t.related)] : [];
  const act = async (): Promise<void> => {
    if (!plan || plan.kind === 'skip' || !sel) return;
    setActing(true); setResult(null);
    const r = await xDataCall({
      op: 'askRun', wsId, restId: who.restId, handle: who.handle, tweetId: sel.id, tweetText: sel.text,
      pickKind: sel.id === plan.tweet.id ? plan.kind : 'other', reply: draft, aiText, mode,
    });
    setActing(false);
    const v: AskRunResult = r.status === 'ok' ? (r.value as AskRunResult) : { ok: false, blocked: r.reason };
    onActed?.();
    /** ⭐ 成了就直接到下一个人(用户 10-17:「执行成功后,自动到下一个人,不要再停留在原来的蓝V用户了」);没成留在这儿给人看 */
    if (v.ok) { next(`✓ ${E ? '互动' : '求关'}完成(${stepLine(v, E)})`); return; }
    setResult(v);
  };
  const cycle = (): void => {
    if (pool.length === 0) return;
    const at = pool.findIndex((t) => t.id === sel?.id);
    setSel(pool[(at + 1) % pool.length]);
  };

  return (
    <div style={{ border: '1px solid var(--border-color, #2a2a2a)', borderRadius: 6, padding: 10, fontSize: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <strong>{E ? '互动' : '求关'} {i + 1}/{queue.length}:{who.name ?? who.handle} @{who.handle}</strong>
        <button type="button" style={{ fontSize: 11 }} onClick={() => onEnd(done)}>结束这一批</button>
      </div>
      {done.length > 0 && (
        <div style={{ marginTop: 4, opacity: 0.7 }}>上一个:@{done[done.length - 1].who.handle} {done[done.length - 1].outcome}</div>
      )}
      {loading && <div style={{ marginTop: 6, opacity: 0.8 }}>正在采他主页最新的推文(左边会跳到他主页)…</div>}
      {prep && !prep.ok && (
        <div style={{ marginTop: 6 }}>
          <div style={{ color: '#f87171' }}>没准备好:{prep.why}</div>
          <button type="button" style={{ marginTop: 6 }} onClick={() => next(`没准备好:${prep.why}`)}>下一个</button>
        </div>
      )}
      {prep?.ok && prep.ledgerProblem && <div style={{ marginTop: 6, color: '#fbbf24' }}>⚠️ 这一页账没对上:{prep.ledgerProblem}</div>}
      {plan?.kind === 'skip' && plan.alreadyRelated && (
        <div style={{ marginTop: 6 }}>
          <div style={{ color: '#5fc98a' }}>{E ? '不互动' : '不求关'}:{plan.why}</div>
          <div style={{ opacity: 0.7 }}>关系已按 X 上看到的写回库,他会从候选里消失(不算排除)</div>
          <button type="button" style={{ marginTop: 6 }} onClick={() => next(`${E ? '不互动' : '不求关'}:${plan.why}`)}>下一个</button>
        </div>
      )}
      {plan?.kind === 'skip' && !plan.alreadyRelated && (
        <div style={{ marginTop: 6 }}>
          <div>放弃:{plan.why}</div>
          {E ? <div style={{ opacity: 0.7 }}>没排除 —— 下次他发了新帖再看</div> : plan.recent.length > 0 && prep?.ok && !prep.ledgerProblem
            ? <div style={{ opacity: 0.7 }}>已记成「算法排除」,不再出现在候选里(人可以在人卡里取消排除)</div>
            : <div style={{ opacity: 0.7 }}>没排除 —— 是我们没采到,不算他没求关</div>}
          <button type="button" style={{ marginTop: 6 }} onClick={() => next(`放弃:${plan.why}`)}>下一个</button>
        </div>
      )}
      {plan && plan.kind !== 'skip' && sel && (
        <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ opacity: 0.75 }}>{plan.why}</div>
          {E && (
            <div style={{ padding: 8, border: '1px solid var(--border-color, #333)', borderRadius: 4 }}>
              <div style={{ opacity: 0.7, marginBottom: 4 }}>
                来龙去脉{threadLoading ? '(读取中,库里缺的会打开详情页补采…)' : ''}{thread?.fetchNote ? ` —— ⚠️ ${thread.fetchNote}` : ''}
              </div>
              {thread?.gapAbove && <div style={{ color: '#fbbf24' }}>⋯ 再往上没找到原帖</div>}
              {thread?.chain.map((x, k) => (
                <div key={x.id} onClick={() => { if (!acting) void showInX(x.id); }} title="在左边 X 网页打开这一条"
                  style={{ cursor: 'pointer', padding: '3px 0 3px 6px', marginLeft: Math.min(k, 6) * 10, borderLeft: `2px solid ${x.isTarget ? '#4a90d9' : x.who === 'me' ? '#5fc98a' : 'var(--border-color, #444)'}` }}>
                  <span style={{ opacity: 0.75 }}>
                    {x.isRoot ? '【原帖】' : `第 ${k} 轮 · `}{x.who === 'me' ? '我' : x.who === 'him' ? `他 @${x.handle ?? who.handle}` : `@${x.handle ?? '别人'}`}
                    {x.at ? ` · ${new Date(x.at).toLocaleString()}` : ''}{x.isTarget ? ' · ← 要回的这条' : ''}
                  </span>
                  <div style={{ whiteSpace: 'pre-wrap' }}>{x.text.length > 240 ? `${x.text.slice(0, 240)}…` : x.text}</div>
                </div>
              ))}
              {(thread?.later.length ?? 0) > 0 && <div style={{ opacity: 0.7, marginTop: 4 }}>之后你们的来回</div>}
              {thread?.later.map((x) => (
                <div key={x.id} onClick={() => { if (!acting) void showInX(x.id); }} style={{ cursor: 'pointer', padding: '2px 0 2px 6px', borderLeft: `2px solid ${x.who === 'me' ? '#5fc98a' : 'var(--border-color, #444)'}` }}>
                  <span style={{ opacity: 0.75 }}>{x.who === 'me' ? '我' : '他'}{x.at ? ` · ${new Date(x.at).toLocaleString()}` : ''}</span>
                  <div style={{ whiteSpace: 'pre-wrap' }}>{x.text.slice(0, 200)}</div>
                </div>
              ))}
            </div>
          )}
          {/* ⭐ 点帖子 → 左边 X 网页打开这条原帖(用户 10-21:「点击截图中的帖子时,左边展示原帖在哪里,什么内容。这样我会更好的判断回复方法的。」) */}
          <div style={{ padding: 8, background: 'var(--accent-bg, rgba(45,74,107,0.35))', borderRadius: 4, cursor: acting ? 'default' : 'pointer' }}
            onClick={() => { if (!acting) void showInX(sel.id); }} title="在左边 X 网页打开这条原帖(看上下文、图片、别人的回复)">
            <div style={{ opacity: 0.6 }}>
              {E ? (sel.related ? '回他找你的这一条' : '回他这一条') : `用这条求关${sel.related ? '(和互关相关)' : '(他最新的原创)'}`}{sel.createdAt ? ` · ${new Date(sel.createdAt).toLocaleString()}` : ''}
              {' · '}<span style={{ textDecoration: 'underline' }}>点一下在左边看原帖</span>
            </div>
            <div style={{ whiteSpace: 'pre-wrap', marginTop: 4 }}>{sel.text}</div>
          </div>
          {viewNote && <div style={{ color: '#fbbf24' }}>{viewNote}</div>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" disabled={pool.length < 2 || acting || result !== null} onClick={cycle}>换一条({pool.length} 条可选)</button>
            {/* ⭐ 用户 10-21:「对于那些跳过的…下一次就不要再列表进来了」→ 记成你排除的(人卡里能取消排除) */}
            <button type="button" disabled={acting} onClick={() => void skipPerson()}
              title={E ? '不和他互动,以后也不再进互动队列(记成你排除的;人卡里可以取消排除)' : '不求关他,以后也不再进候选(记成你排除的;人卡里可以取消排除)'}>跳过此人(以后不再出现)</button>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ opacity: 0.6, flex: 1 }}>
              {drafting ? 'Gemma 正在草拟…' : draftNote ?? '留言(Gemma 草拟,你改;发出去的会记下来)'}
            </span>
            <button type="button" style={{ fontSize: 11 }} disabled={drafting || acting || result?.ok === true}
              onClick={() => void requestDraft(sel.text, true)} title="让 Gemma 对这条推文再写一版(会替换留言框)">换一版</button>
          </div>
          <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={3} disabled={acting || result?.ok === true}
            placeholder={drafting ? 'Gemma 正在草拟…' : E ? '写给他的回复' : '写给他的求关留言'} style={{ width: '100%', boxSizing: 'border-box' }} />
          {aiText !== undefined && draft.trim() !== '' && draft.trim() !== aiText.trim() && (
            <div style={{ opacity: 0.55 }}>已改过 —— 发出去记成你写的(会进范例库);Gemma 原稿:{aiText}</div>
          )}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button type="button" disabled={acting || draft.trim() === '' || result?.ok === true} onClick={() => void act()}
              title={E ? '左边 X 网页:去这条推文点赞 → 贴回复并发送;每步核对,哪步没成停在哪步(不关注,已经互关)' : '左边 X 网页:去这条推文点赞 → 贴留言并发送 → 去他主页关注;每步核对,哪步没成停在哪步'}>
              {acting ? '正在做…' : E ? '点赞 · 回复' : '点赞 · 留言 · 关注'}
            </button>
            <button type="button" disabled={acting}
              title={result ? '' : '这次先不处理他,下次还会在候选里'}
              onClick={() => next(result ? (result.ok ? `✓ ${E ? '互动' : '求关'}完成(${stepLine(result, E)})` : `✗ ${result.blocked ?? result.detail ?? '没做完'}`) : `先放一放 · 推文 ${sel.id}`)}>
              {result ? '下一个' : '先放一放(下次还会出现)'}
            </button>
          </div>
          {result && (
            <div style={{ color: result.ok ? '#5fc98a' : '#f87171' }}>
              {result.blocked ? `没动手:${result.blocked}` : `${result.ok ? `✓ ${E ? '互动' : '求关'}完成` : '✗ 停在这一步'} —— ${stepLine(result, E)}`}
              {result.detail && <div>{result.detail}</div>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
