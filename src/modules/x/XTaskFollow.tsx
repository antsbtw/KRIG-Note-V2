/**
 * ⭐⭐ 任务「蓝V互关」第 2 件事:对有互关倾向的,互动求关(2026-10-16,M3 候选 + M4 关注队列 + M5 回访)
 *
 * 用户 10-16:关注=「你在候选列表里勾一批,程序按节奏慢慢关」;回访「关注后几天还没回关,就算不回关」「正确」。
 * 主页面只放进度;点「去求关」才展开候选名单 / 队列 / 回访(用户:「围绕需要做的事情来展现」)。
 * ⚠️ 关注在主进程按节奏跑(每日上限 / 间隔 / 随机加 —— 运营设置里可改),异常即停。
 */
import { useCallback, useEffect, useState, useSyncExternalStore, type ReactElement } from 'react';
import { xDataCall } from './x-data-types';
import { getXHostState, subscribeXHost } from './x-host-registry';
import { X_PAGE_NAME } from './x-pages';
import { AskRun, type AskWho } from './XTaskAsk';
import { XPersonTimeline } from './XPersonTimeline';
import { readProfileAndRefresh, unfollowOnce, xPageBusy } from './x-unfollow-run';
import type { AskStatus } from './x-follow-back';

type Cand = { rest_id: string; handle: string; display_name?: string; followers_count?: number; follows_me?: boolean; mutual_intent_evidence?: string };
type Prog = { followedTotal: number; followedBack: number; revisit: Array<{ rest_id: string; handle: string; followedAt: string }>; revisitDays: number; today: number; cap: number };
type QItem = { restId: string; handle: string };
type QDone = { restId: string; handle: string; at: string; state: 'followed' | 'already-following' | 'failed'; detail?: string };
type QStatus = { waiting: number; next: QItem[]; current?: QItem; paused?: string; note?: string; nextAt: number; done: QDone[]; now: number };

const STATE: Record<QDone['state'], string> = { followed: '✓ 已关注', 'already-following': '· 本来就关注着', failed: '✗ 没关成' };

/** 第 4 阶段:求关对象回关状态 + 上次查回关 */
type LastCheck = { at: string; ok: boolean; caughtUp: boolean; trigger: string; pages: number; newFollowers: number; askedBack: string[]; stopReason: string; problem?: string };
type FollowStatus = { statuses: AskStatus[]; lastCheck: LastCheck | null; running: boolean; revisitDays: number };
const STATUS_LABEL: Record<AskStatus['status'], string> = {
  back: '已回关', waiting: '等待中', overdue: '没回关', unconfirmed: '未确认', dropped: '已取关',
};
const ago = (iso: string): string => {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  return m < 60 ? `${m} 分钟前` : m < 1440 ? `${Math.round(m / 60)} 小时前` : `${Math.round(m / 1440)} 天前`;
};

