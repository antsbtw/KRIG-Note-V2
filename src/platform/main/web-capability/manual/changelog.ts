/**
 * ⭐⭐ 说明书修改档案(设计 §9,P2 2026-10-19)—— 纯函数
 *
 * 用户 10-19:「留档/列表,方便回溯,定期归档。」· 归档周期用户 10-19 选「按月归档」。
 *
 * 一份说明书的目录长这样(站点无关):
 *   <site>.manual.json      当前版本
 *   history/v0001.json      每个版本一份快照 —— 回滚的来源
 *   changes.json            主列表:本月的修改 + 「修不好、举手」的(不管多旧都留着置顶)
 *   archive/YYYY-MM.json    按月归档,归档后仍可查、可回滚
 *
 * 命令行:`node scripts/manual.mjs`(list / show / diff / check / record / rollback / archive)。
 */
import type { SiteManual } from './types';

/** 谁改的 */
export type ChangeBy = 'human' | 'claude-code' | 'local-ai' | 'cloud-ai';

export type ManualChange = {
  readonly version: number;
  /** ISO 时间 */
  readonly at: string;
  readonly by: ChangeBy;
  /** 一句话:改了什么 */
  readonly summary: string;
  /** 为什么改 */
  readonly reason: string;
  /** 依据:诊断包 / 样本目录 / 报告文件 */
  readonly evidence: readonly string[];
  /** 回归结果:修好几个 / 弄坏几个 + 说明 */
  readonly regression: { readonly fixed: number; readonly broken: number; readonly detail: string };
  /** 是否用过云端、发了什么(设计 §6.4) */
  readonly cloud: { readonly used: boolean; readonly sent?: string };
  /** 与上一版的逐项对比(由工具算,不手写) */
  readonly diff: readonly ManualDiff[];
  /** ok · raised = 修不好、举手给人 · 回滚产生的那条记 rollbackOf */
  readonly status: 'ok' | 'raised';
  readonly rollbackOf?: number;
};

export type ManualDiff = { readonly path: string; readonly before?: unknown; readonly after?: unknown };

export type ChangeList = { readonly site: string; readonly entries: readonly ManualChange[] };
export type ChangeArchive = { readonly site: string; readonly month: string; readonly entries: readonly ManualChange[] };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * 逐项对比两版(深比;数组按下标)。`version` 字段本身不算改动。
 * 路径写法 `data.census.rules[1].hidden` —— 人和 AI 都看得懂。
 */
export function diffManual(before: unknown, after: unknown, path = ''): ManualDiff[] {
  if (path === 'version') return [];
  if (Array.isArray(before) && Array.isArray(after)) {
    const out: ManualDiff[] = [];
    for (let i = 0; i < Math.max(before.length, after.length); i += 1) {
      const p = `${path}[${i}]`;
      if (i >= before.length) out.push({ path: p, after: after[i] });
      else if (i >= after.length) out.push({ path: p, before: before[i] });
      else out.push(...diffManual(before[i], after[i], p));
    }
    return out;
  }
  if (isObj(before) && isObj(after)) {
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])];
    return keys.flatMap((k) => {
      const p = path === '' ? k : `${path}.${k}`;
      if (!(k in before)) return p === 'version' ? [] : [{ path: p, after: after[k] }];
      if (!(k in after)) return p === 'version' ? [] : [{ path: p, before: before[k] }];
      return diffManual(before[k], after[k], p);
    });
  }
  return JSON.stringify(before) === JSON.stringify(after) ? [] : [{ path: path || '(整份)', before, after }];
}

const BY: readonly ChangeBy[] = ['human', 'claude-code', 'local-ai', 'cloud-ai'];

export function checkChange(c: unknown, where: string): string[] {
  const out: string[] = [];
  if (!isObj(c)) return [`${where}:要是对象`];
  const s = (k: string): boolean => typeof c[k] === 'string' && c[k] !== '';
  if (!Number.isInteger(c.version) || (c.version as number) < 1) out.push(`${where}.version:要 ≥1 的整数`);
  if (!s('at') || Number.isNaN(Date.parse(c.at as string))) out.push(`${where}.at:要 ISO 时间`);
  if (!BY.includes(c.by as ChangeBy)) out.push(`${where}.by:只认 ${BY.join(' / ')}`);
  if (!s('summary')) out.push(`${where}.summary:要写改了什么`);
  if (!s('reason')) out.push(`${where}.reason:要写为什么改`);
  if (!Array.isArray(c.evidence)) out.push(`${where}.evidence:要是数组`);
  const r = c.regression;
  if (!isObj(r) || !Number.isInteger(r.fixed) || !Number.isInteger(r.broken) || typeof r.detail !== 'string') out.push(`${where}.regression:要 {fixed, broken, detail}`);
  if (!isObj(c.cloud) || typeof c.cloud.used !== 'boolean') out.push(`${where}.cloud:要 {used, sent?}`);
  else if (c.cloud.used && (typeof c.cloud.sent !== 'string' || c.cloud.sent === '')) out.push(`${where}.cloud.sent:用过云端就要写发了什么`);
  if (!Array.isArray(c.diff)) out.push(`${where}.diff:要是数组`);
  if (c.status !== 'ok' && c.status !== 'raised') out.push(`${where}.status:只认 ok / raised`);
  return out;
}

