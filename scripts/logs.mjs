#!/usr/bin/env node
/**
 * ⭐⭐ 读诊断日志 —— 终端(主进程 console)+ 每个网页的 DevTools 日志,一条时间线
 *
 * 用户 2026-10-19:「AI必须有能力执行日常的诊断方式-- terminal log/devtools log」
 * → 出问题时**先跑这个**,不要先问用户要截图 / 终端输出。
 * 写入端:`src/platform/main/diagnostics/logs/`;设计 `04-site-manual-self-repair.md` §5。
 *
 * 用法(条件可叠加,都是 AND):
 *   node scripts/logs.mjs                       最近 30 分钟、两条流、末尾 200 条
 *   node scripts/logs.mjs --since 2h            最近 2 小时
 *   node scripts/logs.mjs --around 14:32 --window 3m   某一刻前后各 3 分钟(本地时间)
 *   node scripts/logs.mjs --from "2026-10-19 14:00" --to "2026-10-19 14:10"
 *   node scripts/logs.mjs --src page            只看网页(main / page / all)
 *   node scripts/logs.mjs --level warn          只看 warning 及以上
 *   node scripts/logs.mjs --page page_3         按能力层 pageId(前缀)
 *   node scripts/logs.mjs --wc 12               按 webContents id
 *   node scripts/logs.mjs --url x.com           按 URL 子串
 *   node scripts/logs.mjs --grep "429|cursor"   正则,不分大小写(匹配 msg / url / 脚本来源)
 *   node scripts/logs.mjs --kind load-fail,gone 按类别(console/load-fail/preload/gone/unresponsive/nav/dropped)
 *   node scripts/logs.mjs --run 2026-10-19T06    按运行(前缀;--runs 列出)
 *   node scripts/logs.mjs --trace               并入能力层留痕(web-trace 的 lifecycle + degradation)
 *   node scripts/logs.mjs --pages               不列明细,按页面汇总(哪个 wc 是哪个网页、各级别多少条)
 *   node scripts/logs.mjs --runs                列出时间窗内的每次运行(起止、条数)
 *   node scripts/logs.mjs --limit 1000 | --all  条数(默认末尾 200)
 *   node scripts/logs.mjs --json                原样 JSON 行
 *   node scripts/logs.mjs --dir <path>          换目录(默认 userData/krig-data/logs)
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import {
  clock, filterRecords, formatRecord, normLevel, parseDuration, parseTime, readStream, summarizePages,
} from './lib/log-query.mjs';

const DATA = join(homedir(), 'Library/Application Support/KRIG Note V2/krig-data');

const argv = process.argv.slice(2);
const flags = new Set();
const opts = {};
for (let i = 0; i < argv.length; i += 1) {
  const a = argv[i];
  if (!a.startsWith('--')) { fail(`多余的参数「${a}」(--help 看用法)`); }
  const k = a.slice(2);
  if (['trace', 'pages', 'runs', 'json', 'all', 'help'].includes(k)) { flags.add(k); continue; }
  const v = argv[i + 1];
  if (v === undefined || v.startsWith('--')) fail(`--${k} 缺值`);
  opts[k] = v;
  i += 1;
}

function fail(msg) {
  console.error(`⚠️ ${msg}`);
  process.exit(2);
}

if (flags.has('help')) {
  const src = (await import('node:fs')).readFileSync(new URL(import.meta.url), 'utf8');
  console.log(src.slice(src.indexOf('用法'), src.indexOf('*/')).replace(/^ \* ?/gm, ''));
  process.exit(0);
}

const known = ['since', 'around', 'window', 'from', 'to', 'src', 'level', 'page', 'wc', 'url', 'grep', 'kind', 'run', 'limit', 'dir'];
for (const k of Object.keys(opts)) if (!known.includes(k)) fail(`认不出参数 --${k}(--help 看用法)`);

let fromTs;
let toTs;
try {
  const now = Date.now();
  if (opts.around) {
    const at = parseTime(opts.around, now);
    const w = parseDuration(opts.window ?? '2m');
    fromTs = at - w;
    toTs = at + w;
  } else if (opts.from) {
    fromTs = parseTime(opts.from, now);
    toTs = opts.to ? parseTime(opts.to, now) : now;
  } else {
    fromTs = now - parseDuration(opts.since ?? '30m');
    toTs = now;
  }
  if (opts.level) normLevel(opts.level);
} catch (e) {
  fail(e.message);
}

const dir = opts.dir ?? join(DATA, 'logs');
if (!existsSync(dir)) {
  fail(`找不到日志目录 ${dir} —— app 还没跑过带诊断日志的版本?(改 main 必须重启 app)`);
}
const src = opts.src ?? 'all';
if (!['main', 'page', 'all'].includes(src)) fail(`--src 只认 main / page / all,不认「${src}」`);

