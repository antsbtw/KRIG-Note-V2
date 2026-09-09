/**
 * ⭐ 「谁来查探针」的答案 —— 定期巡检 + 变化时才发声
 *
 * ── 为什么必须有这个文件 ──
 *
 * 步 2.5 的探针是**拉取式**的(调 `health()` 时现算),这是有意的:
 * 推送式要常驻 timer 在能力层内部,而记忆 `project-graceful-shutdown` 明确
 * 「常驻 timer 会吊住 Node 事件循环让进程不肯退」。
 *
 * **但代价是:没人调 `health()` 就没人知道坏了** —— 探针等于白做。
 * `08` §6.8.3③ 把这条列为「本步必须处理的债」。
 *
 * ── 这里怎么解决 ──
 *
 * 把 timer 放在**接线层**(而不是能力层),并严格满足本仓铁律:
 *  ⭐ **常驻 timer 必须有停止调用**,且必须在 `before-quit` 被调到。
 *    `stopHealthWatch()` 导出给 `index.ts` 的 before-quit 用;
 *    另外 timer 本身 `unref()`,不吊住事件循环。
 *
 * ── 为什么「变化时才发声」 ──
 *
 * 每次巡检都打日志 = 刷屏,人会学会无视它(步 2.5 里「天天误报的探针等于没有探针」
 * 是同一条道理)。所以只在**健康状态发生翻转**时打一次:
 *   健康 → 不健康:`console.error` 报警 + 记 degradation
 *   不健康 → 健康:`console.log` 报恢复 + 记 recovery(⭐ 自愈必须留痕)
 */

import { healthProbe, netBus, traceRecorder, getNetMonitor, listMonitoredPages } from './runtime';
import type { HealthReport } from '../trace';

/** 默认巡检间隔。比探针窗口(5 分钟)短,保证一个窗口内至少查到几次 */
const DEFAULT_INTERVAL_MS = 60_000;

let timer: ReturnType<typeof setInterval> | null = null;
/** pageId → 上次是否健康。只在翻转时发声 */
const lastAlive = new Map<string, boolean>();

/** 巡检一次:遍历所有被观测的页面,返回本轮报告(也供测试与手动排查调用) */
export function checkOnce(): Array<{ pageId: string; report: HealthReport }> {
  const out: Array<{ pageId: string; report: HealthReport }> = [];
  for (const pageId of listMonitoredPages()) {
    const monitor = getNetMonitor(pageId);
    const report = healthProbe.net(
      monitor.facts({
        sessions: 1,
        subscribers: netBus.subscriberCount(pageId as never),
      }),
    );
    out.push({ pageId, report });

    const prev = lastAlive.get(pageId);
    if (prev === report.alive) continue;   // 没翻转 → 不发声,免刷屏
    lastAlive.set(pageId, report.alive);

    if (!report.alive) {
      // ⭐ 坏掉时必须响 —— 这就是「通道哑了会自己举手」落到实处的一句
      console.error(
        `[web.trace] ⚠️ web.net 不健康 (page=${pageId}): ${report.problems.join(' | ')}`,
      );
      traceRecorder.degradation({
        layer: 'web.net',
        operation: 'health-check',
        category: 'systemic',
        reason: report.problems.join(' | '),
        inputRef: pageId,
      });
    } else if (prev !== undefined) {
      // prev !== undefined:说明是从「不健康」翻回来的,不是首次巡检
      console.log(`[web.trace] ✅ web.net 已恢复 (page=${pageId})`);
      // ⭐ 自愈必须留痕(`05` §4.2:静默自愈 = 把问题藏起来)
      traceRecorder.recovery({
        layer: 'web.net',
        what: `page=${pageId} 通道恢复捕获`,
        outcome: 'recovered',
      });
    }
  }
  return out;
}

/**
 * 启动定期巡检。幂等 —— 重复调不会开两个 timer。
 *
 * ⚠️ 调用方**必须**在 `before-quit` 调 `stopHealthWatch()`(见文件头注释)。
 */
export function startHealthWatch(intervalMs = DEFAULT_INTERVAL_MS): void {
  if (timer) return;
  timer = setInterval(() => {
    try {
      checkOnce();
    } catch (err) {
      // 巡检自己抛错不许拖垮进程,但**必须留痕** —— 诊断模块自己变成故障源是最坏的情况
      console.warn('[web.trace] 健康巡检抛错', err);
    }
  }, intervalMs);
  // 不吊住 Node 事件循环(记忆 project-graceful-shutdown 第 2 条成因)
  timer.unref?.();
}

/** ⭐ 停止巡检。**必须**在 before-quit 被调到,否则就是本仓踩过的那个坑 */
export function stopHealthWatch(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}

/** 测试用:清掉翻转记忆 */
export function _resetHealthWatch(): void {
  stopHealthWatch();
  lastAlive.clear();
}
