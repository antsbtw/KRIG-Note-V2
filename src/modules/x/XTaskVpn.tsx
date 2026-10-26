/**
 * ⭐⭐ 任务「VPN求助」(2026-10-23)
 *
 * 用户 10-23:「下面再完成VPN求助配方这个任务?和蓝V互关类似了,先找到VPN的求助贴,再筛选有价值的,然后再草拟回复对方的方法。」
 * 用户选:先帮忙再带链接 · 只回 24 小时内的 · Gemma 先判、我抽看推翻。
 * 上面一排 tab(找求助帖 / 筛选 / 回复记录),筛选里再一排(值得回 / 不值得 / 待判断)—— 同蓝V互关(用户 10-22 定的布局)。
 * 回复卡和互动卡同一个组件(AskRun mode = vpn):来龙去脉 + Gemma 草拟(事实清单 + 试用链接)+ 点评 + 点赞·回复。
 */
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { xDataCall } from './x-data-types';
import { getXHostState } from './x-host-registry';
import { openInLeft } from './x-unfollow-run';
import { XTabs } from './XTabs';
import { AskRun, type AskWho } from './XTaskAsk';
import type { VpnOverview, VpnPostRow } from './x-vpn-run';

const BATCH = 15;
const ago = (iso?: string): string => {
  if (!iso) return '';
  const h = (Date.now() - Date.parse(iso)) / 3600_000;
  return h < 1 ? `${Math.max(1, Math.round(h * 60))} 分钟前` : `${Math.round(h)} 小时前`;
};
const DIR: Record<string, string> = { out: '想出去', in: '想回国', none: '' };

