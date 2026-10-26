/**
 * ⭐ 运营 → 状态:契约类型 + 纯函数(按天分桶、对账、多久以前)—— 离线可测
 *
 * 数据由 main 侧 `readOpsStatus()`(x-collect-log-repo.ts)一次查齐。
 * ⭐ 查询的 SQL 与解析(`buildOpsStatusQuery` / `parseOpsStatus`)也在这里 ——
 * 纯函数,离线脚本能用**同一份** SQL 去问真库,不必拉起 app 的数据库客户端。
 *
 * ⚠️ 分桶放在 **renderer** 做:「哪天」要按人所在的时区算,
 * 放在 main 用 UTC 切,晚上 8 点以后的采集会被算到第二天。
 */

import { PEOPLE_WITH_RELATION } from './x-account';


export type OpsListStat = {
  readonly name: string;
  readonly count: number;
  /** ⚠️ undefined = 账本里没有这个名单的记录(不是「从没采过」的同义词:可能是账本建立前采的) */
  readonly lastAt?: string;
};

export type OpsStatus = {
  /**
   * ⭐⭐ 人 —— **事实只从三个标记来**(用户 2026-10-07 拍板):
   * 「蓝V/关注我/我关注这三个关键要素能够采集下来，就不存在千面的数据错误了。」
   * ⚠️ 不再显示「从哪个名单采到的」(list_memberships):那是采集痕迹不是事实 ——
   * 「蓝V关注者 2681」就是拿它当事实闹出来的(真实值 4303)。
   */
  readonly people: {
    readonly total: number;
    /** 账本里「新增」的合计 —— 对账用,应等于 total */
    readonly ledgerInserted: number;
    readonly followsMe: number;
    readonly iFollow: number;
    readonly blue: number;
    /** 改名造成的多余行(同一数字 id 多行,多出几行)—— 如实标出,根治靠改身份为数字 id */
    readonly renamedExtra: number;
    /** 最近一次采人的时间(账本)—— 数字停在这一刻,核对网页时差的就是这段时间 */
    readonly lastAt?: string;
  };
  readonly tweets: {
    readonly total: number;
    readonly ledgerInserted: number;
    readonly sources: readonly OpsListStat[];
  };
  /** 最近几天的账本行(原始),由 `bucketByDay` 分桶 */
  readonly series: ReadonlyArray<{ readonly at: string; readonly kind: 'users' | 'tweets'; readonly inserted: number }>;
  /** 「还没采集」的数据类别 */
  readonly missing: readonly string[];
};

export type DayBucket = { readonly key: string; readonly label: string; readonly users: number; readonly tweets: number };

const pad = (n: number): string => String(n).padStart(2, '0');
const localKey = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/**
 * ⭐ 最近 `days` 天(含今天),按**本地**日期分桶。
 * ⚠️ 没有采集的那天是 0 —— 这里的 0 是真的 0(账本里那天确实没有新增),
 * 不是「不知道」:账本只追加,没记就是没落库。
 */
