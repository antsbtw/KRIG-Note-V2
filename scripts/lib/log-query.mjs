/**
 * 诊断日志的读取 / 筛选 / 排版 —— 纯函数,`scripts/logs.mjs` 与单测共用
 *
 * 落盘格式见 `src/platform/main/diagnostics/logs/log-file.ts`:
 *   <dir>/main/YYYY-MM-DD.jsonl  主进程 console(终端)
 *   <dir>/page/YYYY-MM-DD.jsonl  每个 webContents 的 DevTools 日志
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const UNIT = { s: 1e3, m: 6e4, h: 3.6e6, d: 8.64e7 };

/** `30s` / `10m` / `2h` / `1d` → 毫秒。⚠️ 认不出就抛,不默默当成「全部」 */
export function parseDuration(v) {
  const m = /^(\d+)([smhd])$/.exec(String(v ?? '').trim());
  if (!m) throw new Error(`认不出时长「${v}」—— 要 30s / 10m / 2h / 1d 这种写法`);
  return Number(m[1]) * UNIT[m[2]];
}

/**
 * 时刻 → 毫秒。认:毫秒数 / ISO(`2026-10-19T14:30:00Z`)/ 本地 `2026-10-19 14:30[:ss]` / 本地今天 `14:30[:ss]`。
 * ⚠️ 认不出就抛。
 */
export function parseTime(v, now = Date.now()) {
  const s = String(v ?? '').trim();
  if (/^\d{12,}$/.test(s)) return Number(s);
  const hm = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(s);
  if (hm) {
    const d = new Date(now);
    d.setHours(Number(hm[1]), Number(hm[2]), Number(hm[3] ?? 0), 0);
    return d.getTime();
  }
  const t = Date.parse(s.includes('T') || s.endsWith('Z') ? s : s.replace(' ', 'T'));
  if (Number.isNaN(t)) throw new Error(`认不出时刻「${v}」—— 要 14:30 / 2026-10-19 14:30 / ISO / 毫秒数`);
  return t;
}

const day = (ts) => new Date(ts).toISOString().slice(0, 10);

/**
 * 读一条流在 [fromTs, toTs] 内的记录。**坏行跳过并计数**(被强杀时最后一行可能只写了一半)。
 * @returns {{ records: object[], badLines: number, files: string[] }}
 */
export function readStream(dir, stream, fromTs, toTs) {
  const sdir = join(dir, stream);
  if (!existsSync(sdir)) return { records: [], badLines: 0, files: [] };
  const lo = day(fromTs);
  const hi = day(toTs);
  const files = readdirSync(sdir).filter((n) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(n) && n.slice(0, 10) >= lo && n.slice(0, 10) <= hi).sort();
  const records = [];
  let badLines = 0;
  for (const f of files) {
    for (const line of readFileSync(join(sdir, f), 'utf8').split('\n')) {
      if (!line.trim()) continue;
      let r;
      try { r = JSON.parse(line); } catch { badLines += 1; continue; }
      if (typeof r.ts !== 'number') { badLines += 1; continue; }
      if (r.ts < fromTs || r.ts > toTs) continue;
      records.push({ stream, ...r });
    }
  }
  return { records, badLines, files };
}

const RANK = { debug: 0, info: 1, warning: 2, error: 3 };
const LEVEL_ALIAS = { warn: 'warning', err: 'error', log: 'info' };

export function normLevel(v) {
  const l = LEVEL_ALIAS[v] ?? v;
  if (!(l in RANK)) throw new Error(`认不出级别「${v}」—— 要 debug / info / warn / error`);
  return l;
}

/**
 * 筛选。所有条件同时满足(AND)。
 * @param {object} q { level?: 最低级别, page?: pageId(前缀), wc?: number, url?: 子串, grep?: RegExp, kind?: string[], run?: 前缀 }
 */
export function filterRecords(records, q = {}) {
  const min = q.level ? RANK[normLevel(q.level)] : -1;
  return records.filter((r) => {
    if (min >= 0 && (RANK[r.level] ?? 1) < min) return false;
    if (q.page && !(typeof r.pageId === 'string' && r.pageId.startsWith(q.page))) return false;
    if (q.wc !== undefined && r.wc !== q.wc) return false;
    if (q.url && !(typeof r.url === 'string' && r.url.includes(q.url))) return false;
    if (q.kind && q.kind.length > 0 && !q.kind.includes(r.kind ?? 'console')) return false;
    if (q.run && !(typeof r.run === 'string' && r.run.startsWith(q.run))) return false;
    if (q.grep) {
      const hay = `${r.msg ?? ''} ${r.url ?? ''} ${r.src ?? ''}`;
      if (!q.grep.test(hay)) return false;
    }
    return true;
  });
}

const pad = (n, w = 2) => String(n).padStart(w, '0');
export function clock(ts) {
  const d = new Date(ts);
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}
// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;]*m/g;
const LV = { debug: 'DBG', info: 'INF', warning: 'WRN', error: 'ERR' };

function shortUrl(u) {
  if (!u) return '';
  try {
    const x = new URL(u);
    const s = `${x.host}${x.pathname}${x.search}`;
    return s.length > 70 ? `${s.slice(0, 67)}...` : s;
  } catch {
    return u.length > 70 ? `${u.slice(0, 67)}...` : u;
  }
}

/** 一条记录排成一行(多行消息保留换行并缩进) */
export function formatRecord(r) {
  const lv = LV[r.level] ?? '???';
  let where;
  if (r.stream === 'main') where = 'main';
  else if (r.stream === 'trace') where = `trace:${r.traceStream}`;
  else where = `wc#${r.wc}${r.type && r.type !== 'webview' ? `(${r.type})` : ''}${r.pageId ? ` ${r.pageId}` : ''} ${shortUrl(r.url)}`;
  const kind = r.kind && r.kind !== 'console' ? `[${r.kind}] ` : '';
  const src = r.src ? `  (${shortUrl(r.src)}:${r.line ?? '?'})` : '';
  const trunc = r.truncated ? `  …截断,原长 ${r.truncated}` : '';
  // 子进程(SurrealDB 等)的输出带 ANSI 颜色码:文件里如实保留,只在显示时去掉
  const msg = String(r.msg ?? '').replace(ANSI, '').replace(/\n/g, '\n      ');
  return `${clock(r.ts)} ${lv} ${where} | ${kind}${msg}${src}${trunc}`;
}

/** 按页面汇总:每个 wc 的 url / pageId / 各级别条数 / 时间范围 */
export function summarizePages(records) {
  const by = new Map();
  for (const r of records) {
    if (r.stream !== 'page') continue;
    const key = `${r.run}#${r.wc}`;
    let s = by.get(key);
    if (!s) {
      s = { run: r.run, wc: r.wc, type: r.type, pageIds: new Set(), urls: new Set(), counts: {}, first: r.ts, last: r.ts };
      by.set(key, s);
    }
    if (r.pageId) s.pageIds.add(r.pageId);
    if (r.url) s.urls.add(shortUrl(r.url));
    s.counts[r.level] = (s.counts[r.level] ?? 0) + 1;
    s.last = Math.max(s.last, r.ts);
    s.first = Math.min(s.first, r.ts);
  }
  return [...by.values()].sort((a, b) => a.first - b.first);
}
