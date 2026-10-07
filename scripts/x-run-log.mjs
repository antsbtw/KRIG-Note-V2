/**
 * ⭐ 读最近一跑的账 —— **不靠截图,直接读落盘的那份**。
 *
 * 用法:node scripts/x-run-log.mjs [第几份,默认 1=最新]
 *
 * ⚠️ 用户 2026-10-06:「这两个你没有办法自行读取吗?」
 * ⭐ 现在可以了:面板每跑都写一份 `x-run-*.txt`,这个脚本把它打出来。
 * 判据=「下次验证能不能不靠人、只靠留下的东西说清楚」。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const DIR = join(homedir(), 'Library/Application Support/KRIG Note V2/krig-data/x-audit');
const nth = Math.max(1, Number(process.argv[2] ?? 1));

let files;
try {
  files = readdirSync(DIR)
    .filter((f) => f.startsWith('x-run-'))
    .map((f) => ({ f, t: statSync(join(DIR, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
} catch (e) {
  console.error(`⚠️ 读不到留痕目录:${DIR}\n   ${e.message}`);
  process.exit(1);
}

if (files.length === 0) {
  /** ⚠️ fail loud:说清楚**人该做什么**,不是报一句「没有文件」 */
  console.error('⚠️ 还没有任何一跑的账 —— 在 X Console 点一次「采这一页」就会生成');
  process.exit(1);
}
if (nth > files.length) {
  console.error(`⚠️ 只有 ${files.length} 份账,要不到第 ${nth} 份`);
  process.exit(1);
}

const pick = files[nth - 1];
console.log(`（第 ${nth}/${files.length} 份：${pick.f}）\n`);
console.log(readFileSync(join(DIR, pick.f), 'utf8'));