export function bucketByDay(series: OpsStatus['series'], now: Date, days = 7): DayBucket[] {
  const out: Array<{ key: string; label: string; users: number; tweets: number }> = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    out.push({ key: localKey(d), label: `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, users: 0, tweets: 0 });
  }
  const idx = new Map(out.map((b, i) => [b.key, i]));
  for (const r of series) {
    const i = idx.get(localKey(new Date(r.at)));
    if (i === undefined) continue;
    if (r.kind === 'users') out[i].users += r.inserted;
    else out[i].tweets += r.inserted;
  }
  return out;
}

/** ⭐ 对账:账本合计 vs 表行数。差值 ≠ 0 说明有数据没走正规落库路径(或账本漏记) */
export function reconcile(total: number, ledgerInserted: number): { readonly ok: boolean; readonly diff: number } {
  return { ok: total === ledgerInserted, diff: total - ledgerInserted };
}

/** 「3 小时前」「2 天前」—— 新鲜度给人看的说法 */
export function ago(iso: string | undefined, now: Date): string {
  if (iso === undefined) return '无记录';
  const ms = now.getTime() - new Date(iso).getTime();
  if (Number.isNaN(ms)) return '时间无效';
  const min = Math.floor(ms / 60000);
  if (min < 1) return '刚刚';
  if (min < 60) return `${min} 分钟前`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} 小时前`;
  return `${Math.floor(h / 24)} 天前`;
}

/**
 * ⭐ 「还该有、但可能还没采」的数据 —— 状态页最下面那行「还没采集」。
 * ⚠️ 加一类就加一行,渲染处不写第二份清单。
 */
const EXPECTED_DATASETS: ReadonlyArray<{ readonly label: string; readonly table: string }> = [
  { label: '互动', table: 'x_interaction' },
];

/** 账本只回最近这么多天给曲线 —— 多给一天,时区换算时不缺头 */
const SERIES_DAYS = 8;

type CountRow = { n: number };
type FlagRow = { n: number; follows_me: number; i_follow: number; blue: number };
type DupRow = { n: number; rows: number };
type SourceCount = { source?: string; n: number };
type LedgerAgg = { kind: string; source: string; origin?: string; last_at: string; ins: number };
type LedgerRow = { at: string; kind: 'users' | 'tweets'; inserted: number };

/**
 * ⭐ 状态查询的 SQL —— 与解析拆开,离线脚本能用**同一份** SQL 去问真库。
 * ⚠️ 时间一律在 SQL 里转成字符串(SDK 原样给 DateTime 类,过不了 IPC)。
 */
export function buildOpsStatusQuery(account: string): { readonly sql: string; readonly vars: Record<string, string> } {
  if (account === '') throw new Error('[x.ops] 没有号的数字 id —— 关注我/我关注是按号存的');
  const expected = EXPECTED_DATASETS.map((d) =>
    `SELECT count() AS n FROM ${d.table} GROUP ALL;`).join('\n');
  /** ⚠️ 语句顺序 = parseOpsStatus 里的下标,改一边必须改另一边 */
  const sql = `
    SELECT count() AS n, count(follows_me = true) AS follows_me, count(i_follow = true) AS i_follow,
      count(is_blue_verified = true) AS blue FROM ${PEOPLE_WITH_RELATION} GROUP ALL;
    SELECT count() AS n FROM x_tweet GROUP ALL;
    SELECT source, count() AS n FROM x_tweet GROUP BY source;
    SELECT kind, source, origin, <string> time::max(at) AS last_at, math::sum(inserted) AS ins
      FROM x_collect_log GROUP BY kind, source, origin;
    SELECT <string> at AS at, kind, inserted FROM x_collect_log
      WHERE at >= time::now() - ${SERIES_DAYS}d AND origin != 'migration' ORDER BY at;
    SELECT count() AS n, math::sum(n) AS rows FROM
      (SELECT rest_id, count() AS n FROM x_author WHERE rest_id != NONE GROUP BY rest_id)
      WHERE n > 1 GROUP ALL;
    ${expected}
  `;
  return { sql, vars: { acct: account } };
}

/** ⭐ 把上面那串语句的结果拆成 `OpsStatus` —— 下标与 SQL 的语句顺序一一对应 */
export function parseOpsStatus(res: readonly unknown[]): OpsStatus {
  const n = (i: number): number => ((res[i] as CountRow[] | undefined)?.[0]?.n ?? 0);
  const ledger = (res[3] as LedgerAgg[] | undefined) ?? [];
  /**
   * ⚠️ 「采集时间」只看真的采集(live / trace-backfill),不看迁移写的更正记录 ——
   * 否则「采集于」会变成迁移那一刻。对账的合计则**全部都算**(更正正是为了让对账成立)。
   */
  const collected = ledger.filter((r) => r.origin !== 'migration');
  const lastAt = (kind: string, source: string): string | undefined =>
    collected.filter((r) => r.kind === kind && r.source === source).map((r) => r.last_at).sort().at(-1);
  const ledgerSum = (kind: string): number =>
    ledger.filter((r) => r.kind === kind).reduce((s, r) => s + r.ins, 0);
  /** ISO 字符串可直接比大小 —— 取最近一次采人 */
  const usersLastAt = collected.filter((r) => r.kind === 'users').map((r) => r.last_at).sort().at(-1);
  const flags = (res[0] as FlagRow[] | undefined)?.[0];
  const dup = (res[5] as DupRow[] | undefined)?.[0];

  /** 前 6 条固定语句之后,是「还该有的数据」计数 */
  const base = 6;
  return {
    people: {
      total: flags?.n ?? 0,
      ledgerInserted: ledgerSum('users'),
      followsMe: flags?.follows_me ?? 0,
      iFollow: flags?.i_follow ?? 0,
      blue: flags?.blue ?? 0,
      /** 7 个数字 id 各 2 行 → 多出 7 行 */
      renamedExtra: dup ? dup.rows - dup.n : 0,
      lastAt: usersLastAt,
    },
    tweets: {
      total: n(1),
      ledgerInserted: ledgerSum('tweets'),
      sources: ((res[2] as SourceCount[] | undefined) ?? []).map((r) => ({
        /** ⚠️ 没来源的推文如实标出来,不并进别的来源 */
        name: r.source ?? '(无来源)', count: r.n, lastAt: lastAt('tweets', r.source ?? ''),
      })),
    },
    series: (res[4] as LedgerRow[] | undefined) ?? [],
    missing: EXPECTED_DATASETS
      .filter((_, i) => n(base + i) === 0)
      .map((d) => d.label),
  };
}
