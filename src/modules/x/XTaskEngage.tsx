/**
 * ⭐⭐ 任务「蓝V互关」第 3 件事:已互关的蓝V,看互动情况(2026-10-22)
 *
 * 用户 10-22 选:互动 = 回复和提及;互动走「和求关卡一样」(点赞 + 回复,不关注)。
 * ⭐ 10-22 重做(用户:「互动有一个误区,就是找我最近互动的人再次互动,没有我选择的空间」):
 *  不再自动排队列。两张名单由人挑:
 *  · 刚互关(7 天内)—— 互动过 / 还没互动 分开
 *  · 一周没互动 —— 先把自己最近 7 天的互动采全,再对互关蓝V做补集(用户:「至少采自己的一周互动结果,然后做补集」)
 *  点名字 → 左边看他主页;点帖子 → 左边看这条;勾选 → 「和选中的互动」逐个过互动卡。
 */
import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { xDataCall } from './x-data-types';
import { getXHostState } from './x-host-registry';
import { X_PAGE_NAME } from './x-pages';
import { xPageBusy } from './x-unfollow-run';
import type { EngageOverview } from './x-engage-repo';
import type { RecentPerson } from './x-engage';
import { AskRun, type AskWho } from './XTaskAsk';

const PAGE = 30;
const date = (iso?: string): string => (iso ? new Date(iso).toLocaleDateString() : '');

