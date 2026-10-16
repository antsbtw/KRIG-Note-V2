/**
 * ⭐⭐⭐ 看门狗线程源码 —— 主进程卡死时**它还活着**,负责把「卡住了 / 恢复了 / 还卡着」写进黑匣子
 *
 * ⚠️ 为什么要独立线程:主进程卡死时,主进程里的任何 timer / 日志都跑不了 —— 卡死恰恰是
 * 它自己记不下来的那一种故障。worker_threads 有自己的事件循环,主进程卡住它照样转。
 *
 * ⚠️ 为什么是字符串 + `eval: true`:Electron Forge + Vite 把主进程打成一个包,
 * 独立 worker 文件不会被打进去;字符串不经打包。
 * ⚠️⚠️ **整段源码不许出现反斜杠**(记忆 project-x-inject-template-escape:模板/字符串里的
 * 转义会被吃掉,而 tsc 与源码扫描全绿)—— 换行用 `String.fromCharCode(10)`。
 * 守卫:tests/platform/main/health-watchdog.test.ts 断言无反斜杠 + **真起一个 Worker 跑它**。
 *
 * 协议(主进程 → 看门狗):
 *   { type: 'beat' }                 每秒一次「还活着」
 *   { type: 'sample', data }         每次体检的摘要(卡住时随记录一起写出,复盘看卡住前的样子)
 * workerData:{ dir, session, hangMs, checkMs, stillMs }
 */
export const WATCHDOG_SOURCE = `
const { parentPort, workerData } = require('worker_threads');
const fs = require('fs');
const path = require('path');
const { dir, session, hangMs, checkMs, stillMs } = workerData;
const NL = String.fromCharCode(10);
let lastBeat = Date.now();
let lastSample = null;
let hungSince = 0;
let lastStill = 0;
function write(e) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const f = path.join(dir, new Date(e.ts).toISOString().slice(0, 10) + '.jsonl');
    fs.appendFileSync(f, JSON.stringify(e) + NL);
  } catch (err) { /* 写不了也不能让看门狗自己死 */ }
}
parentPort.on('message', (m) => {
  if (!m) return;
  if (m.type === 'beat') {
    const now = Date.now();
    if (hungSince) {
      write({ event: 'main-recovered', ts: now, session, hungMs: now - lastBeat, hangDetectedAt: hungSince });
      hungSince = 0;
    }
    lastBeat = now;
  } else if (m.type === 'sample') {
    lastSample = m.data;
  }
});
setInterval(() => {
  const now = Date.now();
  if (!hungSince && now - lastBeat > hangMs) {
    hungSince = now;
    lastStill = now;
    write({ event: 'main-hang', ts: now, session, silentMs: now - lastBeat, lastBeatAt: lastBeat, lastSample });
  } else if (hungSince && now - lastStill >= stillMs) {
    lastStill = now;
    write({ event: 'main-still-hung', ts: now, session, silentMs: now - lastBeat });
  }
}, checkMs);
`;
