/**
 * XOpsStatus —— ⭐ 运营 → 「状态」:数据概要(2026-10-07)
 *
 * 用户定的内容:「更新时间、人数、推文数，一周的数据增长曲线」,
 * ⭐ 人的数字**只从三个标记来**(蓝V / 关注我 / 我关注),不显示「从哪个名单采到的」——
 * 用户 2026-10-07:「蓝V/关注我/我关注这三个关键要素能够采集下来，就不存在千面的数据错误了。」
 * 外加「还没采集」一行(缺什么)。增长 = **库里数据的增长**(采集进度);
 * 「我这个号的增长」放在「人」的最上面,不在这里。
 *
 * ── 数据从哪来 ──
 * 增长曲线与更新时间读**落库账本** `x_collect_log`(只追加),不读 fetched_at ——
 * 后者每次重采都改成当天,拿它画的曲线是假的(见 schema 1.2.19 注释)。
 * ⭐ 对账:账本「新增」合计应等于表行数;不等就在这里**明说差多少**。
 *
 * ── 图的形式(dataviz 方法)──
 * 人与推文量级差几十倍 → **两张独立的数字卡 + 迷你柱**,绝不共用一根轴。
 * 单序列不要图例(标题即名字);数字不逐柱标注,悬停看每天的值;另有「按天看数字」表格。
 * 柱色 = 参考调色板 slot 1(深色 #3987e5 / 浅色 #2a78d6),已对本 app 两种底色跑过校验器。
 */

import { useCallback, useEffect, useState, type CSSProperties, type ReactElement } from 'react';
import { xDataCall } from './x-data-types';
import { X_PAGE_NAME } from './x-pages';
import { ago, bucketByDay, reconcile, type DayBucket, type OpsStatus } from './x-ops-status';

/**
 * ⭐ 推文来源的中文说法。⚠️ 不认识的来源**原样显示**,不藏起来 ——
 * 采集加了新来源而这里没跟上时,人能一眼看到一个英文词,而不是少一行。
 */
const LIST_LABEL: Readonly<Record<string, string>> = {
  /** ⚠️ 页名从常量取,不写字面量(面板里不许出现写死的语义页名) */
  [X_PAGE_NAME.search]: '搜索',
};

export function XOpsStatus({ wsId }: { wsId: string }): ReactElement {
  const [status, setStatus] = useState<OpsStatus | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    const r = await xDataCall({ op: 'opsStatus', wsId });
    setBusy(false);
    if (r.status === 'ok') { setStatus(r.value as OpsStatus); setErr(null); setLoadedAt(new Date()); }
    else setErr(r.reason);
  }, [wsId]);

  useEffect(() => { void load(); }, [load]);

  const now = loadedAt ?? new Date();
  const days = status ? bucketByDay(status.series, now) : [];

  return (
    <div className="x-ops-viz" style={S.root}>
      {/* ⭐ 柱色按主题切换 —— 两种模式各自校验过,不是自动反色 */}
      <style>{`
        .x-ops-viz { --viz-series-1: #2a78d6; }
        [data-theme="dark"] .x-ops-viz { --viz-series-1: #3987e5; }
      `}</style>

      <div style={S.toolbar}>
        <button type="button" style={S.btn} disabled={busy} onClick={() => void load()}>
          {busy ? '读取中…' : '刷新'}
        </button>
        {loadedAt && <span style={S.muted}>读取于 {loadedAt.toLocaleTimeString()}</span>}
      </div>

      {err !== null && (
        <div style={S.error}>
          ⚠️ {err}
          {/x_collect_log/.test(err) && (
            <div style={S.muted}>账本表还没建 —— 重启一次 app,让迁移 1.2.19 跑完。</div>
          )}
        </div>
      )}

      {status && (
        <>
          <Tile
            title="人"
            total={status.people.total}
            ledger={status.people.ledgerInserted}
            subtitle={`采集于 ${status.people.lastAt ? new Date(status.people.lastAt).toLocaleString() : '无记录'} · ${ago(status.people.lastAt, now)}`}
            rows={[
              { key: 'fm', label: '关注我', value: status.people.followsMe },
              { key: 'if', label: '我关注', value: status.people.iFollow },
              { key: 'bv', label: '蓝V', value: status.people.blue },
            ]}
            footnote={status.people.renamedExtra > 0
              ? `含改名造成的重复 ${status.people.renamedExtra} 行(同一个人,旧 handle 一行、新 handle 一行)`
              : undefined}
            days={days}
            pick={(d) => d.users}
            unit="人"
          />
          <Tile
            title="推文"
            total={status.tweets.total}
            ledger={status.tweets.ledgerInserted}
            rows={status.tweets.sources.map((r) => ({
              key: r.name, label: LIST_LABEL[r.name] ?? r.name, value: r.count,
              note: ago(r.lastAt, now), noteTitle: r.lastAt ?? '账本里没有这个来源的记录',
            }))}
            days={days}
            pick={(d) => d.tweets}
            unit="条"
          />
          <div style={S.card}>
            <div style={S.cardTitle}>还没采集</div>
            {status.missing.length === 0
              ? <div style={S.muted}>该有的都有数据了</div>
              : <div>{status.missing.join(' · ')}</div>}
          </div>
        </>
      )}
    </div>
  );
}