let records = [];
let badLines = 0;
const filesRead = [];
for (const s of src === 'all' ? ['main', 'page'] : [src]) {
  const r = readStream(dir, s, fromTs, toTs);
  records.push(...r.records);
  badLines += r.badLines;
  filesRead.push(...r.files.map((f) => `${s}/${f}`));
}

if (flags.has('trace')) {
  const traceDir = join(DATA, 'web-trace');
  for (const t of ['lifecycle', 'degradation']) {
    const r = readStream(traceDir, t, fromTs, toTs);
    badLines += r.badLines;
    filesRead.push(...r.files.map((f) => `web-trace/${t}/${f}`));
    for (const x of r.records) {
      records.push({
        ...x, stream: 'trace', traceStream: t,
        level: t === 'degradation' ? 'error' : 'info',
        kind: t === 'degradation' ? x.operation : x.event,
        msg: t === 'degradation'
          ? `${x.layer} ${x.operation} ${x.category}: ${x.reason}${x.inputRef ? ` (${x.inputRef})` : ''}`
          : `${x.layer} ${x.event}${x.detail?.url ? ` ${x.detail.url}` : ''}${x.detail?.service ? ` [${x.detail.service}]` : ''}`,
      });
    }
  }
}

let grep;
try {
  grep = opts.grep ? new RegExp(opts.grep, 'i') : undefined;
} catch (e) {
  fail(`--grep 不是合法正则:${e.message}`);
}
const wc = opts.wc !== undefined ? Number(opts.wc) : undefined;
if (wc !== undefined && !Number.isInteger(wc)) fail(`--wc 要整数,不认「${opts.wc}」`);

const matched = filterRecords(records, {
  level: opts.level, page: opts.page, wc, url: opts.url, grep, run: opts.run,
  kind: opts.kind ? opts.kind.split(',').map((s) => s.trim()).filter(Boolean) : undefined,
}).sort((a, b) => a.ts - b.ts);

console.log(`日志 ${dir}`);
console.log(`时间窗 ${clock(fromTs)} → ${clock(toTs)} · 读了 ${filesRead.length} 个文件 · 共 ${records.length} 条,命中 ${matched.length} 条${badLines ? ` · ⚠️ 坏行 ${badLines}(多半是被强杀时写了一半)` : ''}`);
const droppedLines = matched.filter((r) => r.kind === 'dropped');
if (droppedLines.length > 0) {
  console.log(`⚠️ 时间窗内有限流丢弃:${droppedLines.reduce((n, r) => n + (r.count ?? 0), 0)} 条网页 console 没落盘(见 [dropped] 行)`);
}
console.log('');

if (flags.has('runs')) {
  const runs = new Map();
  for (const r of records) {
    if (!r.run) continue;
    const s = runs.get(r.run) ?? { first: r.ts, last: r.ts, main: 0, page: 0, err: 0 };
    s.first = Math.min(s.first, r.ts);
    s.last = Math.max(s.last, r.ts);
    s[r.stream] = (s[r.stream] ?? 0) + 1;
    if (r.level === 'error') s.err += 1;
    runs.set(r.run, s);
  }
  for (const [run, s] of [...runs].sort((a, b) => a[1].first - b[1].first)) {
    console.log(`${run}  ${clock(s.first)} → ${clock(s.last)}  终端 ${s.main} · 网页 ${s.page} · error ${s.err}`);
  }
  process.exit(0);
}

if (flags.has('pages')) {
  for (const s of summarizePages(matched)) {
    const c = Object.entries(s.counts).map(([k, n]) => `${k} ${n}`).join(' · ');
    console.log(`wc#${s.wc} ${s.type ?? ''}${s.pageIds.size ? `  pageId ${[...s.pageIds].join(',')}` : ''}  ${clock(s.first)} → ${clock(s.last)}  ${c}`);
    for (const u of [...s.urls].slice(-5)) console.log(`     ${u}`);
  }
  process.exit(0);
}

const limit = flags.has('all') ? Infinity : Number(opts.limit ?? 200);
if (!(limit > 0)) fail(`--limit 要正数,不认「${opts.limit}」`);
const shown = matched.slice(-limit);
if (shown.length < matched.length) console.log(`(只列末尾 ${shown.length} 条,前面还有 ${matched.length - shown.length} 条;--limit / --all 看更多)\n`);
for (const r of shown) console.log(flags.has('json') ? JSON.stringify(r) : formatRecord(r));
