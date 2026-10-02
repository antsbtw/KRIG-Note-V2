#!/usr/bin/env node
/**
 * 读 web-capability 的落盘留痕 —— ⭐ 让验证**不靠人截图**
 *
 * ── 用户 2026-10-02 ──
 * 「你在底层有读取数据的能力，而不是靠我截图，否则效率会差很多。」
 *
 * ⚠️ 这正是 `feedback-maintainability-over-feature-completion` 那条:
 * X 采集面板的判断依据「只渲染一次关掉就没」,核对只能反过来要用户截图 ——
 * 被点破「**你不记录如何做验证**」。
 *
 * 用法:
 *   node scripts/web-trace.mjs              最近 30 条(全部流)
 *   node scripts/web-trace.mjs capture      只看载荷捕获那几条
 *   node scripts/web-trace.mjs --since 10m  最近 10 分钟
 *   node scripts/web-trace.mjs --raw        原样 JSON(不美化)
 */

import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

/**
 * ⚠️ 与 `runtime.ts` 的 `traceRoot()` 必须一致。
 * ⭐ 两个候选都试:生产走 userData,单测/非 Electron 走 TMPDIR。
 */
const ROOTS = [
  join(homedir(), 'Library/Application Support/KRIG Note V2/krig-data/web-trace'),
  join(process.env.TMPDIR ?? '/tmp', 'krig-web-trace'),
];

const args = process.argv.slice(2);
const raw = args.includes('--raw');
const sinceArg = (() => {
  const i = args.indexOf('--since');
  return i >= 0 ? args[i + 1] : null;
})();
const filter = args.find((a) => !a.startsWith('--') && a !== sinceArg) ?? null;

/** `10m` / `2h` / `30s` → 毫秒。⚠️ 认不出就**如实报错**,不默默当成「全部」 */
function parseSince(v) {
  if (!v) return null;
  const m = /^(\d+)([smhd])$/.exec(v.trim());
  if (!m) {
    console.error(`⚠️ --since 认不出「${v}」—— 要 10m / 2h / 30s / 1d 这种写法`);
    process.exit(2);
  }
  const mult = { s: 1e3, m: 6e4, h: 3.6e6, d: 8.64e7 }[m[2]];
  return Date.now() - Number(m[1]) * mult;
}
const sinceTs = parseSince(sinceArg);

const root = ROOTS.find((r) => existsSync(r));
if (!root) {
  // ⚠️ 如实说没有,并把找过的地方列出来 —— 别让人猜是「没数据」还是「找错地方」
  console.error('⚠️ 找不到留痕目录。找过:');
  for (const r of ROOTS) console.error(`   ${r}`);
  console.error('\n可能是 app 从没跑过,或 userData 路径变了(对照 runtime.ts 的 traceRoot())');
  process.exit(1);
}

const records = [];
for (const stream of readdirSync(root)) {
  const dir = join(root, stream);
  if (!statSync(dir).isDirectory()) continue;
  for (const shard of readdirSync(dir)) {
    const text = readFileSync(join(dir, shard), 'utf-8');
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try {
        records.push({ stream, ...JSON.parse(line) });
      } catch {
        // ⚠️ 坏行**不静默跳过** —— 留痕本身坏了是要知道的
        records.push({ stream, ts: 0, event: '(坏行)', _bad: line.slice(0, 120) });
      }
    }
  }
}

let out = records.sort((a, b) => a.ts - b.ts);
if (sinceTs) out = out.filter((r) => r.ts >= sinceTs);
if (filter) {
  const re = new RegExp(filter, 'i');
  out = out.filter((r) => re.test(JSON.stringify(r)));
}

if (out.length === 0) {
  console.log('（没有匹配的留痕）');
  console.log(`  目录 ${root}`);
  console.log(`  共 ${records.length} 条，筛选后 0 条`
    + (sinceTs ? `（--since ${sinceArg}）` : '')
    + (filter ? `（关键词 ${filter}）` : ''));
  process.exit(0);
}

const tail = out.slice(-30);
if (raw) {
  for (const r of tail) console.log(JSON.stringify(r));
} else {
  for (const r of tail) {
    const t = new Date(r.ts).toLocaleString('zh-CN', { hour12: false });
    /**
     * ⚠️ 三个流的字段**不一样**(lifecycle 有 event/detail、
     * degradation 有 operation/category/reason/inputRef/rawSnippet)——
     * 只按 lifecycle 的形状打印,degradation 会丢掉最要紧的 category 和 reason。
     * ⭐ 「记了但读不好」与没记差不多。
     */
    const title = r.event ?? r.operation ?? '(无事件名)';
    console.log(`${t}  [${r.stream}] ${r.layer ?? '-'} ${title}`);
    if (r.category) console.log(`    category = ${r.category}`);
    if (r.reason) console.log(`    reason = ${r.reason}`);
    if (r.pageId ?? r.inputRef) console.log(`    pageId = ${r.pageId ?? r.inputRef}`);
    if (r.rawSnippet) console.log(`    url = ${r.rawSnippet}`);
    if (r.detail) {
      for (const [k, v] of Object.entries(r.detail)) {
        if (v === undefined) continue;   // ⚠️ 没取到的字段不显示,免得像「值是 undefined」
        console.log(`    ${k} = ${typeof v === 'string' ? v : JSON.stringify(v)}`);
      }
    }
    if (r._bad) console.log(`    ⚠️ 坏行: ${r._bad}`);
  }
}
console.log(`\n—— 共 ${records.length} 条，显示最后 ${tail.length} 条（目录 ${root}）`);
