/**
 * 守卫:搜索扫描不得因固定轮次而提前收工。
 *
 * 用户 2026-09-02:「应该让扫描 48 小时内的推文吧,哪怕重复,但是不会漏掉」。
 *
 * 光把 since 窗口放宽到 48h 是不够的 —— 此前 maxScrollRounds=5 意味着
 * **只读前 5 屏(约 50 条)就收工**,窗口再宽也读不到。
 * 这与 reply 采集栽过的坑同源(验证页量出漏 83%),judge 判据必须是
 * 「滚过窗口」或「真的滚不动」,不能是固定圈数。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SRC = readFileSync(
  resolve(__dirname, '../../src/platform/main/x/x-timeline-scan.ts'), 'utf-8');

describe('搜索扫描的滚动覆盖', () => {
  it('⭐ 轮次上限不得是个小数字(那会变成事实上的停止条件)', () => {
    const m = SRC.match(/maxScrollRounds\s*=\s*(\d+)/);
    expect(m, '找不到 maxScrollRounds 默认值').toBeTruthy();
    expect(
      Number(m![1]),
      '轮次上限太小 —— 它会先于「滚过窗口/滚不动」触发,导致只读前几屏',
    ).toBeGreaterThanOrEqual(100);
  });

  it('⭐ 必须按时间判断是否读完(而非固定圈数)', () => {
    // 停止判据从 sinceMs 改为 scrollToMs:since 窗口仍宽(防遗漏),
    // 但单轮只滚「距上次运行那一段」,详见下方两条
    expect(SRC).toContain('sinceMs');
    expect(SRC).toMatch(/Math\.min\(\.\.\.oldestThisRound\)\s*<\s*scrollToMs/);
  });

  it('⭐ 必须检测「真的滚不动」而非只看有无新数据', () => {
    expect(SRC).toContain('stuckRounds');
    expect(SRC).toMatch(/stuckRounds\s*>=\s*3/);
  });

  it('滚动后必须回读 scrollY(smooth 是异步的,滚动前读等于没读)', () => {
    // 只查**代码**,不查注释 —— 注释里出现 smooth 是在说明为什么不能用它
    const code = SRC.split('\n')
      .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
      .join('\n');
    expect(/behavior:\s*['"]smooth['"]/.test(code), '滚动又用了 smooth').toBe(false);
    expect(SRC).toContain('window.scrollY');
  });

  it('48h 叠加窗口仍在(宁可重复不可遗漏)', () => {
    expect(SRC).toMatch(/overlapHours\s*=\s*48/);
  });

  it('⭐ 滚动深度与 since 窗口必须分开 —— 否则 30 分钟一轮却滚 48 小时', () => {
    // 实测:48h 窗口内 1062 条,而 30 分钟真正新增只有 14 条 = 76 倍无用功
    expect(SRC).toContain('computeScrollDepthMs');
    expect(SRC).toContain('scrollToMs');
    // 停止判据必须用 scrollToMs(本轮深度),不能用 sinceMs(宽窗口)
    expect(SRC).toMatch(/Math\.min\(\.\.\.oldestThisRound\)\s*<\s*scrollToMs/);
  });

  it('滚动深度有 12 小时上限(关机数天也不会单轮跑失控)', () => {
    expect(SRC).toMatch(/MAX_SCROLL_DEPTH_HOURS\s*=\s*12/);
  });
});
