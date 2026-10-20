/**
 * ⭐⭐ 任务「关系采集」(2026-10-20)
 *
 * 用户 10-20:「在任务中添加一个"关系采集"这样的完整任务吧,具体要求是:1、先读取用户的bio,了解现状,
 *  followers/following/verified followers;2、比对库中的差距;制定采集策略,然后自动采集,并显示进度。」
 * 「这些是配置项,没有必要用户做配置,而是AI执行这些任务时自我优化就可以了。」
 *
 * 一个按钮:读现状 → 比对 → 定策略 → 开跑。之后只看:每个名单 X 显示多少 / 开始时库里多少 / 用什么策略为什么 / 采到哪 / 还要多久。
 * 节奏(间隔、每段页数)由 AI 按限流自己调,这里只读显示。
 */
import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { xDataCall } from './x-data-types';
import { useBgStatus } from './XBgStatus';
import { nextTab, tabProgress, type BgJob, type BgListTab } from './x-bg-job';
import type { PaceView } from './x-pace-repo';
import type { RelTabPlan, RelTabStats } from './x-relation-plan';

const TABS: ReadonlyArray<{ id: BgListTab; label: string; pace: string }> = [
  { id: 'followers', label: '关注者', pace: 'list:followers' },
  { id: 'following', label: '他关注的', pace: 'list:following' },
  { id: 'verifiedFollowers', label: '蓝V关注者', pace: 'list:verifiedFollowers' },
];
const MODE: Record<RelTabPlan['mode'], string> = { full: '全量', incremental: '增量', skip: '跳过' };
const fmtMin = (sec: number): string => (sec < 90 ? `${Math.round(sec)} 秒` : sec < 5400 ? `${Math.round(sec / 60)} 分钟` : `${(sec / 3600).toFixed(1)} 小时`);

