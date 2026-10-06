/**
 * ⭐⭐⭐ **跑着的构建,包含我最近那次改动了吗** —— 2026-10-06
 *
 * ⚠️⚠️ 为什么要这个脚本:
 * 「页=轮次」那次修复提交在 14:26,而 app 跑的构建是 14:13 ——
 * **早 13 分钟**。于是用户看到的停因还是旧算法,
 * 而输入框标签却已经是新的(renderer 热更了、main 没有),
 * 两者并排摆着,看上去像「改了但没生效」。
 *
 * ⭐ 留痕里的构建戳只会在「超过 30 分钟」时报警,
 * 而这次只差 13 分钟 —— **够新,但仍然是旧的**。
 * 判据不该是「构建多久以前」,而是「**构建晚于我最后一次改动吗**」。
 *
 * 用法:node scripts/x-build-fresh.mjs
 */
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

const BUILD_DIR = '.vite/build';

let bundle;
try {
  bundle = readdirSync(BUILD_DIR)
    .filter((f) => /^index-.*\.js$/.test(f))
    .map((f) => ({ f, t: statSync(join(BUILD_DIR, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t)[0];
} catch (e) {
  console.error(`⚠️ 读不到构建目录 ${BUILD_DIR}：${e.message}`);
  process.exit(1);
}
if (!bundle) {
  /** ⚠️ fail loud:说清楚人该做什么 */
  console.error('⚠️ 还没有任何构建产物 —— 先 npm start 跑一次');
  process.exit(1);
}

/** ⭐ 源码最后一次改动(只看会进 main 包的那些) */
const srcMtime = Number(execSync(
  "find src -name '*.ts' -o -name '*.tsx' | xargs stat -f '%m' | sort -rn | head -1",
  { encoding: 'utf8' },
).trim()) * 1000;

const buildAt = new Date(bundle.t);
const srcAt = new Date(srcMtime);
const fresh = bundle.t >= srcMtime;

console.log(`构建产物：${bundle.f}`);
console.log(`构建时刻：${buildAt.toLocaleString()}`);
console.log(`源码最后改动：${srcAt.toLocaleString()}`);
console.log('');
if (fresh) {
  console.log('✓ 构建**晚于**最后一次源码改动 —— 跑的是最新代码');
} else {
  const lagMin = Math.round((srcMtime - bundle.t) / 60000);
  console.log(`✗ **构建比源码旧 ${lagMin} 分钟** —— app 跑的不是你刚改的代码`);
  console.log('   ⭐ 退出 app 再 `npm start`;electron-forge 只在启动时构建');
  process.exitCode = 1;
}
