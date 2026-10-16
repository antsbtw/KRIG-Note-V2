/**
 * ⭐ 运行黑匣子复盘报告 —— 读 krig-data/health/*.jsonl,一屏看清:
 *   每次运行:起止、怎么结束的、卡过几次(各卡多久)、无响应 / 进程退出
 *   体检趋势:事件循环延迟、主进程内存、各进程内存、各探针里的数字 —— 首 / 中 / 尾三点 + 最大值
 *
 * 用户 2026-10-16:「你自己记录,定期分析」—— 复盘「app 跑久了卡住」先跑这个。
 *
 * 用法:node scripts/health-report.mjs [天数,默认 2]
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const DIR = join(homedir(), 'Library/Application Support/KRIG Note V2/krig-data/health');
const days = Number(process.argv[2] ?? 2);

let files = [];
try { files = readdirSync(DIR).filter((f) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f)).sort().slice(-days); } catch {
  console.error(`⚠️ 读不到 ${DIR} —— app 还没跑过带黑匣子的版本?`); process.exit(1);
}
const events = files.flatMap((f) => readFileSync(join(DIR, f), 'utf8').split('\n').filter(Boolean).flatMap((l) => {
  try { return [JSON.parse(l)]; } catch { return []; }
})).sort((a, b) => a.ts - b.ts);

const t = (ms) => new Date(ms).toLocaleString();
const dur = (ms) => (ms >= 3_600_000 ? `${(ms / 3_600_000).toFixed(1)}h` : ms >= 60_000 ? `${Math.round(ms / 60_000)}min` : `${Math.round(ms / 1000)}s`);

/** 把嵌套对象摊成 a.b.c → 数字,用来看「哪张表在长」 */
function flat(o, prefix = '', out = {}) {
  if (o && typeof o === 'object' && !Array.isArray(o)) {
    for (const [k, v] of Object.entries(o)) flat(v, prefix ? `${prefix}.${k}` : k, out);
  } else if (typeof o === 'number') out[prefix] = o;
  return out;
}

const sessions = [...new Set(events.filter((e) => e.session).map((e) => e.session))];
console.log(`黑匣子 ${DIR}\n文件 ${files.join(', ')} · 共 ${events.length} 条 · ${sessions.length} 次运行\n`);

for (const sid of sessions) {
  const ev = events.filter((e) => e.session === sid);
  const start = ev.find((e) => e.event === 'session-start');
  const end = ev.find((e) => e.event === 'session-end');
  const last = ev[ev.length - 1];
  const hangs = ev.filter((e) => e.event === 'main-hang');
  const recs = ev.filter((e) => e.event === 'main-recovered');
  const unresp = ev.filter((e) => e.event === 'wc-unresponsive');
  const gone = ev.filter((e) => e.event === 'process-gone');
  const lastHang = hangs[hangs.length - 1];
  const killedWhileHung = lastHang && !recs.some((r) => r.ts > lastHang.ts) && !end;
  /** ⚠️ 最近一次运行若还在写(体检 30s 一次),它是「运行中」不是「没正常退出」 */
  const running = !end && sid === sessions[sessions.length - 1] && Date.now() - last.ts < 120_000;
  const how = end ? '✅ 正常退出' : running ? (lastHang && !recs.some((r) => r.ts > lastHang.ts) ? '❌ 运行中,此刻卡着' : '▶ 运行中')
    : killedWhileHung ? '❌ 卡住后被强杀 / 没恢复' : '⚠️ 没有正常退出(崩溃 / 强杀)';
  console.log(`── ${sid}  ${start ? t(start.ts) : '?'} → ${t((end ?? last).ts)}(${dur((end ?? last).ts - (start ?? ev[0]).ts)})  ${how}`);
  for (const h of hangs) {
    const r = recs.find((x) => x.ts > h.ts);
    console.log(`   ⚠️ 主进程卡住 @${t(h.ts)}  ${r ? `卡了 ${dur(r.hungMs)}` : '没恢复'}${h.lastSample ? `  卡前体检: 运行 ${dur(h.lastSample.uptimeSec * 1000)}` : ''}`);
  }
  for (const u of unresp) console.log(`   ⚠️ 无响应 @${t(u.ts)} wc#${u.wcId} ${u.type} ${u.url ?? ''}`);
  for (const g of gone) console.log(`   ⚠️ 进程退出 @${t(g.ts)} ${g.kind} ${g.reason}`);

  const samples = ev.filter((e) => e.event === 'sample');
  if (samples.length === 0) { console.log('   (没有体检记录)'); continue; }
  const rows = samples.map((s) => ({
    ts: s.ts,
    v: { ...flat({ loop: s.loopDelayMs, main: s.mainMemMB, probes: s.probes }),
      'procs.totalMB': (s.procs ?? []).reduce((a, p) => a + (p.memMB ?? 0), 0) },
  }));
  const keys = [...new Set(rows.flatMap((r) => Object.keys(r.v)))].sort();
  const pick = [rows[0], rows[Math.floor(rows.length / 2)], rows[rows.length - 1]];
  console.log(`   体检 ${samples.length} 次 · 列:首(${t(pick[0].ts)}) / 中 / 尾(${t(pick[2].ts)}) / 最大`);
  for (const k of keys) {
    const vals = rows.map((r) => r.v[k]).filter((x) => typeof x === 'number');
    if (vals.length === 0 || vals.every((x) => x === 0)) continue;
    const [a, b, c] = pick.map((r) => r.v[k] ?? '-');
    const grow = typeof a === 'number' && typeof c === 'number' && a > 0 && c / a >= 2 ? '  ⬆ 翻倍以上' : '';
    console.log(`   ${k.padEnd(34)} ${String(a).padStart(7)} ${String(b).padStart(7)} ${String(c).padStart(7)} ${String(Math.max(...vals)).padStart(7)}${grow}`);
  }
}