export function FollowStep({ wsId, candidates }: { wsId: string; candidates: number | undefined }): ReactElement {
  const [open, setOpen] = useState(false);
  const [prog, setProg] = useState<Prog | null>(null);
  const [qs, setQs] = useState<QStatus | null>(null);
  const [cands, setCands] = useState<Cand[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState<string | null>(null);
  /** ⭐ 点了谁(高亮)—— 与「勾选」分开:点 = 左边 X 网页跳到他主页;勾 = 选进这一批 */
  const [viewing, setViewing] = useState<string | null>(null);
  /** ⭐ 正在求关的这一批(用户 10-17:点赞、留言求关、关注 —— 取代「勾了就直接关注」) */
  const [asking, setAsking] = useState<AskWho[] | null>(null);
  const wcId = useSyncExternalStore(subscribeXHost, () => getXHostState(wsId)?.wcId ?? null);
  /** ⭐ 第 4 阶段(2026-10-19):回关状态 / 上次查 / 正在查 */
  const [fs, setFs] = useState<FollowStatus | null>(null);
  const [checking, setChecking] = useState(false);
  /** 点了哪个人名 —— 就地展开他的时间线 */
  const [lineOf, setLineOf] = useState<string | null>(null);
  /** ⭐ 异常即停:任务页取关失败一次就停,人看过原因点「恢复」才继续(与运营取关同规矩) */
  const [unfPaused, setUnfPaused] = useState<string | null>(null);
  const [unfDoing, setUnfDoing] = useState<string | null>(null);
  const loadFs = useCallback(() => {
    void xDataCall({ op: 'askFollowStatus', wsId }).then((r) => { if (r.status === 'ok') setFs(r.value as FollowStatus); });
  }, [wsId]);
  useEffect(() => {
    loadFs();
    /** 每天自动查在主进程跑,这里 30 秒看一次结果 / 在不在查 */
    const t = setInterval(loadFs, 30_000);
    return () => clearInterval(t);
  }, [loadFs]);
  const checkNow = async (): Promise<void> => {
    setChecking(true);
    setMsg('正在查回关:去你的 followers 从第一页往下翻,翻到上次见过的人为止…');
    const r = await xDataCall({ op: 'followCheckRun', wsId });
    setChecking(false);
    if (r.status === 'failed') { setMsg(r.reason); return; }
    const v = r.value as { pages: number; newFollowers: number; askedBack: string[]; caughtUp: boolean; problem?: string };
    setMsg(`查完:翻了 ${v.pages} 页 · 新关注你 ${v.newFollowers} 人 · 求关过的新回关 ${v.askedBack.length} 人${v.problem ? ` · ⚠️ ${v.problem}` : ''}`);
    loadFs();
  };
  const unfollowAsked = async (s: AskStatus): Promise<void> => {
    if (unfPaused) { setMsg(`取关已暂停:${unfPaused} —— 看过原因后点「恢复」`); return; }
    if (wcId === null) { setMsg('X 网页没开,没法取关'); return; }
    setUnfDoing(s.person);
    try {
      const who = { rest_id: s.person, handle: s.handle };
      const r = await unfollowOnce(who, wcId, '任务:正在取关', `求关 ${s.askDays} 天没回关`, wsId);
      if ('blocked' in r) { setMsg(r.blocked); return; }
      if (r.done || r.state === 'not-following') {
        /** 执行后核对:读回他主页把关系写进库 */
        const v = await readProfileAndRefresh(who, wcId);
        setMsg(`@${s.handle} ${r.done ? '已取关' : '本来就没关注'} · 核对:${v.text}`);
      } else {
        setUnfPaused(`@${s.handle} ${r.detail}`);
        setMsg(`@${s.handle} 没取关成:${r.detail} —— 已暂停取关`);
      }
    } finally {
      setUnfDoing(null);
      loadFs();
    }
  };

  const loadProg = useCallback(() => {
    void xDataCall({ op: 'blueMutualFollowProgress', wsId }).then((r) => { if (r.status === 'ok') setProg(r.value as Prog); });
  }, [wsId]);
  const loadQ = useCallback(() => {
    void xDataCall({ op: 'followQueueStatus', wsId }).then((r) => { if (r.status === 'ok') setQs(r.value as QStatus); });
  }, [wsId]);
  const loadCands = useCallback(() => {
    void xDataCall({ op: 'blueMutualCandidates', wsId, limit: 200 }).then((r) => {
      if (r.status === 'ok') setCands(r.value as Cand[]); else setMsg(r.reason);
    });
  }, [wsId]);

  useEffect(() => { loadProg(); loadQ(); }, [loadProg, loadQ]);
  /** 队列在跑时每 2 秒看一次(X 无推送通道);关完一个刷新进度和候选 */
  useEffect(() => {
    const t = setInterval(() => {
      loadQ();
    }, 2000);
    return () => clearInterval(t);
  }, [loadQ]);
  const doneCount = qs?.done.length ?? 0;
  useEffect(() => { if (doneCount > 0) { loadProg(); if (open) loadCands(); } }, [doneCount, loadProg, loadCands, open]);
  useEffect(() => { if (open && cands === null) loadCands(); }, [open, cands, loadCands]);

  const queued = new Set([...(qs?.next ?? []).map((i) => i.restId), qs?.current?.restId].filter(Boolean) as string[]);
  /**
   * ⭐ 点一个候选 → 左边 X 网页跳到他的主页(用户 10-16:「点击这个蓝V时,左边跳转到这个蓝V的profile。
   * --注意时点击,而不是勾选,勾选是选定」)。
   * ⚠️ 关注队列正在某人主页上点关注 / X 网页正被采集占着 → 不跳(跳走会打断),说清楚。
   */
  const openInX = async (c: Cand): Promise<void> => {
    setViewing(c.rest_id);
    if (wcId === null) { setMsg('X 网页没开,没跳转'); return; }
    if (qs?.current) { setMsg(`正在关注 @${qs.current.handle},等它关完再点(跳走会打断关注)`); return; }
    const busy = await xPageBusy(wcId);
    if (busy !== null) { setMsg(`${busy},没跳转(跳走会打断)`); return; }
    const go = await window.electronAPI!.webDomInvoke({ op: 'goto', pageRef: { wcId }, name: X_PAGE_NAME.profile, params: { handle: c.handle } });
    setMsg(go.status === 'failed' ? `没跳过去:${(go as { reason?: string }).reason ?? '?'}` : null);
  };
  const toggle = (id: string): void => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  /**
   * ⚠️ 10-17 撤掉「关注选中的 N 人」:只关注不求关 = 对方不回关(用户原话「莫名其妙关注,不求互关」)。
   * 改成逐个人求关:看推文 → 选一条 → 点赞 / 留言 / 关注。
   */
  const startAsk = (): void => {
    const list = (cands ?? []).filter((c) => picked.has(c.rest_id)).map((c) => ({ restId: c.rest_id, handle: c.handle, name: c.display_name }));
    if (list.length === 0) return;
    if (qs?.current) { setMsg(`正在关注 @${qs.current.handle},等它关完`); return; }
    setAsking(list);
    setPicked(new Set());
  };
  const control = async (action: 'pause' | 'resume' | 'clear'): Promise<void> => {
    await xDataCall({ op: 'followQueueControl', wsId, action });
    loadQ();
  };

  const n = (k: AskStatus['status']): number => (fs?.statuses ?? []).filter((x) => x.status === k).length;
  const secs = qs && qs.nextAt > qs.now ? Math.round((qs.nextAt - qs.now) / 1000) : 0;
  const qLine = !qs ? '' : qs.paused ? `⏸ 已暂停:${qs.paused}`
    : qs.current ? `▶ 正在关注 @${qs.current.handle}`
      : qs.waiting > 0 ? `▶ 队列 ${qs.waiting} 人 · ${qs.note ?? (secs > 0 ? `下一个约 ${secs} 秒后` : '马上开始')}`
        : '队列空着';

  return (
    <div>
      <div>候选(蓝V · 我没关注 · 有互关倾向):{candidates ?? '…'} 人</div>
      <div style={{ marginTop: 4 }}>
        今天已关注 {prog ? `${prog.today}/${prog.cap}` : '…'}
        {' '}· 求关 {fs ? fs.statuses.length : '…'} 人:已回关 {n('back')} · 等待中 {n('waiting')}
        {' '}· 满 {fs?.revisitDays ?? 7} 天没回关 {n('overdue')}{n('unconfirmed') > 0 ? ` · 未确认 ${n('unconfirmed')}` : ''}
      </div>
      <div style={{ marginTop: 4, fontSize: 12 }}>
        回关上次查:{fs?.running || checking ? '正在查…'
          : fs?.lastCheck ? `${ago(fs.lastCheck.at)}(${fs.lastCheck.trigger === 'auto' ? '每天自动' : '手动'})· 新关注你 ${fs.lastCheck.newFollowers} 人`
            + `,其中求关过的 ${fs.lastCheck.askedBack.length} 人${fs.lastCheck.ok ? '' : ` · ⚠️ ${fs.lastCheck.problem ?? fs.lastCheck.stopReason}`}`
            : '还没查过'}
        {' '}<button type="button" style={{ fontSize: 11 }} disabled={checking || fs?.running === true || wcId === null} onClick={() => void checkNow()}
          title="去你的 followers 从第一页往下翻,翻到上次见过的人为止">现在查</button>
      </div>
      <div style={{ marginTop: 4, fontSize: 12 }}>{qLine}</div>
      <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
        <button type="button" onClick={() => setOpen((o) => !o)}>{open ? '收起' : '去求关'}</button>
        {qs && (qs.waiting > 0 || qs.current) && (qs.paused
          ? <button type="button" onClick={() => void control('resume')}>继续</button>
          : <button type="button" onClick={() => void control('pause')}>暂停</button>)}
        {qs && qs.waiting > 0 && <button type="button" onClick={() => void control('clear')} title="清空还没关的(已关的不受影响)">清空队列</button>}
      </div>
      {msg && <div style={{ fontSize: 12, marginTop: 4, opacity: 0.85 }}>{msg}</div>}

      {open && (
        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {asking && (
            <AskRun wsId={wsId} queue={asking} onActed={loadProg} onPersonDone={loadCands} onEnd={(d) => {
              setAsking(null);
              setMsg(`这一批看完 ${d.length}/${asking.length} 人:${d.map((x) => `@${x.who.handle} ${x.outcome}`).join(';')}`.slice(0, 400));
              loadCands();
            }} />
          )}
          <div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <strong style={{ fontSize: 12 }}>候选名单</strong>
              <span style={{ fontSize: 12, opacity: 0.7 }}>{cands ? `${cands.length} 人(粉丝多的在前)` : '读取中…'}</span>
              <button type="button" style={{ fontSize: 11 }}
                onClick={() => setPicked(new Set((cands ?? []).filter((c) => !queued.has(c.rest_id)).slice(0, prog ? Math.max(0, prog.cap - prog.today) : 10).map((c) => c.rest_id)))}
                title="勾上今天还能关的数量">勾今天的量</button>
              <button type="button" style={{ fontSize: 11 }} onClick={() => setPicked(new Set())}>全不选</button>
              <button type="button" disabled={picked.size === 0 || asking !== null} onClick={startAsk}>开始求关({picked.size} 人)</button>
            </div>
            <div style={{ maxHeight: 320, overflow: 'auto', marginTop: 6, fontSize: 12 }}>
              {(cands ?? []).map((c) => (
                <div key={c.rest_id} style={{
                  display: 'flex', gap: 6, padding: '3px 0', borderBottom: '1px solid var(--border-color, #2a2a2a)',
                  opacity: queued.has(c.rest_id) ? 0.5 : 1,
                  background: viewing === c.rest_id ? 'var(--accent-bg, rgba(45,74,107,0.5))' : undefined,
                }}>
                  {/* ⚠️ 勾选框只管「选进这一批」—— 不跳转 */}
                  <input type="checkbox" checked={picked.has(c.rest_id)} disabled={queued.has(c.rest_id)} onChange={() => toggle(c.rest_id)} />
                  {/* ⭐ 点名字 / 依据这一块 = 左边 X 网页跳到他主页 —— 不勾选 */}
                  <span style={{ minWidth: 0, cursor: 'pointer', flex: 1 }} onClick={() => void openInX(c)} title="左边 X 网页跳到他的主页">
                    <strong>{c.display_name ?? c.handle}</strong> @{c.handle}
                    {c.followers_count !== undefined && <span style={{ opacity: 0.6 }}> · 粉丝 {c.followers_count}</span>}
                    {c.follows_me === true && <span style={{ color: '#5fc98a' }}> · 他已关注我</span>}
                    {queued.has(c.rest_id) && <span> · 在队列里</span>}
                    <div style={{ opacity: 0.7 }}>依据 · {c.mutual_intent_evidence ?? '—'}</div>
                  </span>
                </div>
              ))}
            </div>
          </div>
          {(qs?.done.length ?? 0) > 0 && (
            <div>
              <strong style={{ fontSize: 12 }}>最近关注</strong>
              <div style={{ fontSize: 12, marginTop: 4 }}>
                {qs!.done.map((d) => (
                  <div key={`${d.restId}-${d.at}`} style={{ color: d.state === 'failed' ? '#f87171' : undefined }}>
                    {new Date(d.at).toLocaleTimeString()} {STATE[d.state]} @{d.handle}{d.detail ? ` —— ${d.detail}` : ''}
                  </div>
                ))}
              </div>
            </div>
          )}
          <div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <strong style={{ fontSize: 12 }}>求关名单</strong>
              <span style={{ fontSize: 12, opacity: 0.7 }}>点名字看你们的往来</span>
              {unfPaused && <button type="button" style={{ fontSize: 11 }} onClick={() => { setUnfPaused(null); setMsg(null); }} title={unfPaused}>恢复取关</button>}
            </div>
            <div style={{ fontSize: 12, marginTop: 4 }}>
              {fs && fs.statuses.length === 0 && <span style={{ opacity: 0.6 }}>还没求关过谁</span>}
              {(['overdue', 'unconfirmed', 'waiting', 'back', 'dropped'] as const).map((k) => {
                const list = (fs?.statuses ?? []).filter((x) => x.status === k);
                if (list.length === 0) return null;
                return (
                  <div key={k} style={{ marginTop: 6 }}>
                    <div style={{ opacity: 0.75 }}>
                      {k === 'overdue' ? `满 ${fs!.revisitDays} 天没回关(${list.length} 人)—— 你决定:再互动一次 / 取关`
                        : k === 'unconfirmed' ? `满 ${fs!.revisitDays} 天、还没确认(${list.length} 人)—— 求关之后还没有一次完整的查回关,先点「现在查」`
                          : `${STATUS_LABEL[k]}(${list.length} 人)`}
                    </div>
                    {list.map((x) => (
                      <div key={x.person}>
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center', padding: '2px 0' }}>
                          <span style={{ cursor: 'pointer', flex: 1, minWidth: 0 }} onClick={() => setLineOf((v) => (v === x.person ? null : x.person))}>
                            {lineOf === x.person ? '▾' : '▸'} @{x.handle} · 求关 {x.askDays} 天
                            {x.status === 'back' && (x.alreadyBefore ? ' · 求关前就关注你了'
                              : x.backBetween ? ` · 在 ${new Date(x.backBetween.from ?? x.askedAt).toLocaleDateString()} ~ ${new Date(x.backBetween.to).toLocaleDateString()} 之间回关` : '')}
                          </span>
                          {k === 'overdue' && (
                            <>
                              <button type="button" style={{ fontSize: 11 }} disabled={asking !== null}
                                onClick={() => { setAsking([{ restId: x.person, handle: x.handle }]); }}
                                title="再求关一次:选他一条帖子,点赞 + 留言(关注已在,会记「本来就关注着」)">再互动</button>
                              <button type="button" style={{ fontSize: 11 }} disabled={unfDoing !== null || unfPaused !== null}
                                onClick={() => void unfollowAsked(x)} title="去他主页取关(走取关的每日上限 / 间隔;记动作;取关后读回核对)">
                                {unfDoing === x.person ? '取关中…' : '取关'}
                              </button>
                            </>
                          )}
                        </div>
                        {lineOf === x.person && <div style={{ margin: '2px 0 6px 14px' }}><XPersonTimeline wsId={wsId} restId={x.person} /></div>}
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