type TileRow = {
  readonly key: string; readonly label: string; readonly value: number;
  readonly note?: string; readonly noteTitle?: string;
};

function Tile(
  { title, total, ledger, subtitle, rows, footnote, days, pick, unit }: {
    title: string; total: number; ledger: number; subtitle?: string; rows: readonly TileRow[];
    footnote?: string; days: DayBucket[]; pick: (d: DayBucket) => number; unit: string;
  },
): ReactElement {
  const rec = reconcile(total, ledger);
  return (
    <div style={S.card}>
      <div style={S.cardHead}>
        <span style={S.cardTitle}>{title}</span>
        <span style={S.hero}>{total.toLocaleString()}</span>
        {/* ⭐ 对账:状态色必配图标+文字,不只靠颜色 */}
        <span
          style={rec.ok ? S.ok : S.warn}
          title={`账本「新增」合计 ${ledger.toLocaleString()} · 表里 ${total.toLocaleString()}`}
        >
          {rec.ok ? '✓ 对账一致' : `⚠️ 账本差 ${rec.diff.toLocaleString()}`}
        </span>
      </div>
      {/* ⭐ 数字停在采集那一刻 —— 用户核对靠网页,差的就是这段时间 */}
      {subtitle && <div style={S.muted}>{subtitle}</div>}
      {!rec.ok && (
        <div style={S.muted}>
          有数据没记进账本 —— 若是账本建立前采的,跑 node scripts/x-backfill-collect-log.mjs 补;
          否则是有数据没走正规落库路径进库。
        </div>
      )}

      <div style={S.rows}>
        {rows.map((r) => (
          <div key={r.key} style={S.row}>
            <span style={{ flex: 1 }}>{r.label}</span>
            <span style={S.num}>{r.value.toLocaleString()}</span>
            {r.note !== undefined && (
              <span style={{ ...S.muted, width: 92, textAlign: 'right' }} title={r.noteTitle}>{r.note}</span>
            )}
          </div>
        ))}
      </div>
      {footnote && <div style={S.muted}>{footnote}</div>}

      <Spark days={days} pick={pick} unit={unit} />
    </div>
  );
}

