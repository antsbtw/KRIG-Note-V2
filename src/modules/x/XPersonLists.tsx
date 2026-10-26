/**
 * ⭐ 人卡「他的名单」(2026-10-19)
 *
 * 用户 10-19:「在人卡中增加自动采集follower/following/verified followers这三个自动采集的方法吧。」
 * 选「后台慢慢采全」+「人卡显示名单 + 标出候选」。
 * · 采:建一个名单后台任务(进度在上面的「后台采集」区,可暂停 / 取消,跨重启续采)
 * · 看:三个名单各多少人;其中「蓝V · 我没关注 · 有互关倾向 · 没排除」的人列出来
 * · 用:每人一个「求关」,或这几个一起 —— 就地打开求关卡(与任务页同一个组件)
 * ⚠️ 这些人**不会**自动进任务页的候选(那边只收配方搜索找到的人),所以求关入口放在这里。
 */
import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { xDataCall } from './x-data-types';
import { AskRun } from './XTaskAsk';
import { startCards, type CardQueue, type CardWho } from './x-flow-ui';
import type { PersonLists } from './x-list-member-repo';

const LIST_LABEL: Record<string, string> = { followers: '关注者', following: '他关注的', verifiedFollowers: '蓝V关注者' };

export function XPersonLists({ wsId, restId, handle, wcOpen, onOpenInX }: {
  wsId: string; restId: string; handle: string; wcOpen: boolean;
  /** 点名字 = 左边 X 网页跳到他主页(与人卡别处同一个函数) */
  onOpenInX: (p: { rest_id: string; handle: string }) => void;
}): ReactElement {
  const [data, setData] = useState<PersonLists | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [asking, setAsking] = useState<CardQueue | null>(null);
  /**
   * ⭐ 4c:起一批走主进程(和「任务 → 求关」共用这个号的求关那一份;没做完的那批在那边一打开就接着)。
   * ⚠️ 这里起会盖掉没做完的那批 —— 照做,说出来
   */
  const beginAsk = async (list: readonly CardWho[]): Promise<void> => {
    const r = await startCards(wsId, 'ask', list);
    if (!r.ok) { setMsg(`没起成这一批:${r.why}`); return; }
    setAsking(r.value);
    if (r.value.replaced) setMsg(`⚠️ 盖掉了没做完的那一批求关(还剩 ${r.value.replaced} 张)`);
  };
  const load = useCallback(() => {
    void xDataCall({ op: 'personLists', wsId, restId, limit: 50 }).then((r) => {
      if (r.status === 'ok') setData(r.value as PersonLists); else setMsg(r.reason);
    });
  }, [wsId, restId]);
  useEffect(() => {
    setData(null); setAsking(null); setMsg(null);
    load();
    /** 后台一段段在采,这里 30 秒刷一次人数 */
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [load]);

  /** ⭐ 2026-10-20 改成走「关系采集」任务:读他主页人数 → 比对库 → 定策略 → 自动采(进度在「任务 → 关系采集」) */
  const start = async (): Promise<void> => {
    setMsg('读他的主页现状…');
    const r = await xDataCall({ op: 'relationStart', wsId, restId, handle });
    if (r.status === 'failed') { setMsg(r.reason); return; }
    const v = r.value as { created: boolean; plan: { tabs: Record<string, { mode: string; why: string; xCount?: number; dbCount: number }> } };
    const line = Object.entries(v.plan.tabs).map(([k, t]) => `${LIST_LABEL[k]}:${t.why}`).join(';');
    setMsg(`${v.created ? '已开始' : '已经在采'} —— ${line}(进度看「任务 → 关系采集」)`);
  };

  const total = data ? data.counts.followers + data.counts.following + data.counts.verifiedFollowers : 0;
  return (
    <div style={{ fontSize: 12 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button type="button" disabled={!wcOpen} onClick={() => void start()}
          title={wcOpen ? '读他主页的人数 → 和库里比 → 定策略 → 自动采(节奏 AI 自调)' : 'X 网页没开'}>
          关系采集(他的名单)
        </button>
        {data && (
          <span style={{ opacity: 0.8 }}>
            {Object.entries(data.counts).map(([k, n]) => `${LIST_LABEL[k]} ${n}`).join(' · ')}
          </span>
        )}
      </div>
      {msg && <div style={{ opacity: 0.85, marginTop: 4 }}>{msg}</div>}
      {data && total === 0 && <div style={{ opacity: 0.6, marginTop: 4 }}>还没采过他的名单</div>}
      {data && total > 0 && (
        <div style={{ marginTop: 6 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span>其中 蓝V · 我没关注 · 有互关倾向:<strong>{data.candidateTotal}</strong> 人{data.candidateTotal > data.candidates.length ? `(显示粉丝最多的 ${data.candidates.length} 个)` : ''}</span>
            {data.candidates.length > 0 && (
              <button type="button" style={{ fontSize: 11 }} disabled={asking !== null}
                onClick={() => void beginAsk(data.candidates.map((c) => ({ restId: c.rest_id, handle: c.handle, name: c.display_name })))}>
                这 {data.candidates.length} 个都去求关
              </button>
            )}
          </div>
          {asking && (
            <div style={{ marginTop: 6 }}>
              <AskRun key={asking.startedAt} wsId={wsId} initial={asking} onPersonDone={load} onEnd={(d) => {
                setAsking(null);
                setMsg(`求关看完 ${d.length}/${asking.items.length} 人:${d.map((x) => `@${x.who.handle} ${x.outcome}`).join(';')}`.slice(0, 400));
                load();
              }} />
            </div>
          )}
          <div style={{ maxHeight: 280, overflow: 'auto', marginTop: 4 }}>
            {data.candidates.map((c) => (
              <div key={c.rest_id} style={{ display: 'flex', gap: 6, padding: '3px 0', borderBottom: '1px solid var(--border-color, #2a2a2a)' }}>
                <span style={{ flex: 1, minWidth: 0, cursor: 'pointer' }} onClick={() => onOpenInX(c)} title="左边 X 网页跳到他主页">
                  <strong>{c.display_name ?? c.handle}</strong> @{c.handle}
                  {c.followers_count !== undefined && <span style={{ opacity: 0.6 }}> · 粉丝 {c.followers_count}</span>}
                  {c.follows_me === true && <span style={{ color: '#5fc98a' }}> · 他已关注我</span>}
                  <span style={{ opacity: 0.6 }}> · 在{c.lists.map((l) => LIST_LABEL[l]).join('/')}里</span>
                  <div style={{ opacity: 0.7 }}>依据 · {c.mutual_intent_evidence ?? '—'}</div>
                </span>
                <button type="button" style={{ fontSize: 11, alignSelf: 'center' }} disabled={asking !== null}
                  onClick={() => void beginAsk([{ restId: c.rest_id, handle: c.handle, name: c.display_name }])}>求关</button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
