#!/usr/bin/env node
/**
 * ⭐⭐ X 网页占用对账 —— 读终端日志里的 `[lock]` 行,回答两个问题:
 *   ① 有没有两个任务同时用同一个 X 网页?
 *   ② 有没有任务占了网页不放?
 * 并列出这段时间谁让给了谁(「拒绝」= 有人在用,另一个让路 —— 这是对的)。
 *
 * 用户 2026-10-23:「你从后台看得到这些操作吗?」—— 人照常用,AI 跑这个自己核对,不叫人去点。
 *
 * 用法:
 *   node scripts/lock-report.mjs                 最近 2 小时
 *   node scripts/lock-report.mjs --since 30m
 *   node scripts/lock-report.mjs --from "2026-10-23 21:00" [--to "2026-10-23 22:00"]
 * 退出码:0 = 没问题;1 = 有问题(✗ 行);2 = 用法 / 找不到日志
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { clock, parseDuration, parseTime, readStream } from './lib/log-query.mjs';
import { auditLocks } from './lib/lock-audit.mjs';

const DIR = join(homedir(), 'Library/Application Support/KRIG Note V2/krig-data/logs');
const argv = process.argv.slice(2);
const opts = {};
for (let i = 0; i < argv.length; i += 2) {
  const k = argv[i]?.replace(/^--/, '');
  if (!['since', 'from', 'to', 'dir'].includes(k) || argv[i + 1] === undefined) { console.error(`⚠️ 用法见文件头:${argv[i]}`); process.exit(2); }
  opts[k] = argv[i + 1];
}
const now = Date.now();
const fromTs = opts.from ? parseTime(opts.from, now) : now - parseDuration(opts.since ?? '2h');
const toTs = opts.to ? parseTime(opts.to, now) : now;
const dir = opts.dir ?? DIR;
if (!existsSync(dir)) { console.error(`⚠️ 找不到日志目录 ${dir}`); process.exit(2); }

const { records } = readStream(dir, 'main', fromTs, toTs);
records.sort((a, b) => a.ts - b.ts);
const lockLines = records.filter((r) => String(r.msg ?? '').trim().startsWith('[lock]'));
const r = auditLocks(records, toTs);

console.log(`X 网页占用对账 ${clock(fromTs)} → ${clock(toTs)} · [lock] 日志 ${lockLines.length} 行`);
if (lockLines.length === 0) {
  console.log('这段时间没有任何占用记录 —— 要么没人用网页,要么 app 跑的是没加留痕的旧代码(改了主进程要重启 app)。');
  process.exit(0);
}

console.log(`\n── 用过网页的 ${r.spans.length} 次 ──`);
for (const s of r.spans) console.log(`  ${s.from ? clock(s.from) : '(窗口前)'} → ${clock(s.to)}  ${s.res}  「${s.purpose}」(${s.caller}) ${s.sec} 秒`);
for (const o of r.open) console.log(`  进行中  ${o.res}  「${o.purpose}」(${o.caller}) 已 ${o.sec} 秒`);

console.log(`\n── 让路 ${r.refusals.length} 次(有人在用,另一个没去抢 —— 这是对的)──`);
for (const x of r.refusals) console.log(`  ${clock(x.ts)}  「${x.purpose}」(${x.caller}) 让给 「${x.byPurpose}」(${x.byCaller},已用 ${x.sec} 秒)`);

if (r.notes.length > 0) {
  console.log('\n── 备注 ──');
  for (const n of r.notes) console.log(`  · ${n}`);
}

console.log('\n── 结论 ──');
if (r.problems.length === 0) {
  console.log('  ✓ 没有两个任务同时用同一个网页;用完的都放了');
  process.exit(0);
}
for (const p of r.problems) console.log(`  ${p}`);
process.exit(1);
