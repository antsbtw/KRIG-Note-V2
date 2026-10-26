/**
 * ⭐ 一个人的互动时间线(2026-10-19,蓝V互关求关第 4 阶段)
 *
 * 用户 10-17:「建立和对方互动的时间线。确保未来能够定期互动,最终把对方发展为我们的客户。」
 * 用户 10-19 选:放人卡「互动」栏;任务页求关名单点人名就地展开同一个组件。
 * ⚠️ 只画库里有的(求关记录 / 动作记录 / 关系变化 / 已采到的推文);没采的(他给我点赞等)在底部说明,不假装没有。
 */
import { useEffect, useState, type ReactElement } from 'react';
import { xDataCall } from './x-data-types';
import type { TimelineEvent } from './x-follow-back';

const fmt = (iso: string): string => {
  const d = new Date(iso);
  return `${d.getMonth() + 1}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

export function XPersonTimeline({ wsId, restId, rev }: { wsId: string; restId: string; rev?: number }): ReactElement {
  const [data, setData] = useState<{ events: TimelineEvent[]; sources: Record<string, number> } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    setData(null);
    void xDataCall({ op: 'personTimeline', wsId, restId }).then((r) => {
      if (r.status === 'ok') { setData(r.value as { events: TimelineEvent[]; sources: Record<string, number> }); setErr(null); } else setErr(r.reason);
    });
  }, [wsId, restId, rev]);

  if (err) return <div style={{ color: '#f87171', fontSize: 12 }}>⚠️ {err}</div>;
  if (!data) return <div style={{ opacity: 0.6, fontSize: 12 }}>读取中…</div>;
  return (
    <div style={{ fontSize: 12 }}>
      {data.events.length === 0 && <div style={{ opacity: 0.6 }}>还没有任何往来记录</div>}
      {data.events.map((e, i) => (
        <div key={`${e.at}-${i}`} style={{ display: 'flex', gap: 8, padding: '3px 0', borderBottom: '1px solid var(--border-color, #2a2a2a)' }}>
          <span style={{ opacity: 0.7, whiteSpace: 'nowrap' }} title={e.from ? `上次看到他还没关注是 ${new Date(e.from).toLocaleString()};这次看到是 ${new Date(e.at).toLocaleString()}` : new Date(e.at).toLocaleString()}>
            {e.from ? `${fmt(e.from)} ~ ${fmt(e.at)}` : fmt(e.at)}
          </span>
          <span style={{ minWidth: 0 }}>
            <span style={{ color: e.who === 'him' ? '#5fc98a' : undefined }}>{e.text}</span>
            {e.detail && <div style={{ opacity: 0.7, whiteSpace: 'pre-wrap' }}>{e.detail}</div>}
          </span>
        </div>
      ))}
      <div style={{ opacity: 0.55, marginTop: 4 }}>
        来源:{Object.entries(data.sources).map(([k, n]) => `${k} ${n}`).join(' · ')}。
        关系变化的时间是「看到的时间」—— 回关写成一段时间范围;他给我点赞、转发我的推文还没采,不在线上。
      </div>
    </div>
  );
}