export function RelationTask({ wsId }: { wsId: string }): ReactElement {
  const [jobs, setJobs] = useState<BgJob[] | null>(null);
  const [pace, setPace] = useState<PaceView[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const { st } = useBgStatus(wsId);
  const load = useCallback(() => {
    void xDataCall({ op: 'relationJobs', wsId }).then((r) => { if (r.status === 'ok') setJobs(r.value as BgJob[]); else setMsg(r.reason); });
    void xDataCall({ op: 'paceStatus' }).then((r) => { if (r.status === 'ok') setPace(r.value as PaceView[]); });
  }, [wsId]);
  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);

  const start = async (): Promise<void> => {
    setStarting(true);
    setMsg('读现状:去你的主页看 X 显示的人数,再和库里比…');
    const r = await xDataCall({ op: 'relationStart', wsId });
    setStarting(false);
    if (r.status === 'failed') { setMsg(r.reason); return; }
    const v = r.value as { created: boolean };
    setMsg(v.created ? '策略定好了,已经开始采 —— 下面看进度' : '已经有一个关系采集在跑,下面是它的进度');
    load();
  };
  const act = async (op: 'bgPauseJob' | 'bgResumeJob' | 'bgCancelJob', id: string): Promise<void> => {
    const r = await xDataCall({ op, id });
    if (r.status === 'failed') setMsg(r.reason);
    load();
  };

  const mine = (jobs ?? []).filter((j) => j.self);
  const others = (jobs ?? []).filter((j) => !j.self);
  const activeMine = mine.find((j) => j.status !== 'done' && j.status !== 'failed');
  const paceOf = (key: string): PaceView | undefined => pace.find((p) => p.key === key);

  const renderJob = (j: BgJob): ReactElement => {
    const cur = j.status === 'done' || j.status === 'failed' ? undefined : nextTab(j);
    const live = st?.live?.jobId === j.id;
    return (
      <div key={j.id} style={{ border: '1px solid var(--border-color, #333)', borderRadius: 6, padding: 8, marginTop: 8 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
          <strong>@{j.handle}{j.self ? '(我)' : ''}</strong>
          <span style={{ opacity: 0.7, fontSize: 12 }}>
            {j.status === 'done' ? '✅ 完成' : j.status === 'failed' ? '❌ 停了' : j.status === 'paused' ? '⏸ 暂停' : live ? '🟢 正在采' : '⏳ 等下一段'}
            {j.plan ? ` · 读现状于 ${new Date(j.plan.readAt).toLocaleString()}` : ''}
          </span>
          <span style={{ flex: 1 }} />
          {(j.status === 'queued' || j.status === 'running') && <button type="button" style={{ fontSize: 11 }} onClick={() => void act('bgPauseJob', j.id)}>暂停</button>}
          {j.status === 'paused' && <button type="button" style={{ fontSize: 11 }} onClick={() => void act('bgResumeJob', j.id)}>继续</button>}
          <button type="button" style={{ fontSize: 11 }} onClick={() => void act('bgCancelJob', j.id)} title="删掉这个任务(已采的人留在库里)">
            {j.status === 'done' || j.status === 'failed' ? '移除' : '取消'}
          </button>
        </div>
        {j.status === 'failed' && <div style={{ color: '#f87171', fontSize: 12, marginTop: 4 }}>{j.lastError}</div>}
        {j.status !== 'failed' && j.lastError && <div style={{ fontSize: 12, marginTop: 4, opacity: 0.8 }}>ℹ️ {j.lastError}</div>}
        {live && <div style={{ fontSize: 12, color: '#4caf50', marginTop: 4 }}>此刻:{st?.live?.msg}</div>}
        {!live && cur && j.status !== 'paused' && st?.waitNote && <div style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>等待:{st.waitNote}</div>}
        <table style={{ width: '100%', fontSize: 12, marginTop: 6, borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ opacity: 0.6, textAlign: 'left' }}>
              <th>名单</th><th>X 显示</th><th>开始时库里</th><th>策略</th><th>已采</th><th style={{ width: '22%' }}>进度</th>
            </tr>
          </thead>
          <tbody>
            {TABS.map((t) => {
              const p = j.plan?.tabs[t.id];
              const s: RelTabStats | undefined = j.stats?.[t.id];
              const done = tabProgress(j, t.id).done;
              const seen = s?.seen ?? 0;
              const target = p?.mode === 'full' ? p.xCount : undefined;
              const pct = done ? 100 : target ? Math.min(99, Math.round((seen / Math.max(target, 1)) * 100)) : undefined;
              const pv = paceOf(t.pace)?.state;
              const remainPages = done || !p ? 0 : p.mode === 'full' && target ? Math.max(Math.ceil((target - seen) / 50), 0) : Math.max(p.estPages - (s?.pages ?? 0), 1);
              const eta = pv && remainPages > 0 ? (Math.ceil(remainPages / pv.pages) - 1) * pv.gapSec + 30 : 0;
              return (
                <tr key={t.id} style={{ borderTop: '1px solid var(--border-color, #2a2a2a)', verticalAlign: 'top' }}>
                  <td>{t.label}{cur === t.id ? ' ◀' : ''}</td>
                  <td>{p?.xCount ?? (t.id === 'verifiedFollowers' ? '(X 不显示)' : '—')}</td>
                  <td>{p?.dbCount ?? '—'}</td>
                  <td title={p?.why}>{p ? `${MODE[p.mode]}:${p.why}` : '—'}</td>
                  <td>{s ? `${seen}(新 ${s.fresh})${s.reconciled ? ` · 标走了 ${s.reconciled}` : ''}` : '—'}</td>
                  <td>
                    <div style={{ background: 'var(--border-color, #333)', height: 6, borderRadius: 3, overflow: 'hidden' }}>
                      <div style={{ width: `${pct ?? (done ? 100 : seen > 0 ? 30 : 0)}%`, height: '100%', background: done ? '#4caf50' : '#4a90d9' }} />
                    </div>
                    <div style={{ opacity: 0.7 }}>
                      {p?.mode === 'skip' ? '跳过' : done ? (s?.note ?? '完成') : `${pct !== undefined ? `${pct}% · ` : ''}${eta > 0 ? `约还要 ${fmtMin(eta)}` : '排队'}`}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <div>
      <h3 style={{ margin: '0 0 6px', fontSize: 15 }}>关系采集</h3>
      <div style={{ fontSize: 12, opacity: 0.75 }}>
        读你主页上的关注者 / 关注数 → 和库里比 → 每个名单自己定策略(没采过就采全;差一些就从最新的增量采到追上;库里比 X 多就全量对一遍,把走了的标出来)→ 自动采。
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
        <button type="button" disabled={starting || activeMine !== undefined} onClick={() => void start()}
          title={activeMine ? '已经有一个在跑' : '读现状、定策略、开始采'}>
          {starting ? '读现状中…' : activeMine ? '正在采(看下面进度)' : '读现状并开始'}
        </button>
      </div>
      {msg && <div style={{ fontSize: 12, marginTop: 6 }}>{msg}</div>}
      {jobs !== null && mine.length === 0 && <div style={{ fontSize: 12, opacity: 0.6, marginTop: 8 }}>还没做过关系采集</div>}
      {mine.slice(0, 3).map(renderJob)}
      {others.length > 0 && (
        <>
          <div style={{ fontSize: 12, opacity: 0.75, marginTop: 12 }}>别人的名单(从人卡发起的)</div>
          {others.slice(0, 10).map(renderJob)}
        </>
      )}
      <div style={{ fontSize: 11, opacity: 0.6, marginTop: 12 }}>
        节奏(AI 按限流自己调,不用设置):
        {pace.map((p) => {
          const label = TABS.find((t) => t.pace === p.key)?.label ?? '推文';
          return (
            <span key={p.key} title={p.lastEvent ? `${new Date(p.lastEvent.at).toLocaleString()} ${p.lastEvent.why}:${p.lastEvent.from} → ${p.lastEvent.to}` : '还没调过'}>
              {' '}{label} 每 {fmtMin(p.state.gapSec)} 翻 {p.state.pages} 页{p.lastEvent ? `(${p.lastEvent.kind === 'slower' ? '最近放慢过' : '最近加快过'})` : ''} ·
            </span>
          );
        })}
      </div>
    </div>
  );
}
