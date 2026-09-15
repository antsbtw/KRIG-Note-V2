/**
 * ⭐⭐ 重构期间自动采集必须关闭(2026-09-15)
 *
 * ── 起因(实测)──
 *
 * 用户在重构中途发现四条任务仍在 30 分钟一轮地自动跑,一晚自动采了 204 条 ——
 * 而那时我们正在换任务模型(配方→x_task)、换面板(X Inbox→X 工作台)。
 *
 * ⚠️ 光把库里的 `x_task.enabled` 置 false **不够**:那是运行期状态,
 * 界面一改、migration 一碰就会回来。所以加了代码层的 `AUTO_COLLECT_ENABLED`。
 *
 * ⚠️⚠️ 两个轮询**必须受同一个开关控制** —— 只关采集不关盯人等于没关:
 * 盯人照样占 webview、照样采 645 人的名单。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SCHED = readFileSync(
  resolve(__dirname, '../../src/platform/main/x/x-search-scheduler.ts'), 'utf-8');
const CODE = SCHED.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

describe('⭐⭐ 自动采集总开关', () => {
  it('⭐⭐ 开关存在,且**默认关**', () => {
    expect(CODE, '没有总开关 —— 只靠库里的 enabled,改一下就又跑起来了')
      .toMatch(/const AUTO_COLLECT_ENABLED\s*=\s*false/);
  });

  it('⭐⭐ 采集轮询受开关控制', () => {
    const i = CODE.indexOf('schedulerTimer = setInterval');
    expect(i, '锚点过时:找不到采集轮询').toBeGreaterThan(0);
    // 往前找最近的 if,确认它被包住了
    const before = CODE.slice(Math.max(0, i - 200), i);
    expect(before, '采集轮询没被开关包住 —— 关了也照跑')
      .toMatch(/if\s*\(AUTO_COLLECT_ENABLED\)/);
  });

  it('⭐⭐ 盯人轮询受**同一个**开关控制(只关一个等于没关)', () => {
    const i = CODE.indexOf('watchlistTimer = setInterval');
    expect(i, '锚点过时:找不到盯人轮询').toBeGreaterThan(0);
    const before = CODE.slice(Math.max(0, i - 200), i);
    expect(before, '盯人轮询没被开关包住 —— 它照样占 webview、照样采 645 人')
      .toMatch(/if\s*\(AUTO_COLLECT_ENABLED\)/);
  });

  it('⭐⭐ 关掉时**要说出来**,不静默', () => {
    /**
     * 静默不启动 = 「以为在采、其实没采」,
     * 与当初「以为没采、其实在采」是同一种病的两面。
     */
    expect(CODE).toMatch(/自动采集已关闭/);
    expect(CODE, '只在注释里说不算 —— 要在运行时打出来').toMatch(/console\.(warn|log)\([\s\S]{0,120}自动采集已关闭/);
  });

  it('⭐ 恢复条件写在代码里,不靠记忆', () => {
    // 三条:任务面板能开关 / 盯人真机验过 / 用户明确说可以
    expect(SCHED).toMatch(/恢复条件/);
    expect(SCHED).toMatch(/X_LIST_TASKS/);
  });

  it('⭐ 手动执行不受影响(重构期间正需要「想跑就跑一次」)', () => {
    // runEnabledTasks / runTasksForWs 本身不该被开关卡死 —— 开关只管定时器
    const fn = CODE.indexOf('async function runTasksForWs(');
    expect(fn).toBeGreaterThan(0);
    const body = CODE.slice(fn, CODE.indexOf('async function runEnabledTasks('));
    expect(body, '执行函数里塞了开关 —— 手动触发也会被挡住')
      .not.toMatch(/AUTO_COLLECT_ENABLED/);
  });
});