/** 本地时间的年月 `YYYY-MM` —— 用户眼里的「这个月」 */
export function monthOf(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * ⭐ 按月归档:主列表只留本月的 + 举手的;更早的按月分组交出去。
 * 已有的归档要合并进来(同一个月分两次归也不丢)。
 */
export function archiveByMonth(
  main: readonly ManualChange[], now: Date,
): { readonly keep: readonly ManualChange[]; readonly byMonth: Readonly<Record<string, readonly ManualChange[]>> } {
  const thisMonth = monthOf(now.toISOString());
  const keep: ManualChange[] = [];
  const byMonth: Record<string, ManualChange[]> = {};
  for (const c of main) {
    const m = monthOf(c.at);
    if (c.status === 'raised' || m >= thisMonth) keep.push(c);
    else (byMonth[m] ??= []).push(c);
  }
  return { keep, byMonth };
}

/** 一个月归档的一行摘要 */
export function summarizeEntries(entries: readonly ManualChange[]): { readonly count: number; readonly fixed: number; readonly broken: number; readonly versions: string } {
  const vs = entries.map((e) => e.version).sort((a, b) => a - b);
  return {
    count: entries.length,
    fixed: entries.reduce((n, e) => n + e.regression.fixed, 0),
    broken: entries.reduce((n, e) => n + e.regression.broken, 0),
    versions: vs.length === 0 ? '' : vs.length === 1 ? `v${vs[0]}` : `v${vs[0]}–v${vs[vs.length - 1]}`,
  };
}

/** 历史快照的文件名 */
export const historyFile = (v: number): string => `v${String(v).padStart(4, '0')}.json`;

/**
 * ⭐⭐ 整份档案自检 —— 当前版 = 最新快照;版本连续;每版恰好一条记录;记录里的对比与快照重算一致(不许手改)。
 */
export function checkArchive(input: {
  readonly manual: SiteManual;
  readonly history: Readonly<Record<number, unknown>>;
  readonly main: ChangeList;
  readonly archives: readonly ChangeArchive[];
}): string[] {
  const out: string[] = [];
  const { manual, history } = input;
  const versions = Object.keys(history).map(Number).sort((a, b) => a - b);
  versions.forEach((v, i) => { if (v !== i + 1) out.push(`history:版本不连续,第 ${i + 1} 个是 v${v}`); });
  const latest = versions[versions.length - 1];
  if (latest !== manual.version) out.push(`当前版本 v${manual.version},最新快照 v${latest} —— 改了说明书没记档(跑 scripts/manual.ts record)`);
  else if (JSON.stringify(history[latest]) !== JSON.stringify(manual)) out.push(`当前说明书与快照 v${latest} 内容不同 —— 改了没升版本 / 没记档`);
  for (const v of versions) {
    const h = history[v];
    if (!isObj(h) || h.version !== v) out.push(`history v${v}:快照里的 version 不是 ${v}`);
  }
  const all: { e: ManualChange; where: string }[] = [
    ...input.main.entries.map((e, i) => ({ e, where: `changes[${i}]` })),
    ...input.archives.flatMap((a) => a.entries.map((e, i) => ({ e, where: `archive/${a.month}[${i}]` }))),
  ];
  for (const a of input.archives) {
    if (a.site !== manual.site) out.push(`archive/${a.month}:site 是 ${a.site}`);
    for (const e of a.entries) if (monthOf(e.at) !== a.month) out.push(`archive/${a.month}:v${e.version} 是 ${monthOf(e.at)} 的,放错月了`);
    if (a.entries.some((e) => e.status === 'raised')) out.push(`archive/${a.month}:举手的条目不该归档,要留在主列表置顶`);
  }
  if (input.main.site !== manual.site) out.push(`changes.json:site 是 ${input.main.site}`);
  for (const { e, where } of all) out.push(...checkChange(e, where));
  for (const v of versions) {
    const hits = all.filter(({ e }) => e.version === v);
    if (hits.length !== 1) { out.push(`v${v}:档案里有 ${hits.length} 条记录,要恰好 1 条`); continue; }
    const expect = v === 1 ? diffManual({}, history[1]) : diffManual(history[v - 1], history[v]);
    if (JSON.stringify(hits[0].e.diff) !== JSON.stringify(expect)) out.push(`${hits[0].where}:记录里的对比与快照 v${v - 1}→v${v} 重算的不一致(不许手改)`);
  }
  for (const { e, where } of all) if (!versions.includes(e.version)) out.push(`${where}:v${e.version} 没有快照`);
  return out;
}
