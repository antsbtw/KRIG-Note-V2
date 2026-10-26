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
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactElement } from 'react';
import { xDataCall } from './x-data-types';
import { getXHostState, subscribeXHost } from './x-host-registry';
import { tweetIdOfUrl } from './x-tweet-url';
import { openInLeft } from './x-unfollow-run';
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
  mode?: 'ask' | 'engage' | 'vpn';
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
  /** ⭐ 你在左边挑的那条(用户 10-22:「看到一个帖子不错,我可以选择它,然后再由AI草拟留言。我来确认。」) */
  const [leftPick, setLeftPick] = useState<{ id: string; note?: string } | null>(null);
  const [leftLoading, setLeftLoading] = useState(false);
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
  /**
   * ⭐ 点评(用户 10-22:「在回复框增加一个我对AI回复提出要求的窗口(点评),要求AI如何调整回复的内容、语气等。
   *  达到训练AI或者通过AI来找到我想要的回复方法」)—— 写一句怎么改 → Gemma 按它改这一版;
   *  勾「以后都这样」= 成为长期要求,以后每次草拟都带上(下面列出来,可停用)
   */
  const [critique, setCritique] = useState('');
  /** 外语草稿的中文意思(回译)—— 跟着 Gemma 原稿走 */
  const [meaning, setMeaning] = useState<{ forText: string; text?: string; problem?: string } | null>(null);
  const [keepRule, setKeepRule] = useState(false);
  const [rules, setRules] = useState<Array<{ id: string; note: string }>>([]);
  const loadRules = useCallback(() => {
    void xDataCall({ op: 'draftRules', wsId, mode }).then((r) => { if (r.status === 'ok') setRules(r.value as Array<{ id: string; note: string }>); });
  }, [wsId, mode]);
  useEffect(() => { loadRules(); }, [loadRules]);
  const stopRule = async (id: string): Promise<void> => {
    const r = await xDataCall({ op: 'draftRuleActive', wsId, id, active: false });
    if (r.status === 'failed') { setDraftNote(`没停用:${r.reason}`); return; }
    loadRules();
  };
  const draftSeq = useRef(0);
  const who = queue[i];
  /** E = 不关注的两种(互动 / 回复求助);V = 回复求助(2026-10-23) */
  const E = mode !== 'ask';
  const V = mode === 'vpn';
  const LABEL = V ? '回复求助' : E ? '互动' : '求关';

  useEffect(() => {
    if (!who) return;
    let alive = true;
    setLoading(true); setPrep(null); setSel(null); setThread(null); setDraft(''); setResult(null); setAiText(undefined); setDraftNote(null); setViewNote(null); setLeftPick(null);
    const prepCall = mode === 'vpn'
      ? xDataCall({ op: 'vpnPrepare', wsId, tweetId: who.hisTweetId ?? '' })
      : mode === 'engage'
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
  const requestDraft = useCallback(async (tweetText: string, force: boolean, revise?: { previous: string; note: string; keep: boolean }): Promise<void> => {
    const seq = ++draftSeq.current;
    setDrafting(true); setDraftNote(null);
    const r = await xDataCall({ op: 'askDraft', wsId, tweetText, name: prep?.ok ? prep.person.name : undefined, bio: prep?.ok ? prep.person.bio : undefined, mode,
      context: E && threadRef.current ? threadForPrompt(threadRef.current) : undefined, revise, tweetId: selIdRef.current });
    if (seq !== draftSeq.current) return;
    setDrafting(false);
    const v = r.status === 'ok' ? (r.value as { ok: boolean; text?: string; why?: string; ms?: number; examples?: number; rules?: number; noteProblem?: string; meaning?: string; meaningProblem?: string }) : { ok: false, why: r.reason };
    if (!v.ok || !v.text) { setDraftNote(`Gemma 没草拟成:${v.why ?? '?'} —— 你直接写也行,或点「换一版」再试`); return; }
    setAiText(v.text);
    setMeaning(v.meaning || v.meaningProblem ? { forText: v.text, text: v.meaning, problem: v.meaningProblem } : null);
    setDraft((cur) => (force || cur.trim() === '' || cur === aiTextRef.current ? v.text! : cur));
    setDraftNote(`Gemma ${revise ? '按点评改好了' : '草拟'}(照你写过的 ${v.examples ?? 0} 条范例${v.rules ? ` · 长期要求 ${v.rules} 条` : ''},${Math.round((v.ms ?? 0) / 100) / 10} 秒)—— 不满意就改或再点评,改过的算你写的`
      + `${v.noteProblem ? ` · ⚠️ 这次点评没记上:${v.noteProblem}` : ''}`);
    if (revise) { setCritique(''); setKeepRule(false); if (revise.keep) loadRules(); }
  }, [wsId, prep, mode, loadRules]);
  /** 按点评改:改的是框里现在这一版(你动过就按你的改) */
  const reviseDraft = (): void => {
    if (!sel || critique.trim() === '') return;
    const previous = draft.trim() || aiText || '';
    if (previous === '') { setDraftNote('框里还没有留言,先让 Gemma 草拟一版或自己写一句,再点评'); return; }
    void requestDraft(sel.text, true, { previous, note: critique.trim(), keep: keepRule });
  };
  const aiTextRef = useRef<string | undefined>(undefined);
  /** 回复求助草拟要知道是哪条(按配方打试用链接的来源标识) */
  const selIdRef = useRef<string | undefined>(undefined);
  selIdRef.current = sel?.id;
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
    /** ⭐ 打开那一下占着网页(主进程能力 x.page.open);被占着 / 没打开都说出来 */
    const why = await openInLeft(wsId, { tweetId });
    setViewNote(why === null ? null : `${why},没跳转(跳走会打断)`);
  };

  /** 跳过此人 = 你排除的(原因「求关时跳过」),以后不再进候选;写不上就留在这儿说清楚,不假装跳过了 */
  const skipPerson = async (): Promise<void> => {
    if (!who) return;
    /** 回复求助:只把这条记成「不值得回」(你推翻 Gemma,进标注)—— 不排除这个人,免得他从蓝V任务里也消失 */
    if (V) {
      const r = await xDataCall({ op: 'vpnHuman', wsId, tweetId: who.hisTweetId ?? '', human: 'reject' });
      if (r.status === 'failed') { setViewNote(`没记上:${r.reason}`); return; }
      next('不值得回(已记成你的判断,Gemma 以后照着学)');
      return;
    }
    const r = await xDataCall({ op: 'setExcluded', restId: who.restId, excluded: true, reason: E ? '互动时跳过' : '求关时跳过' });
    if (r.status === 'failed') { setViewNote(`没记上排除:${r.reason}`); return; }
    next('跳过(以后不再出现;人卡里可取消排除)');
  };

  /** ⭐ 先放一放:记下来,这几天不再列他(用户 10-23);记不上就留在这儿说清楚,不假装放了 */
  const deferThis = async (): Promise<void> => {
    if (!who) return;
    const r = await xDataCall({ op: 'deferPerson', wsId, restId: who.restId, mode, tweetId: sel?.id });
    if (r.status === 'failed') { setViewNote(`没记上「放一放」:${r.reason}`); return; }
    next(`先放一放(${(r.value as { days: number }).days} 天内不再列出)`);
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
  /** 换一条:按时间新→旧(用户 10-22:「回复推荐以时间顺序优先」) */
  const pool = plan ? [...plan.recent] : [];
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
    if (v.ok) { next(`✓ ${LABEL}完成(${stepLine(v, E)})${v.warning ? ` · ⚠️ ${v.warning}` : ''}`); return; }
    setResult(v);
  };
  /**
   * ⭐⭐ 卡片跟着左边走(用户 10-22:「点击阅读,就代表着要回这个推文了。」)——
   * 左边点开一条帖子(/status/<id>)就回这一条:他最近的帖子里有就直接选,没有就读它(库里没有会补采);
   * 选中后留言框清空,Gemma 对着它重新草拟。动手中 / 已出结果 / 卡还没准备好 → 不跟。
   * ⚠️ 只跟「这张卡准备好之后」左边的变化 —— 打开卡时左边停着的上一页不算(否则会抢到上一个人的帖子)。
   */
  const leftUrl = useSyncExternalStore(subscribeXHost, () => getXHostState(wsId)?.url ?? '');
  const seenUrl = useRef<string | null>(null);
  useEffect(() => { if (prep?.ok) seenUrl.current = leftUrl; else seenUrl.current = null; }, [prep]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    /** ⭐ 「放弃」也跟(用户 10-23:「平台做出判断后,如果我想拉回来,点击对方的推文就可以了。而不是平台作为最后的仲裁者。」);只有 X 上已经是关系了才不跟 */
    if (!prep?.ok || (prep.plan.kind === 'skip' && prep.plan.alreadyRelated) || acting || result !== null || leftLoading) return;
    if (seenUrl.current === null || leftUrl === seenUrl.current) return;
    seenUrl.current = leftUrl;
    const id = tweetIdOfUrl(leftUrl);
    if (!id || id === sel?.id) return;
    void followLeft(id);
  }, [leftUrl, prep, acting, result, leftLoading, sel?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  /**
   * ⭐ 推翻「放弃」:平台判了放弃,你点开他的帖子 = 你要拉回来 —— 撤销这次排除(记成你的决定,算法以后不再改它),
   * 卡片换成用这条求关 / 互动
   */
  const overrule = async (tweet: AskTweet): Promise<boolean> => {
    if (!who || !prep?.ok || prep.plan.kind !== 'skip') return true;
    const r = await xDataCall({ op: 'setExcluded', restId: who.restId, excluded: false, reason: `${LABEL}时你拉回来的(推翻「放弃」)` });
    if (r.status === 'failed') { setViewNote(`没能撤销排除:${r.reason} —— 先没换`); return false; }
    setPrep({ ...prep, plan: { kind: 'other', tweet, recent: prep.plan.recent, why: `你推翻了「放弃」(${prep.plan.why})—— 用你点开的这条${LABEL},已撤销排除` } });
    return true;
  };
  const followLeft = async (id: string): Promise<void> => {
    if (!who) return;
    const inPool = pool.find((t) => t.id === id);
    if (inPool) {
      if (!(await overrule(inPool))) return;
      setLeftPick({ id });
      setDraft(''); setAiText(undefined);
      setSel(inPool);
      return;
    }
    setLeftLoading(true); setViewNote(null);
    const r = await xDataCall({ op: 'leftTweet', wsId });
    setLeftLoading(false);
    if (r.status === 'failed') { setViewNote(`左边这条没读到:${r.reason}`); return; }
    const t = r.value as { id: string; text: string; createdAt?: string; url: string; authorRestId?: string; authorHandle?: string };
    /** 读的时候左边又换了 —— 以最新的为准,这次作废 */
    if (t.id !== tweetIdOfUrl(getXHostState(wsId)?.url ?? '')) return;
    const other = t.authorRestId !== undefined && t.authorRestId !== who.restId;
    setLeftPick({ id: t.id, note: other ? `这条是 @${t.authorHandle ?? '?'} 发的,不是 @${who.handle} —— 点赞 / 留言发在这条下面${E ? '' : `,关注的还是 @${who.handle}`}` : undefined });
    const picked: AskTweet = { id: t.id, text: t.text, createdAt: t.createdAt, url: t.url, related: false };
    if (!(await overrule(picked))) return;
    setDraft(''); setAiText(undefined);
    setSel(picked);
  };
  const cycle = (): void => {
    if (pool.length === 0) return;
    const at = pool.findIndex((t) => t.id === sel?.id);
    setSel(pool[(at + 1) % pool.length]);
  };

  return (
    <div style={{ border: '1px solid var(--border-color, #2a2a2a)', borderRadius: 6, padding: 10, fontSize: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <strong>{LABEL} {i + 1}/{queue.length}:{who.name ?? who.handle} @{who.handle}</strong>
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
          <div style={{ color: '#5fc98a' }}>{V ? '不回' : E ? '不互动' : '不求关'}:{plan.why}</div>
          <div style={{ opacity: 0.7 }}>关系已按 X 上看到的写回库,他会从候选里消失(不算排除)</div>
          <button type="button" style={{ marginTop: 6 }} onClick={() => next(`${V ? '不回' : E ? '不互动' : '不求关'}:${plan.why}`)}>下一个</button>
        </div>
      )}
      {plan?.kind === 'skip' && !plan.alreadyRelated && (
        <div style={{ marginTop: 6 }}>
          <div>放弃:{plan.why}</div>
          {E ? <div style={{ opacity: 0.7 }}>没排除 —— 下次他发了新帖再看</div> : plan.recent.length > 0 && prep?.ok && !prep.ledgerProblem
            ? <div style={{ opacity: 0.7 }}>已记成「算法排除」,不再出现在候选里(人可以在人卡里取消排除)</div>
            : <div style={{ opacity: 0.7 }}>没排除 —— 是我们没采到,不算他没求关</div>}
          <div style={{ opacity: 0.7, color: '#9ecbff' }}>{leftLoading ? '读左边这条…' : `不同意?在左边点开他的一条帖子,就用那条${LABEL}(撤销这次排除)`}</div>
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
              {leftPick?.id === sel.id ? '你在左边挑的这条' : E ? (sel.related ? '回他找你的这一条' : '回他这一条') : `用这条求关${sel.related ? '(和互关相关)' : ''}`}{sel.createdAt ? ` · ${new Date(sel.createdAt).toLocaleString()}` : ''}
              {' · '}<span style={{ textDecoration: 'underline' }}>点一下在左边看原帖</span>
            </div>
            <div style={{ whiteSpace: 'pre-wrap', marginTop: 4 }}>{sel.text}</div>
          </div>
          {leftPick?.id === sel.id && leftPick.note && <div style={{ color: '#fbbf24' }}>{leftPick.note}</div>}
          <div style={{ opacity: 0.6 }}>{leftLoading ? '读左边这条…' : '在左边点开哪条帖子,就回哪条(Gemma 对着它重新草拟)'}</div>
          {viewNote && <div style={{ color: '#fbbf24' }}>{viewNote}</div>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" disabled={pool.length < 2 || acting || result !== null} onClick={() => { setLeftPick(null); cycle(); }}>换一条({pool.length} 条可选)</button>
            {/* ⭐ 用户 10-21:「对于那些跳过的…下一次就不要再列表进来了」→ 记成你排除的(人卡里能取消排除) */}
            <button type="button" disabled={acting} onClick={() => void skipPerson()}
              title={V ? '这条不值得回 —— 记成你的判断(推翻 Gemma),从名单拿掉' : E ? '不和他互动,以后也不再进互动队列(记成你排除的;人卡里可以取消排除)' : '不求关他,以后也不再进候选(记成你排除的;人卡里可以取消排除)'}>{V ? '不值得回' : '跳过此人(以后不再出现)'}</button>
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
          {meaning && draft.trim() === meaning.forText.trim() && (
            <div style={{ color: meaning.text ? '#9ecbff' : '#fbbf24' }}>
              {meaning.text ? `中文意思(回译):${meaning.text}` : `⚠️ ${meaning.problem}`}
            </div>
          )}
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input value={critique} onChange={(e) => setCritique(e.target.value)} disabled={drafting || acting || result?.ok === true}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) reviseDraft(); }}
              placeholder="点评:告诉 Gemma 怎么改(更口语 / 别评价,问他一句 / 短一点 / 加点幽默…)" style={{ flex: 1, minWidth: 0 }} />
            <label style={{ fontSize: 11, whiteSpace: 'nowrap' }} title="勾上 = 这条成为长期要求,以后每次草拟都照做(下面能停用)">
              <input type="checkbox" checked={keepRule} onChange={(e) => setKeepRule(e.target.checked)} /> 以后都这样
            </label>
            <button type="button" style={{ fontSize: 11 }} disabled={drafting || acting || result?.ok === true || critique.trim() === ''} onClick={reviseDraft}>按点评重拟</button>
          </div>
          {rules.length > 0 && (
            <div style={{ opacity: 0.7, fontSize: 11 }}>
              长期要求({LABEL}):{rules.map((r, i) => (
                <span key={r.id}>{i > 0 ? ' · ' : ''}{r.note} <button type="button" style={{ fontSize: 10 }} onClick={() => void stopRule(r.id)} title="停用这条(记录还留着)">停用</button></span>
              ))}
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button type="button" disabled={acting || draft.trim() === '' || result?.ok === true} onClick={() => void act()}
              title={E ? '左边 X 网页:去这条推文点赞 → 贴回复并发送;每步核对,哪步没成停在哪步(不关注,已经互关)' : '左边 X 网页:去这条推文点赞 → 贴留言并发送 → 去他主页关注;每步核对,哪步没成停在哪步'}>
              {acting ? '正在做…' : E ? '点赞 · 回复' : '点赞 · 留言 · 关注'}
            </button>
            <button type="button" disabled={acting}
              title={result ? '' : '这次先不处理他,下次还会在候选里'}
              onClick={() => (result ? next(result.ok ? `✓ ${LABEL}完成(${stepLine(result, E)})` : `✗ ${result.blocked ?? result.detail ?? '没做完'}`) : void deferThis())}>
              {result ? '下一个' : '先放一放(过几天再出现)'}
            </button>
          </div>
          {result && (
            <div style={{ color: result.ok ? '#5fc98a' : '#f87171' }}>
              {result.blocked ? `没动手:${result.blocked}` : `${result.ok ? `✓ ${LABEL}完成` : '✗ 停在这一步'} —— ${stepLine(result, E)}`}
              {result.detail && <div>{result.detail}</div>}
              {result.warning && <div style={{ color: '#e0b050' }}>⚠️ {result.warning}</div>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
