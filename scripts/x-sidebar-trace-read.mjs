#!/usr/bin/env node
/**
 * 读 X 侧栏追踪日志,按时间轴打印状态变化。
 *   node scripts/x-sidebar-trace-read.mjs          # 最近一次会话
 *   node scripts/x-sidebar-trace-read.mjs --all    # 全部
 */
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const F = path.join(os.homedir(),
  'Library/Application Support/KRIG Note V2/krig-data/x-sidebar-trace.log');
if (!existsSync(F)) { console.log('还没有追踪文件 —— app 跑过一次才会生成:\n  ' + F); process.exit(0); }

let lines = readFileSync(F, 'utf-8').trim().split('\n').filter(Boolean);
if (!process.argv.includes('--all')) {
  const starts = lines.map((l, i) => (l.includes('[SESSION]') ? i : -1)).filter((i) => i >= 0);
  if (starts.length) lines = lines.slice(starts[starts.length - 1]);
}

const t0 = (() => { const m = lines[0]?.match(/^(\S+)/); return m ? Date.parse(m[1]) : 0; })();
console.log(`共 ${lines.length} 条\n`);
console.log('  +秒    类型      状态   navW  视口宽  说明');
console.log('  ' + '─'.repeat(74));
for (const l of lines) {
  const m = l.match(/^(\S+) \[(\w+)\] (.*)$/);
  if (!m) { console.log('  ' + l); continue; }
  const [, ts, tag, rest] = m;
  const dt = ((Date.parse(ts) - t0) / 1000).toFixed(1).padStart(6);
  if (tag === 'SESSION') { console.log('\n' + rest + '\n'); continue; }
  let d = {};
  try { d = JSON.parse(rest); } catch { console.log(`  ${dt}  ${tag.padEnd(9)} ${rest}`); continue; }
  const state = (d.状态 ?? '').padEnd(4);
  const navW = String(d.navW ?? '').padStart(5);
  const w = String(d.innerWidth ?? d.w ?? '').padStart(6);
  const note = d.reason ?? d.event ?? d.action ?? (d.opened != null ? (d.opened ? 'DevTools 打开' : 'DevTools 关闭') : '') ?? '';
  const flag = tag === 'devtools' ? '  ⚠️ ' : '';
  console.log(`  ${dt}  ${tag.padEnd(9)} ${state} ${navW} ${w}  ${flag}${note}`);
}
console.log('\n判读:navW>200=展开, ~88-190=收起。看 devtools 那行前后 navW 有没有跳变。');
