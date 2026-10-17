/**
 * ⭐⭐⭐ 抽查卡片(2026-10-16)—— 运营面板顶部,右键「查库」后弹出
 *
 * 用户 10-16:「右键关联后,对应的右边应该弹出card--从数据库搜索的结果。如果没有,代表着没有成功采集,
 * 如果多次抽查成功,说明是成功的」「库里没有,就是漏采了」
 * 上面是左边页面上看到的字,下面是库里存的那份 —— 人自己对照。
 */
import { useEffect, useState, useSyncExternalStore, type ReactElement } from 'react';
import { xDataCall } from './x-data-types';
import { getSpot, setSpot, subscribeSpot } from './x-spot-store';
import { relationLabel, type PersonDetail } from './x-people-query';

type Tweet = { tweet_id: string; text?: string; author_handle?: string; created_at?: string; fetched_at?: string; source?: string; search_recipe?: string };
type Result =
  | { kind: 'tweet'; found: false; tweetId: string }
  | { kind: 'tweet'; found: true; tweet: Tweet; author: PersonDetail | null }
  | { kind: 'person'; found: false; handle: string }
  | { kind: 'person'; found: true; person: PersonDetail };

const t = (s?: string): string => (s ? new Date(s).toLocaleString() : '—');

function PersonLine({ p }: { p: PersonDetail }): ReactElement {
  return (
    <div style={{ fontSize: 12 }}>
      <strong>{p.display_name ?? p.handle}</strong> @{p.handle}
      {p.is_blue_verified === true && <span style={{ color: '#1d9bf0' }}> ✓蓝V</span>}
      {' · '}{relationLabel(p)}
      {p.mutual_intent === true && <span style={{ color: '#5fc98a' }}> · 🤝互关倾向</span>}
      {p.bio && <div style={{ opacity: 0.75 }}>{p.bio}</div>}
      <div style={{ opacity: 0.6 }}>采于 {t(p.fetched_at)}</div>
    </div>
  );
}

export function XSpotCard({ wsId }: { wsId: string }): ReactElement | null {
  const req = useSyncExternalStore(subscribeSpot, () => getSpot(wsId));
  const [res, setRes] = useState<Result | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setRes(null); setErr(null);
    if (!req || req.why) return;
    void xDataCall({ op: 'spotCheckLookup', wsId, kind: req.kind, tweetId: req.tweetId, handle: req.handle }).then((r) => {
      if (r.status === 'ok') setRes(r.value as Result); else setErr(r.reason);
    });
  }, [req, wsId]);

  if (!req) return null;
  const box = { border: '1px solid var(--border-color, #444)', borderRadius: 6, padding: 10, margin: '8px 12px', background: 'var(--bg-secondary, #1b1b1b)' };
  return (
    <div style={box}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
        <strong>🔎 抽查</strong>
        <span style={{ opacity: 0.7 }}>
          {req.kind === 'tweet' ? `推文 ${req.tweetId ?? '?'}${req.handle ? ` · @${req.handle}` : ''}` : `@${req.handle ?? '?'}`}
          {' · '}{new Date(req.at).toLocaleTimeString()}
        </span>
        <span style={{ flex: 1 }} />
        <button type="button" onClick={() => setSpot(wsId, null)} title="关掉" style={{ fontSize: 11, cursor: 'pointer' }}>✕</button>
      </div>
      {req.text && <div style={{ fontSize: 12, opacity: 0.8, marginTop: 4 }}>页面上:{req.text}</div>}
      {req.why && <div style={{ color: '#d9a441', marginTop: 6, fontSize: 12 }}>⚠️ 没认出右键点的是哪条({req.why})—— 请右键点在推文正文 / 名单里那个人上</div>}
      {err && <div style={{ color: '#f87171', marginTop: 6, fontSize: 12 }}>查库出错:{err}</div>}
      {!req.why && !res && !err && <div style={{ opacity: 0.6, marginTop: 6, fontSize: 12 }}>查库中…</div>}
      {res && !res.found && (
        <div style={{ color: '#f87171', marginTop: 6, fontSize: 13 }}>
          ✗ 库里没有 —— 这{res.kind === 'tweet' ? '条推文' : '个人'}漏采了({res.kind === 'tweet' ? res.tweetId : `@${res.handle}`})
        </div>
      )}
      {res && res.found && res.kind === 'tweet' && (
        <div style={{ marginTop: 6 }}>
          <div style={{ color: '#5fc98a', fontSize: 13 }}>✓ 库里有</div>
          <div style={{ fontSize: 12, marginTop: 4 }}>库里:{res.tweet.text}</div>
          <div style={{ fontSize: 11, opacity: 0.6 }}>
            发于 {t(res.tweet.created_at)} · 采于 {t(res.tweet.fetched_at)} · 来自 {res.tweet.source ?? '?'}
          </div>
          {res.author && <div style={{ marginTop: 6 }}><PersonLine p={res.author} /></div>}
        </div>
      )}
      {res && res.found && res.kind === 'person' && (
        <div style={{ marginTop: 6 }}>
          <div style={{ color: '#5fc98a', fontSize: 13 }}>✓ 库里有</div>
          <PersonLine p={res.person} />
        </div>
      )}
    </div>
  );
}