/** ⭐ 近 7 天每天新增 —— 迷你柱:细柱、顶端 4px 圆角落在基线上、柱间留缝、悬停看值 */
function Spark(
  { days, pick, unit }: { days: DayBucket[]; pick: (d: DayBucket) => number; unit: string },
): ReactElement {
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const values = days.map(pick);
  const max = Math.max(1, ...values);
  const sum = values.reduce((a, b) => a + b, 0);
  const W = 7 * 28;
  const H = 40;
  const slot = W / days.length;
  const bw = Math.min(16, slot - 4);

  return (
    <div style={{ marginTop: 8 }}>
      <div style={S.sparkHead}>
        <span>近 7 天新增 · 合计 {sum.toLocaleString()} {unit}</span>
        <button type="button" style={S.linkBtn} onClick={() => setTable((t) => !t)}>
          {table ? '看图' : '按天看数字'}
        </button>
      </div>

      {table ? (
        <table style={S.table}>
          <tbody>
            {days.map((d, i) => (
              <tr key={d.key}><td>{d.label}</td><td style={S.num}>{values[i].toLocaleString()}</td></tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div style={{ position: 'relative', width: W }}>
          <svg width={W} height={H + 14} role="img" aria-label={`近 7 天每天新增${unit}数`}>
            {days.map((d, i) => {
              const v = values[i];
              const x = i * slot + (slot - bw) / 2;
              const h = v === 0 ? 0 : Math.max(2, (v / max) * H);
              const r = Math.min(4, h, bw / 2);
              return (
                <g key={d.key}>
                  {/* ⭐ 命中区 = 整列,比柱子大 */}
                  <rect
                    x={i * slot} y={0} width={slot} height={H}
                    fill="transparent"
                    onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}
                  />
                  {v === 0 ? (
                    /** 0 是真的 0(账本那天没有新增)—— 画一道基线短线,不留空白让人以为缺数据 */
                    <line x1={x} x2={x + bw} y1={H - 0.5} y2={H - 0.5} stroke="var(--text-muted, #666)" strokeOpacity={0.5} />
                  ) : (
                    <path
                      d={`M${x},${H} V${H - h + r} Q${x},${H - h} ${x + r},${H - h} H${x + bw - r} Q${x + bw},${H - h} ${x + bw},${H - h + r} V${H} Z`}
                      fill="var(--viz-series-1)"
                      opacity={hover === null || hover === i ? 1 : 0.55}
                      pointerEvents="none"
                    />
                  )}
                </g>
              );
            })}
            {/* 只标首尾两天的日期,中间靠悬停 */}
            <text x={slot / 2} y={H + 12} fontSize={9} textAnchor="middle" fill="var(--text-muted, #888)">{days[0]?.label}</text>
            <text x={W - slot / 2} y={H + 12} fontSize={9} textAnchor="middle" fill="var(--text-muted, #888)">今天</text>
          </svg>
          {hover !== null && (
            <div style={{ ...S.tip, left: Math.min(W - 90, Math.max(0, hover * slot - 30)) }}>
              {days[hover].label} 新增 {values[hover].toLocaleString()} {unit}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const S: Record<string, CSSProperties> = {
  root: { display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 560 },
  toolbar: { display: 'flex', alignItems: 'center', gap: 8 },
  btn: {
    background: 'transparent', border: '1px solid var(--border-color, #444)', borderRadius: 4,
    color: 'var(--text-secondary, #aaa)', cursor: 'pointer', fontSize: 12, padding: '3px 10px',
  },
  linkBtn: {
    marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer',
    color: 'var(--text-muted, #888)', fontSize: 11, padding: 0,
  },
  muted: { fontSize: 11, color: 'var(--text-muted, #888)' },
  error: { fontSize: 12, color: 'var(--text-primary, #ddd)', border: '1px solid #7a3b3b', borderRadius: 4, padding: 8 },
  card: {
    border: '1px solid var(--border-color, #333)', borderRadius: 6, padding: '10px 12px',
    display: 'flex', flexDirection: 'column', gap: 6,
  },
  cardHead: { display: 'flex', alignItems: 'baseline', gap: 10 },
  cardTitle: { fontSize: 12, color: 'var(--text-secondary, #aaa)' },
  hero: { fontSize: 22, color: 'var(--text-primary, #ddd)', fontVariantNumeric: 'tabular-nums' },
  ok: { marginLeft: 'auto', fontSize: 11, color: 'var(--text-secondary, #aaa)' },
  warn: { marginLeft: 'auto', fontSize: 11, color: 'var(--text-primary, #ddd)' },
  rows: { display: 'flex', flexDirection: 'column', gap: 2 },
  row: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-secondary, #aaa)' },
  num: { fontVariantNumeric: 'tabular-nums', color: 'var(--text-primary, #ddd)', textAlign: 'right', minWidth: 48 },
  sparkHead: { display: 'flex', alignItems: 'center', fontSize: 11, color: 'var(--text-muted, #888)', marginBottom: 4, maxWidth: 196 },
  table: { fontSize: 11, color: 'var(--text-secondary, #aaa)', borderSpacing: '12px 2px', marginLeft: -12 },
  tip: {
    position: 'absolute', top: -4, padding: '2px 6px', borderRadius: 4, fontSize: 11, whiteSpace: 'nowrap',
    background: 'var(--bg-popup, #2a2a2a)', color: 'var(--text-primary, #ddd)',
    border: '1px solid var(--border-color, #444)', pointerEvents: 'none',
  },
};