export function VpnHelpTask({ wsId }: { wsId: string }): ReactElement {
  const [ov, setOv] = useState<VpnOverview | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<'find' | 'filter' | 'replied'>('filter');
  const [sub, setSub] = useState<'worth' | 'notWorth' | 'pending'>('worth');
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const stop = useRef(false);
  const [picked, setPicked] = useState<ReadonlyMap<string, AskWho>>(new Map());
  const [replying, setReplying] = useState<AskWho[] | null>(null);

  const load = useCallback(() => {
    void xDataCall({ op: 'vpnOverview', wsId }).then((r) => { if (r.status === 'ok') { setOv(r.value as VpnOverview); setErr(null); } else setErr(r.reason); });
  }, [wsId]);
  useEffect(() => { load(); }, [load]);

  /** 判断还没判的:一次 5 条地问,直到判完或你停 —— 进度看得见 */
  const judgeAll = async (): Promise<void> => {
    stop.current = false;
    let total = 0; let failed = 0;
    for (;;) {
      if (stop.current) break;
      setBusy(`Gemma 判断中…已判 ${total} 条${failed ? `(${failed} 条没判成,下次重判)` : ''}`);
      const r = await xDataCall({ op: 'vpnJudge', wsId, limit: 5 });
      if (r.status === 'failed') { setMsg(`判断出错:${r.reason}`); break; }
      const v = r.value as { judged: number; failed: number; left: number };
      if (v.left === -1) { setMsg('已经有一轮判断在跑'); break; }
      total += v.judged; failed += v.failed;
      load();
      if (v.left === 0 || v.judged + v.failed === 0) break;
    }
    setBusy(null);
    setMsg((m) => `${m ? `${m} · ` : ''}判完 ${total} 条${failed ? `,${failed} 条没判成(下次重判)` : ''}`);
  };

  /** 找一轮 → 自动接着判断新找到的 */
  const findOnce = async (): Promise<void> => {
    setBusy('找求助帖:四条配方各搜最近 24 小时(左边会跳到搜索页)…'); setMsg(null);
    const r = await xDataCall({ op: 'vpnFind', wsId });
    setBusy(null);
    if (r.status === 'failed') { setMsg(r.reason); return; }
    const v = r.value as { runs: Array<{ recipe: string; pages: number; tweets: number; added: number; problem?: string }>; note?: string };
    setMsg(`找完:${v.runs.map((x) => `${x.recipe} ${x.tweets} 条(新 ${x.added})${x.problem ? ` ⚠️ ${x.problem}` : ''}`).join(' · ')}${v.note ? ` · ${v.note}` : ''}`);
    load();
    await judgeAll();
  };

  /** 推翻 Gemma */
  const overrule = async (p: VpnPostRow, human: 'accept' | 'reject'): Promise<void> => {
    const r = await xDataCall({ op: 'vpnHuman', wsId, tweetId: p.tweetId, human });
    if (r.status === 'failed') { setMsg(`没记上:${r.reason}`); return; }
    setPicked((cur) => { const m = new Map(cur); m.delete(p.tweetId); return m; });
    load();
  };

  const show = async (tweetId: string): Promise<void> => {
    const wcId = getXHostState(wsId)?.wcId;
    if (wcId === undefined) { setMsg('X 网页没开'); return; }
    /** ⭐ 打开那一下占着网页(主进程能力 x.page.open);被占着 / 没打开都说出来 */
    const why = await openInLeft(wsId, { tweetId });
    if (why !== null) setMsg(`${why},没跳转(跳走会打断)`);
  };

  const whoOf = (p: VpnPostRow): AskWho | null => (p.authorRestId && p.handle ? { restId: p.authorRestId, handle: p.handle, name: p.name, hisTweetId: p.tweetId } : null);
  const toggle = (p: VpnPostRow): void => {
    const w = whoOf(p);
    if (!w) return;
    setPicked((cur) => { const m = new Map(cur); if (m.has(p.tweetId)) m.delete(p.tweetId); else m.set(p.tweetId, w); return m; });
  };
  const pickBatch = (): void => {
    if (!ov) return;
    setPicked((cur) => {
      const m = new Map(cur);
      for (const p of ov.worth.filter((x) => !m.has(x.tweetId))) {
        if (m.size - cur.size >= BATCH) break;
        const w = whoOf(p);
        if (w) m.set(p.tweetId, w);
      }
      return m;
    });
  };

  const row = (p: VpnPostRow, kind: 'worth' | 'notWorth' | 'pending'): ReactElement => (
    <div key={p.tweetId} style={{ display: 'flex', gap: 6, padding: '4px 0', borderBottom: '1px solid var(--border-color, #2a2a2a)' }}>
      {kind === 'worth' && <input type="checkbox" checked={picked.has(p.tweetId)} disabled={replying !== null || !p.authorRestId} onChange={() => toggle(p)} style={{ marginTop: 3 }} />}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ opacity: 0.8 }}>
          <strong>{p.name ?? p.handle}</strong> @{p.handle}{p.followers !== undefined ? ` · 粉丝 ${p.followers.toLocaleString()}` : ''} · {ago(p.postedAt)} · {p.recipe}
          {p.verdict && DIR[p.verdict.direction] ? ` · ${DIR[p.verdict.direction]}` : ''}{p.human ? ` · 你判的:${p.human === 'accept' ? '值得' : '不值得'}` : ''}
        </div>
        <div style={{ cursor: 'pointer', whiteSpace: 'pre-wrap' }} title="在左边看这条" onClick={() => void show(p.tweetId)}>{p.text.slice(0, 280)}</div>
        {p.verdict?.translation && <div style={{ opacity: 0.7 }}>译:{p.verdict.translation}</div>}
        {p.verdict && !p.human && <div style={{ opacity: 0.65 }}>Gemma:{p.verdict.reason}</div>}
        {p.judgeError && !p.verdict && <div style={{ color: '#fbbf24' }}>⚠️ 没判成:{p.judgeError}(下次重判)</div>}
      </div>
      {kind === 'worth' && <button type="button" style={{ fontSize: 11, alignSelf: 'flex-start' }} onClick={() => void overrule(p, 'reject')} title="推翻:不值得回(记成你的判断,Gemma 以后照着学)">不值得</button>}
      {kind === 'notWorth' && <button type="button" style={{ fontSize: 11, alignSelf: 'flex-start' }} onClick={() => void overrule(p, 'accept')} title="推翻:值得回">值得回</button>}
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ fontSize: 15, fontWeight: 600 }}>VPN求助</div>
      {err && <div style={{ color: '#f87171', fontSize: 12 }}>⚠️ {err}</div>}
      {busy && (
        <div style={{ fontSize: 12 }}>
          {busy} {busy.startsWith('Gemma') && <button type="button" style={{ fontSize: 11 }} onClick={() => { stop.current = true; }}>停</button>}
        </div>
      )}
      {msg && <div style={{ fontSize: 12, opacity: 0.85 }}>{msg}</div>}
      <XTabs active={tab} onChange={(id) => setTab(id as typeof tab)} items={[
        { id: 'find', label: '1 找求助帖', body: (
          <div style={{ fontSize: 13 }}>
            <div>四条配方:VPN求助(中 / 英)· 回国需求(中 / 英),各搜最近 {ov?.freshHours ?? 24} 小时</div>
            <div style={{ marginTop: 4, fontSize: 12 }}>
              上次找到新帖:{ov?.lastFoundAt ? new Date(ov.lastFoundAt).toLocaleString() : '还没找过'}
              {' '}<button type="button" disabled={busy !== null} onClick={() => void findOnce()}>找一轮</button>
            </div>
            <div style={{ marginTop: 4, fontSize: 12, opacity: 0.7 }}>找完自动让 Gemma 判断新帖;用的是搜索额度账本剩下的页数,撞了限流就停</div>
          </div>
        ) },
        { id: 'filter', label: `2 筛选${ov ? `(值得回 ${ov.worth.length})` : ''}`, body: (
          <div style={{ fontSize: 13 }}>
            <div style={{ fontSize: 12, opacity: 0.7 }}>
              只列 {ov?.freshHours ?? 24} 小时内、还没回过的{ov && ov.expired > 0 ? ` · 另有 ${ov.expired} 条超过 ${ov.freshHours} 小时不列` : ''}{ov && ov.deferred > 0 ? ` · ${ov.deferred} 条最近放一放过` : ''}
            </div>
            <div style={{ marginTop: 6, fontSize: 12 }}>
              <button type="button" disabled={picked.size === 0 || replying !== null} onClick={() => { setReplying([...picked.values()]); setPicked(new Map()); }}
                title="逐条过回复卡:来龙去脉 → Gemma 草拟(先帮忙再带试用链接)→ 你改 / 点评 → 点赞 + 回复">回复选中的({picked.size} 条)</button>
              {replying === null && ov && <button type="button" style={{ marginLeft: 6, fontSize: 11 }} onClick={pickBatch}>勾 {BATCH} 条</button>}
              {picked.size > 0 && replying === null && <button type="button" style={{ marginLeft: 6, fontSize: 11 }} onClick={() => setPicked(new Map())}>清空勾选</button>}
            </div>
            {replying && (
              <div style={{ marginTop: 8 }}>
                <AskRun mode="vpn" wsId={wsId} queue={replying} onPersonDone={load} onEnd={(d) => {
                  setReplying(null);
                  setMsg(`这一批看完 ${d.length}/${replying.length} 条:${d.map((x) => `@${x.who.handle} ${x.outcome}`).join(';')}`.slice(0, 400));
                  load();
                }} />
              </div>
            )}
            {ov && (
              <div style={{ marginTop: 10 }}>
                <XTabs small active={sub} onChange={(id) => setSub(id as typeof sub)} items={[
                  { id: 'worth', label: `值得回 ${ov.worth.length}`, body: <div style={{ fontSize: 12 }}>{ov.worth.length === 0 ? <div style={{ opacity: 0.6 }}>没有</div> : ov.worth.map((p) => row(p, 'worth'))}</div> },
                  { id: 'notWorth', label: `不值得 ${ov.notWorth.length}`, body: <div style={{ fontSize: 12 }}>{ov.notWorth.length === 0 ? <div style={{ opacity: 0.6 }}>没有</div> : ov.notWorth.map((p) => row(p, 'notWorth'))}</div> },
                  { id: 'pending', label: `待判断 ${ov.pending.length}`, body: (
                    <div style={{ fontSize: 12 }}>
                      {ov.pending.length > 0 && <button type="button" style={{ fontSize: 11 }} disabled={busy !== null} onClick={() => void judgeAll()}>让 Gemma 判断这些</button>}
                      {ov.pending.length === 0 ? <div style={{ opacity: 0.6 }}>没有</div> : ov.pending.map((p) => row(p, 'pending'))}
                    </div>
                  ) },
                ]} />
              </div>
            )}
          </div>
        ) },
        { id: 'replied', label: `3 回复记录${ov ? ` ${ov.replied.length}` : ''}`, body: (
          <div style={{ fontSize: 12 }}>
            {(ov?.replied ?? []).length === 0 ? <div style={{ opacity: 0.6 }}>还没回过</div> : ov!.replied.map((r) => (
              <div key={`${r.tweetId}-${r.at}`} style={{ padding: '4px 0', borderBottom: '1px solid var(--border-color, #2a2a2a)' }}>
                <div style={{ opacity: 0.75 }}>{new Date(r.at).toLocaleString()} · @{r.handle} · {r.ok ? '✓ 发出去了' : '✗ 没发成'} · {r.source === 'ai' ? 'Gemma 原稿' : '你改过'}</div>
                <div style={{ cursor: 'pointer', opacity: 0.8 }} onClick={() => void show(r.tweetId)} title="在左边看这条">他:{r.tweetText.slice(0, 120)}</div>
                <div>我:{r.reply}</div>
              </div>
            ))}
          </div>
        ) },
      ]} />
    </div>
  );
}
