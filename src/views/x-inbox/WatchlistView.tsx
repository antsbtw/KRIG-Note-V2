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
  // 搜索语法 spike:设计要求实施前必须实机验证,这里给个按钮
  const [spike, setSpike] = useState<{
    verdict?: string;
    probes?: Array<{ key: string; query: string; total: number; replies: number; noResults: boolean; sample: string[] }>;
  } | null>(null);

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

  const remove = async (handle: string) => {
    setBusy(true);
    const r = await api()?.watchlist('remove', handle);
    setBusy(false);
    if (!r?.success) { setStatus(`移出失败:${r?.error}`); return; }
    setStatus(`已把 @${handle} 移出名单(历史数据保留)`);
    setRows(r.watched ?? []);
  };

  const runSpike = async () => {
    const h = (input.trim() || rows[0]?.handle || '').replace(/^@/, '');
    if (!h) { setStatus('先在输入框填一个 handle(挑一个你知道他最近回复过别人的)'); return; }
    setBusy(true);
    setStatus(`正在实测三种搜索写法(会占用 X 页面导航三次)…`);
    const r = await api()?.searchSyntaxSpike(h);
    setBusy(false);
    if (!r?.success) { setStatus(`实测失败:${r?.error}`); return; }
    setSpike({ verdict: r.verdict, probes: r.probes });
    setStatus('');
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

      {/* ── 搜索语法实测 ──────────────────────────────── */}
      <div style={{ marginTop: 16, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6 }}>
          <b style={{ fontSize: 12 }}>搜索语法实测</b>
          <Btn sm onClick={runSpike} disabled={busy}>▶ 跑一次</Btn>
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>
          追踪名单要连<b>回复</b>一起采，但 X 对 <code>include:replies</code> 的支持时有变化。
          设计文档要求<b>实施前必须实机确认</b>哪种写法真的有效 —— 拿上面输入框里的 handle
          （挑一个你知道他最近回复过别人的）跑三种写法看结果。
          <br />⚠️ 判据不是「有没有报错」，而是<b>结果里有没有真的回复</b> ——
          错的写法不会报错，只会静默地只给你原创推。
        </div>
        {spike?.verdict && (
          <div style={{
            fontSize: 11, padding: '6px 9px', borderRadius: 5, marginBottom: 6,
            background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.3)',
          }}>{spike.verdict}</div>
        )}
        {spike?.probes?.map((p) => (
          <div key={p.key} style={{
            fontSize: 11, padding: '5px 8px', marginBottom: 4, borderRadius: 5,
            background: 'var(--bg-secondary)', border: '1px solid var(--border)',
          }}>
            <div>
              <code style={{ color: 'var(--text)' }}>{p.query}</code>
              {'　'}共 {p.total} 条，其中回复 <b style={{
                color: p.replies > 0 ? '#22c55e' : 'var(--text-faint)',
              }}>{p.replies}</b>
              {p.noResults && <span style={{ color: '#fca5a5' }}>　(页面显示无结果)</span>}
            </div>
            {p.sample.map((s, i) => (
              <div key={i} style={{ color: 'var(--text-faint)', marginTop: 2 }}>{s}</div>
            ))}
          </div>
        ))}
      </div>
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
