/**
 * ⭐⭐ 任务「蓝V互关」第 2 件事:对有互关倾向的,互动求关(2026-10-16,M3 候选 + M4 关注队列 + M5 回访)
 *
 * 用户 10-16:关注=「你在候选列表里勾一批,程序按节奏慢慢关」;回访「关注后几天还没回关,就算不回关」「正确」。
 * 主页面只放进度;点「去求关」才展开候选名单 / 队列 / 回访(用户:「围绕需要做的事情来展现」)。
 * ⚠️ 关注在主进程按节奏跑(每日上限 / 间隔 / 随机加 —— 运营设置里可改),异常即停。
 */
import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { xDataCall } from './x-data-types';

type Cand = { rest_id: string; handle: string; display_name?: string; followers_count?: number; follows_me?: boolean; mutual_intent_evidence?: string };
type Prog = { followedTotal: number; followedBack: number; revisit: Array<{ rest_id: string; handle: string; followedAt: string }>; revisitDays: number; today: number; cap: number };
type QItem = { restId: string; handle: string };
type QDone = { restId: string; handle: string; at: string; state: 'followed' | 'already-following' | 'failed'; detail?: string };
type QStatus = { waiting: number; next: QItem[]; current?: QItem; paused?: string; note?: string; nextAt: number; done: QDone[]; now: number };

const STATE: Record<QDone['state'], string> = { followed: '✓ 已关注', 'already-following': '· 本来就关注着', failed: '✗ 没关成' };

export function FollowStep({ wsId, candidates }: { wsId: string; candidates: number | undefined }): ReactElement {
  const [open, setOpen] = useState(false);
  const [prog, setProg] = useState<Prog | null>(null);
  const [qs, setQs] = useState<QStatus | null>(null);
  const [cands, setCands] = useState<Cand[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState<string | null>(null);

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
  const toggle = (id: string): void => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const follow = async (): Promise<void> => {
    const items = (cands ?? []).filter((c) => picked.has(c.rest_id))
      .map((c) => ({ restId: c.rest_id, handle: c.handle, reason: `蓝V互关:${c.mutual_intent_evidence ?? ''}`.slice(0, 200) }));
    const r = await xDataCall({ op: 'followQueueAdd', wsId, items });
    if (r.status === 'failed') { setMsg(r.reason); return; }
    const v = r.value as { added: number; skipped: number };
    setMsg(`已加入关注队列 ${v.added} 人${v.skipped > 0 ? `(${v.skipped} 人已在队列里)` : ''},按节奏一个一个关`);
    setPicked(new Set());
    loadQ();
  };
  const control = async (action: 'pause' | 'resume' | 'clear'): Promise<void> => {
    await xDataCall({ op: 'followQueueControl', wsId, action });
    loadQ();
  };

  const secs = qs && qs.nextAt > qs.now ? Math.round((qs.nextAt - qs.now) / 1000) : 0;
  const qLine = !qs ? '' : qs.paused ? `⏸ 已暂停:${qs.paused}`
    : qs.current ? `▶ 正在关注 @${qs.current.handle}`
      : qs.waiting > 0 ? `▶ 队列 ${qs.waiting} 人 · ${qs.note ?? (secs > 0 ? `下一个约 ${secs} 秒后` : '马上开始')}`
        : '队列空着';

  return (
    <div>
      <div>候选(蓝V · 我没关注 · 有互关倾向):{candidates ?? '…'} 人</div>
      <div style={{ marginTop: 4 }}>
        今天已关注 {prog ? `${prog.today}/${prog.cap}` : '…'} · 累计关注 {prog?.followedTotal ?? '…'} · 已回关 {prog?.followedBack ?? '…'}
        {' '}· 回访(满 {prog?.revisitDays ?? 7} 天没回关){prog?.revisit.length ?? '…'} 人
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
          <div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <strong style={{ fontSize: 12 }}>候选名单</strong>
              <span style={{ fontSize: 12, opacity: 0.7 }}>{cands ? `${cands.length} 人(粉丝多的在前)` : '读取中…'}</span>
              <button type="button" style={{ fontSize: 11 }}
                onClick={() => setPicked(new Set((cands ?? []).filter((c) => !queued.has(c.rest_id)).slice(0, prog ? Math.max(0, prog.cap - prog.today) : 10).map((c) => c.rest_id)))}
                title="勾上今天还能关的数量">勾今天的量</button>
              <button type="button" style={{ fontSize: 11 }} onClick={() => setPicked(new Set())}>全不选</button>
              <button type="button" disabled={picked.size === 0} onClick={() => void follow()}>关注选中的 {picked.size} 人</button>
            </div>
            <div style={{ maxHeight: 320, overflow: 'auto', marginTop: 6, fontSize: 12 }}>
              {(cands ?? []).map((c) => (
                <label key={c.rest_id} style={{ display: 'flex', gap: 6, padding: '3px 0', borderBottom: '1px solid var(--border-color, #2a2a2a)', opacity: queued.has(c.rest_id) ? 0.5 : 1 }}>
                  <input type="checkbox" checked={picked.has(c.rest_id)} disabled={queued.has(c.rest_id)} onChange={() => toggle(c.rest_id)} />
                  <span style={{ minWidth: 0 }}>
                    <strong>{c.display_name ?? c.handle}</strong> @{c.handle}
                    {c.followers_count !== undefined && <span style={{ opacity: 0.6 }}> · 粉丝 {c.followers_count}</span>}
                    {c.follows_me === true && <span style={{ color: '#5fc98a' }}> · 他已关注我</span>}
                    {queued.has(c.rest_id) && <span> · 在队列里</span>}
                    <div style={{ opacity: 0.7 }}>依据 · {c.mutual_intent_evidence ?? '—'}</div>
                  </span>
                </label>
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
            <strong style={{ fontSize: 12 }}>回访:关注满 {prog?.revisitDays ?? 7} 天还没回关</strong>
            <div style={{ fontSize: 12, marginTop: 4 }}>
              {prog && prog.revisit.length === 0 && <span style={{ opacity: 0.6 }}>暂无</span>}
              {prog?.revisit.map((r) => <div key={r.rest_id}>@{r.handle} · 关注于 {new Date(r.followedAt).toLocaleDateString()}</div>)}
              {prog && prog.revisit.length > 0 && <div style={{ opacity: 0.6, marginTop: 4 }}>要取关:在「运营 → 人」的「我关注·他没回关」里处理</div>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
