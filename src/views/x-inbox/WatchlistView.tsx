/**
 * 追踪名单 —— 需求 ②⑤ 的界面。
 *
 * ⚠️ **措辞**:一律「追踪名单」,**不出现「关注」二字**(设计 §0 明令)。
 * 这是**本 app 内部的采集清单**,与 X 上的 follow 毫无关系:
 * 可以追踪一个没关注的人,也可以不追踪已关注的好友。
 * 混用措辞会让人以为在这里操作会改动 X 上的关注关系。
 *
 * 统计不是存出来的,是**每次现算**(getAuthorStats)——
 * 设计 §4.1(4):计数是可重算的第三层属性,存进「人」表会有不同步问题。
 */
import { useCallback, useEffect, useState } from 'react';

const api = () => window.electronAPI?.xTimeline;

type Row = NonNullable<
  Awaited<ReturnType<NonNullable<ReturnType<typeof api>>['watchlist']>>['watched']
>[number];

interface Props {
  workspaceId: string;
  onBack: () => void;
}

export function WatchlistView({ workspaceId, onBack }: Props) {
  const [rows, setRows] = useState<Row[]>([]);
  const [input, setInput] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [cands, setCands] = useState<Array<{ handle: string; repliedCount: number; seenTweets: number }>>([]);
  const [showCands, setShowCands] = useState(false);

  const load = useCallback(async () => {
    const r = await api()?.watchlist('list');
    if (r?.success) setRows(r.watched ?? []);
    else setStatus(`读取失败:${r?.error ?? '未知错误'}`);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const add = async () => {
    const h = input.trim().replace(/^@/, '');
    if (!h) return;
    setBusy(true);
    const r = await api()?.watchlist('add', h);
    setBusy(false);
    if (!r?.success) { setStatus(`加入失败:${r?.error}`); return; }
    setInput('');
    setStatus(`已把 @${h} 加入追踪名单`);
    setRows(r.watched ?? []);
  };

  /** 从已有数据里挑候选 —— 不用凭记忆手打 handle */
  const loadCandidates = async () => {
    setBusy(true);
    const r = await api()?.watchlist('candidates');
    setBusy(false);
    if (!r?.success) { setStatus(`取候选失败:${r?.error}`); return; }
    const list = r.candidates ?? [];
    setCands(list);
    setShowCands(true);
    setStatus(list.length ? `找到 ${list.length} 个候选(按回过次数排)` : '没有候选 —— 还没回过任何人');
  };

  const addHandle = async (h: string) => {
    setBusy(true);
    const r = await api()?.watchlist('add', h);
    setBusy(false);
    if (!r?.success) { setStatus(`加入失败:${r?.error}`); return; }
    setRows(r.watched ?? []);
    setCands((prev) => prev.filter((c) => c.handle !== h));
    setStatus(`已把 @${h} 加入追踪名单`);
  };

  /** 把所有「采纳过的推」的作者一次性建立追踪关系 */
  const watchAccepted = async () => {
    setBusy(true);
    setStatus('正在给已确认推文的作者建立追踪关系…');
    const r = await api()?.watchlist('watch-accepted');
    setBusy(false);
    if (!r?.success) { setStatus(`失败:${r?.error}`); return; }
    setRows(r.watched ?? []);
    const b = r.bulk;
    setStatus(b ? `已建立 ${b.added} 个追踪关系(跳过 ${b.skipped} 个:已在名单/已屏蔽/本人)` : '完成');
  };

  const remove = async (handle: string) => {
    setBusy(true);
    const r = await api()?.watchlist('remove', handle);
    setBusy(false);
    if (!r?.success) { setStatus(`移出失败:${r?.error}`); return; }
    setStatus(`已把 @${handle} 移出名单(历史数据保留)`);
    setRows(r.watched ?? []);
  };

  return (
    <div style={{ padding: 12, height: '100%', overflow: 'auto', color: 'var(--text)' }}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 10, flexWrap: 'wrap' }}>
        <Btn onClick={onBack}>← 返回收件箱</Btn>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void add(); }}
          placeholder="@handle"
          style={{
            fontSize: 12, padding: '3px 8px', borderRadius: 5, width: 170,
            background: 'var(--bg-secondary)', color: 'var(--text)',
            border: '1px solid var(--border)',
          }}
        />
        <Btn primary onClick={add} disabled={busy || !input.trim()}>+ 加入追踪</Btn>
        <Btn onClick={loadCandidates} disabled={busy}>📋 从已回过的人里挑</Btn>
        <Btn onClick={watchAccepted} disabled={busy}>✓ 已确认的全部追踪</Btn>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{status}</span>
      </div>

      {/* 说明:防止和 X 的关注混淆 —— 这是设计文档反复强调的一点 */}
      <div style={{
        fontSize: 11, color: 'var(--text-muted)', background: 'var(--bg-secondary)',
        border: '1px solid var(--border)', borderRadius: 6, padding: '6px 9px', marginBottom: 10,
      }}>
        ⓘ 这是<b>本 app 内部的采集清单</b>，和你在 X 上「关注」谁<b>没有任何关系</b>。
        加入这里不会去关注对方，移出也不会取消关注。
        回复过的人会<b>自动入列</b>（层数 1），手动加入的是层数 0。
      </div>

      {/* 候选:从库里已有数据挑,免得手打 —— 按「我们回过他几次」排,
          那正是画像价值最高的一小撮(设计 §1.4:互动是长尾的) */}
      {showCands && cands.length > 0 && (
        <div style={{
          border: '1px solid var(--border)', borderRadius: 7, padding: 8,
          marginBottom: 10, background: 'var(--bg-secondary)',
        }}>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>
            候选（按<b>我们回过他几次</b>排，回得多说明他反复出现在求助场景里）
            <Btn sm onClick={() => setShowCands(false)} style={{ marginLeft: 8 }}>收起</Btn>
          </div>
          {cands.map((c) => (
            <div key={c.handle} style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '3px 2px',
              fontSize: 11, borderBottom: '1px solid var(--border)',
            }}>
              <b>@{c.handle}</b>
              <span style={{ color: 'var(--text-muted)' }}>
                回过 {c.repliedCount} 次 · 见过 {c.seenTweets} 条
              </span>
              <Btn sm onClick={() => addHandle(c.handle)} style={{ marginLeft: 'auto' }}>+ 追踪</Btn>
            </div>
          ))}
        </div>
      )}

      {rows.length === 0 && (
        <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '14px 4px' }}>
          名单是空的。回复过的人会自动进来，也可以在上面手动加。
        </div>
      )}

      {rows.map((w) => (
        <div key={w.handle} style={{
          border: '1px solid var(--border)', borderRadius: 7, padding: '8px 10px',
          marginBottom: 7, background: 'var(--bg-secondary)',
          display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
        }}>
          <b style={{ fontSize: 12 }}>@{w.handle}</b>
          <span style={{
            fontSize: 10, padding: '1px 5px', borderRadius: 4,
            background: 'var(--border)', color: 'var(--text-muted)',
          }}>
            {w.watchSource === 'replied' ? '回复过·自动' : '手动'}·层数 {w.watchDepth}
          </span>
          {w.stats && (
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              见过 {w.stats.seenTweets} 条 · 回过 {w.stats.repliedCount} · 采纳 {w.stats.acceptedCount}
            </span>
          )}
          {w.note && <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>{w.note}</span>}
          <Btn sm onClick={() => remove(w.handle)} style={{ marginLeft: 'auto' }}>移出</Btn>
        </div>
      ))}

    </div>
  );
}

function Btn({ onClick, primary, sm, disabled, children, style }: {
  onClick?: () => void; primary?: boolean; sm?: boolean; disabled?: boolean;
  children: React.ReactNode; style?: React.CSSProperties;
}) {
  return (
    <button
      type="button" onClick={onClick} disabled={disabled}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        padding: sm ? '2px 7px' : '3px 10px',
        borderRadius: 5, fontSize: sm ? 11 : 12, cursor: disabled ? 'not-allowed' : 'pointer',
        border: '1px solid',
        background: primary ? 'var(--accent)' : 'var(--border)',
        color: primary ? '#fff' : 'var(--text)',
        borderColor: primary ? 'var(--accent)' : 'var(--text-faint)',
        opacity: disabled ? 0.5 : 1,
        ...style,
      }}
    >
      {children}
    </button>
  );
}
