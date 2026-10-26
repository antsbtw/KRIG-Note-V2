/**
 * ⭐ 执行记录到期清理 —— 启动后清一次,之后每 6 小时一次(用户 10-24:状态轮询「全记,只留 7 天」)
 * 只删 keep_days 有值的行(flow-run-repo purgeExpiredCalls);长期保留的不碰。
 * ⚠️ 常驻 timer:unref + before-quit 必须调 stopFlowRetention(记忆 project-graceful-shutdown)。
 * ⚠️ 清失败要响 —— 不清的话表一直涨,又没人知道。
 */
import { purgeExpiredCalls } from './flow-run-repo';

const EVERY_MS = 6 * 3600_000;
let timer: NodeJS.Timeout | null = null;

async function sweep(): Promise<void> {
  try {
    const n = await purgeExpiredCalls();
    if (n > 0) console.log(`[flow-retention] 清掉过期的执行记录 ${n} 行(状态轮询,超过 7 天)`);
  } catch (e) {
    console.error('[flow-retention] ⚠️ 清过期执行记录失败(表会一直涨):', e);
  }
}

/** ⚠️ 要在库初始化之后调 */
export function startFlowRetention(): void {
  if (timer) return;
  void sweep();
  timer = setInterval(() => { void sweep(); }, EVERY_MS);
  timer.unref?.();
}

export function stopFlowRetention(): void {
  if (timer) { clearInterval(timer); timer = null; }
}
