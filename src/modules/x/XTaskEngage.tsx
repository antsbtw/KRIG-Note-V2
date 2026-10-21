/**
 * ⭐⭐ 任务「蓝V互关」第 3 件事:已互关的蓝V,看互动情况(2026-10-22)
 *
 * 用户 10-16(流程 B「正确」):采互动 → 四组 → 「从没互动」进互动队列 → 挑他最近一条帖子回复 → 下轮复查。
 * 用户 10-22 选:互动 = 回复和提及;从没互动的走「和求关卡一样」(点赞 + 回复,不关注);「只有他对我」排最前。
 */
import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { xDataCall } from './x-data-types';
import type { EngageOverview } from './x-engage-repo';
import { AskRun, type AskWho } from './XTaskAsk';

const GROUP: ReadonlyArray<{ id: 'both' | 'onlyMe' | 'onlyHim' | 'none'; label: string; hint: string }> = [
  { id: 'both', label: '双向都有', hint: '我回过他,他也回过我' },
  { id: 'onlyMe', label: '只有我对他', hint: '我回过,他没吭声 —— 下轮复查' },
  { id: 'onlyHim', label: '只有他对我', hint: '他找过我,我没回 —— 排队列最前' },
  { id: 'none', label: '从没互动', hint: '进互动队列' },
];

export function EngageStep({ wsId }: { wsId: string }): ReactElement {
  const [ov, setOv] = useState<EngageOverview | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [collecting, setCollecting] = useState(false);
  const [open, setOpen] = useState(false);
  /** ⭐ 正在过互动卡的这一批(用户 10-22 选「和求关卡一样」) */
  const [engaging, setEngaging] = useState<AskWho[] | null>(null);
  const load = useCallback(() => {
    void xDataCall({ op: 'engageOverview', wsId, limit: 30 }).then((r) => { if (r.status === 'ok') setOv(r.value as EngageOverview); else setMsg(r.reason); });
  }, [wsId]);
  useEffect(() => { load(); }, [load]);

  const collect = async (): Promise<void> => {
    setCollecting(true);
    setMsg('采互动:搜「我回复过谁 / 谁回复过我 / 谁提到过我」最近 90 天(左边会跳到搜索页)…');
    const r = await xDataCall({ op: 'engageCollect', wsId });
    setCollecting(false);
    if (r.status === 'failed') { setMsg(r.reason); return; }
    const v = r.value as { runs: Array<{ label: string; pages: number; tweets: number; problem?: string }> };
    setMsg(`采完:${v.runs.map((x) => `${x.label} ${x.tweets} 条${x.problem ? `(⚠️ ${x.problem})` : ''}`).join(' · ')}`);
    load();
  };

  const last = ov?.lastCollected.map((c) => c.at).filter((x): x is string => !!x).sort().at(-1);
  return (
    <div>
      <div>互关蓝V {ov ? ov.mutualBlue.toLocaleString() : '…'} 人 · 最近 {ov?.days ?? 90} 天的回复 / 提及</div>
      <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
        {GROUP.map((g) => (
          <div key={g.id} title={g.hint} style={{ border: '1px solid var(--border-color, #333)', borderRadius: 6, padding: '4px 8px', fontSize: 12 }}>
            {g.label} <strong>{ov ? ov.groups[g.id].toLocaleString() : '…'}</strong>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 6, fontSize: 12, opacity: 0.85 }}>
        {ov?.lastCollected.map((c) => (
          <div key={c.key}>
            {c.label}:{c.oldest ? `已覆盖 ${c.oldest.slice(5, 10)} ~ ${c.newest?.slice(5, 10) ?? '?'}` : '还没采'}
            {c.done ? ' ✓ 满 90 天' : c.oldest ? ' · 还没到 90 天前,每天自动往更早补' : ''}
          </div>
        ))}
        <div style={{ opacity: 0.7 }}>⚠️ 没覆盖满 90 天前,「从没互动」会偏多(更早的往来还没采到)</div>
      </div>
      <div style={{ marginTop: 6, fontSize: 12 }}>
        互动数据上次采:{last ? new Date(last).toLocaleString() : '还没采过(分组先按库里已有的推文算)'}
        {' '}<button type="button" style={{ fontSize: 11 }} disabled={collecting} onClick={() => void collect()}>{collecting ? '采集中…' : '采互动'}</button>
        {' '}<button type="button" style={{ fontSize: 11 }} onClick={() => setOpen((o) => !o)}>{open ? '收起队列' : `看互动队列(${ov?.queueTotal ?? '…'} 人)`}</button>
        {' '}<button type="button" style={{ fontSize: 11 }} disabled={!ov || ov.queue.length === 0 || engaging !== null}
          onClick={() => setEngaging(ov!.queue.slice(0, 10).map((p) => ({ restId: p.restId, handle: p.handle, name: p.name, hisTweetId: p.lastHis?.tweetId })))}
          title="从队列最前的 10 人开始(他找过你的在前):选他一条帖子 → Gemma 草拟回复 → 你改 → 点赞 + 回复(不关注)">
          开始互动(前 10 人)
        </button>
      </div>
      {msg && <div style={{ fontSize: 12, marginTop: 4, opacity: 0.85 }}>{msg}</div>}
      {engaging && (
        <div style={{ marginTop: 8 }}>
          <AskRun mode="engage" wsId={wsId} queue={engaging} onPersonDone={load} onEnd={(d) => {
            setEngaging(null);
            setMsg(`这一批看完 ${d.length}/${engaging.length} 人:${d.map((x) => `@${x.who.handle} ${x.outcome}`).join(';')}`.slice(0, 400));
            load();
          }} />
        </div>
      )}
      {open && ov && (
        <div style={{ marginTop: 6, fontSize: 12, maxHeight: 300, overflow: 'auto' }}>
          {ov.queue.map((p) => (
            <div key={p.restId} style={{ padding: '3px 0', borderBottom: '1px solid var(--border-color, #2a2a2a)' }}>
              <strong>{p.name ?? p.handle}</strong> @{p.handle}
              {p.followers !== undefined && <span style={{ opacity: 0.6 }}> · 粉丝 {p.followers}</span>}
              <span style={{ opacity: 0.7 }}> · {p.group === 'onlyHim' ? '他找过我' : '从没互动'}</span>
              {p.lastHis && <div style={{ opacity: 0.7 }}>他说:{(p.lastHis.text ?? '').slice(0, 80)}{p.lastHis.at ? `(${new Date(p.lastHis.at).toLocaleDateString()})` : ''}</div>}
            </div>
          ))}
          {ov.queueTotal > ov.queue.length && <div style={{ opacity: 0.6 }}>…还有 {ov.queueTotal - ov.queue.length} 人</div>}
        </div>
      )}
    </div>
  );
}