export function EngageStep({ wsId }: { wsId: string }): ReactElement {
  const [ov, setOv] = useState<EngageOverview | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [viewNote, setViewNote] = useState<string | null>(null);
  const [collecting, setCollecting] = useState(false);
  const [quietLimit, setQuietLimit] = useState(PAGE);
  const [picked, setPicked] = useState<ReadonlyMap<string, AskWho>>(new Map());
  /** ⭐ 正在过互动卡的这一批(你勾的人) */
  const [engaging, setEngaging] = useState<AskWho[] | null>(null);
  const load = useCallback(() => {
    void xDataCall({ op: 'engageOverview', wsId, limit: quietLimit }).then((r) => { if (r.status === 'ok') setOv(r.value as EngageOverview); else setMsg(r.reason); });
  }, [wsId, quietLimit]);
  useEffect(() => { load(); }, [load]);

  const collect = async (): Promise<void> => {
    setCollecting(true);
    setMsg('采一段:先补新的,再补齐最近 7 天(左边会跳到搜索页)…');
    const r = await xDataCall({ op: 'engageCollect', wsId });
    setCollecting(false);
    if (r.status === 'failed') { setMsg(r.reason); return; }
    const v = r.value as { runs: Array<{ label: string; pages: number; tweets: number; problem?: string }>; note?: string };
    setMsg(`${v.runs.length > 0 ? `这一段:${v.runs.map((x) => `${x.label} ${x.tweets} 条${x.problem ? `(⚠️ ${x.problem})` : ''}`).join(' · ')}` : ''}${v.note ? ` ${v.note}` : ''}`);
    load();
  };

  /** 左边 X 网页跳过去;X 网页忙就不跳,说出来 */
  const show = async (page: 'profile' | 'status', params: Record<string, string>): Promise<void> => {
    const wcId = getXHostState(wsId)?.wcId;
    if (wcId === undefined) { setViewNote('X 网页没开'); return; }
    const busy = await xPageBusy(wcId);
    if (busy !== null) { setViewNote(`${busy},没跳转(跳走会打断)`); return; }
    const go = await window.electronAPI!.webDomInvoke({ op: 'goto', pageRef: { wcId }, name: X_PAGE_NAME[page], params });
    setViewNote(go.status === 'failed' ? `没跳过去:${(go as { reason?: string }).reason ?? '?'}` : null);
  };

  const toggle = (p: RecentPerson): void => {
    setPicked((cur) => {
      const m = new Map(cur);
      if (m.has(p.restId)) m.delete(p.restId);
      else m.set(p.restId, { restId: p.restId, handle: p.handle, name: p.name, hisTweetId: p.unanswered?.tweetId });
      return m;
    });
  };

  const row = (p: RecentPerson, note: string): ReactElement => (
    <div key={p.restId} style={{ display: 'flex', gap: 6, padding: '4px 0', borderBottom: '1px solid var(--border-color, #2a2a2a)' }}>
      <input type="checkbox" checked={picked.has(p.restId)} disabled={engaging !== null} onChange={() => toggle(p)} style={{ marginTop: 3 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <span style={{ cursor: 'pointer' }} title="在左边看他的主页" onClick={() => void show('profile', { handle: p.handle })}>
          <strong>{p.name ?? p.handle}</strong> <span style={{ textDecoration: 'underline' }}>@{p.handle}</span>
        </span>
        {p.followers !== undefined && <span style={{ opacity: 0.6 }}> · 粉丝 {p.followers.toLocaleString()}</span>}
        <span style={{ opacity: 0.7 }}> · {note}</span>
        {p.unanswered && (
          <div style={{ cursor: 'pointer', color: '#e0b050' }} title="在左边看这条" onClick={() => void show('status', { tweetId: p.unanswered!.tweetId })}>
            他找过你、你还没回({date(p.unanswered.at)}):{(p.unanswered.text ?? '').slice(0, 80)}
          </div>
        )}
        {p.latestPost ? (
          <div style={{ cursor: 'pointer', opacity: 0.85 }} title="在左边看这条" onClick={() => void show('status', { tweetId: p.latestPost!.id })}>
            他最近发的({date(p.latestPost.at)}):{(p.latestPost.text ?? '').slice(0, 100)}
          </div>
        ) : (
          <div style={{ opacity: 0.55 }}>库里没有他这两周发的帖子 —— 点名字看他主页,勾上互动时会现采</div>
        )}
      </div>
    </div>
  );

  const touchNote = (p: RecentPerson): string =>
    p.lastTouch ? `上次互动 ${date(p.lastTouch.at)}(${p.lastTouch.who === 'me' ? '你找他' : '他找你'})` : '这 7 天没互动';
  const sinceNote = (p: RecentPerson): string =>
    p.mutualSince ? (p.mutualSince.firstSeen ? `${date(p.mutualSince.at)} 第一次采到就已互关(可能更早)` : `${date(p.mutualSince.at)} 成为互关`) : '';

  const section = (title: string, hint: string, people: readonly RecentPerson[], note: (p: RecentPerson) => string, more?: ReactElement): ReactElement => (
    <div style={{ marginTop: 10 }}>
      <div><strong>{title}</strong> <span style={{ opacity: 0.7, fontSize: 12 }}>{hint}</span></div>
      <div style={{ fontSize: 12, maxHeight: 320, overflow: 'auto', marginTop: 4 }}>
        {people.length === 0 ? <div style={{ opacity: 0.6 }}>没有</div> : people.map((p) => row(p, note(p)))}
        {more}
      </div>
    </div>
  );

  const last = ov?.lastCollected.map((c) => c.at).filter((x): x is string => !!x).sort().at(-1);
  return (
    <div>
      <div>互关蓝V {ov ? ov.mutualBlue.toLocaleString() : '…'} 人 · 看最近 {ov?.days ?? 7} 天的互动(回复 / 提及 / 互动卡 / 求关卡)</div>
      <div style={{ marginTop: 6, fontSize: 12 }}>
        {ov && ov.recentGaps.length === 0 && <div style={{ color: '#5fc98a' }}>✓ 最近 7 天的互动已采全 —— 「一周没互动」是可信的补集</div>}
        {ov && ov.recentGaps.length > 0 && (
          <div style={{ color: '#e0b050' }}>
            ⚠️ 最近 7 天还没采全,「一周没互动」会偏多:{ov.recentGaps.map((g) => `${g.label} ${g.why}`).join(';')}
          </div>
        )}
        <div style={{ opacity: 0.7 }}>
          自动采:没采全最近 7 天时每 15 分钟补一段,采全后每 3 小时补新的;每段只用剩下的搜索额度(给你自己搜留着),撞了限流 15 分钟后自动接着采
        </div>
        互动数据上次采:{last ? new Date(last).toLocaleString() : '还没采过'}
        {' '}<button type="button" style={{ fontSize: 11 }} disabled={collecting} onClick={() => void collect()}>{collecting ? '采集中…' : '现在采一段'}</button>
      </div>
      {msg && <div style={{ fontSize: 12, marginTop: 4, opacity: 0.85 }}>{msg}</div>}
      {viewNote && <div style={{ fontSize: 12, color: '#fbbf24' }}>{viewNote}</div>}

      {engaging ? (
        <div style={{ marginTop: 8 }}>
          <AskRun mode="engage" wsId={wsId} queue={engaging} onPersonDone={load} onEnd={(d) => {
            setEngaging(null);
            setPicked(new Map());
            setMsg(`这一批看完 ${d.length}/${engaging.length} 人:${d.map((x) => `@${x.who.handle} ${x.outcome}`).join(';')}`.slice(0, 400));
            load();
          }} />
        </div>
      ) : ov && (
        <>
          <div style={{ marginTop: 8, fontSize: 12 }}>
            <button type="button" disabled={picked.size === 0} onClick={() => setEngaging([...picked.values()])}
              title="逐个过互动卡:看他最近的帖子(点了在左边看原帖)→ Gemma 草拟 → 你改 → 点赞 + 回复(不关注)">
              和选中的互动({picked.size} 人)
            </button>
            {picked.size > 0 && <button type="button" style={{ marginLeft: 6, fontSize: 11 }} onClick={() => setPicked(new Map())}>清空勾选</button>}
          </div>
          {section(`刚互关 · 还没互动 ${ov.newUntouched.length}`, '7 天内成为互关,还没打过招呼', ov.newUntouched, sinceNote)}
          {section(`刚互关 · 互动过 ${ov.newTouched.length}`, '7 天内成为互关,已经有来往', ov.newTouched, (p) => `${sinceNote(p)} · ${touchNote(p)}`)}
          {section(`一周没互动 ${ov.quietTotal.toLocaleString()}`, `互关蓝V里这 7 天没有任何来往的(另有 ${ov.touchedCount} 人这周互动过,不列)· 库里有他最近帖子的在前`, ov.quiet, () => '这 7 天没互动',
            ov.quietTotal > ov.quiet.length ? (
              <button type="button" style={{ fontSize: 11, marginTop: 4 }} disabled={quietLimit >= 500} onClick={() => setQuietLimit((n) => Math.min(500, n + PAGE))}>
                再看 {PAGE} 个(已列 {ov.quiet.length} / {ov.quietTotal.toLocaleString()})
              </button>
            ) : undefined)}
        </>
      )}
    </div>
  );
}
