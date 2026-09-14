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

/**
 * ⚠️⚠️ **2026-09-14 改造后,守护对象从一个文件变成两个** ——
 * 断言一条没删,只是分别扫到了它们现在所在的地方。
 *
 * `scanRecipe` 已改为「读策略 → 拿三个答案 → 交给执行器跑」,于是:
 *
 * | 血泪 | 改造前在哪 | 现在在哪 |
 * |---|---|---|
 * | 滚过本轮深度才停 | `Math.min(...oldestThisRound) < scrollToMs` | **判据**仍在 scan(`scrollToMs`),**比较**在 runner(`olderThan`) |
 * | 连续 3 轮不变才算到底 | scan 的 `stuckRounds >= 3` | runner 的 `STUCK_ROUNDS = 3` |
 * | 滚动后回读 scrollY | scan | runner |
 * | 深度与 since 窗口分开 | scan | **仍在 scan**(computeScrollDepthMs / scrollToMs) |
 *
 * ⭐ **绝不允许「因为搬走了就把断言删掉」** —— 那是本仓明令的反模式
 * (「为了让测试变绿去删掉最该留的说明」)。搬到哪就扫到哪。
 */
const RUNNER = readFileSync(
  resolve(__dirname, '../../src/platform/main/x/x-collect-runner.ts'), 'utf-8');

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
    // 判据来源仍在 scan:scrollToMs 由 computeScrollDepthMs 算出
    expect(SRC).toContain('sinceMs');
    expect(SRC).toContain('scrollToMs');
    // ⭐ 并且真的被当成停止判据喂给执行器(不是算出来没人用)
    expect(SRC).toMatch(/stopOverride:\s*\{\s*kind:\s*'olderThan',\s*beforeTs:\s*scrollToMs\s*\}/);
    // 执行器侧:olderThan 拿本轮最旧一条跟 beforeTs 比
    expect(RUNNER).toMatch(/Math\.min\(\.\.\.times\)/);
    expect(RUNNER).toMatch(/oldest\s*<\s*stop\.beforeTs/);
  });

  it('⭐ 必须检测「真的滚不动」而非只看有无新数据', () => {
    expect(RUNNER).toContain('STUCK_ROUNDS');
    expect(RUNNER).toMatch(/STUCK_ROUNDS\s*=\s*3/);
    expect(RUNNER).toMatch(/stuckRounds\s*>=\s*STUCK_ROUNDS/);
  });

  it('滚动后必须回读 scrollY(smooth 是异步的,滚动前读等于没读)', () => {
    // 只查**代码**,不查注释 —— 注释里出现 smooth 是在说明为什么不能用它
    const code = RUNNER.split('\n')
      .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
      .join('\n');
    expect(/behavior:\s*['"]smooth['"]/.test(code), '滚动又用了 smooth').toBe(false);
    expect(RUNNER).toContain('window.scrollY');
    // ⭐ 回读必须在 scrollBy **之后** —— 顺序反了等于没测量
    expect(
      RUNNER.indexOf('SCROLL_SCRIPT') < RUNNER.lastIndexOf("executeJavaScript('window.scrollY')"),
      '回读 scrollY 出现在滚动之前',
    ).toBe(true);
  });

  it('48h 叠加窗口仍在(宁可重复不可遗漏)', () => {
    expect(SRC).toMatch(/overlapHours\s*=\s*48/);
  });

  it('⭐ 滚动深度与 since 窗口必须分开 —— 否则 30 分钟一轮却滚 48 小时', () => {
    // 实测:48h 窗口内 1062 条,而 30 分钟真正新增只有 14 条 = 76 倍无用功
    expect(SRC).toContain('computeScrollDepthMs');
    expect(SRC).toContain('scrollToMs');
    // ⭐ 喂给执行器的必须是 scrollToMs(本轮深度),不能是 sinceMs(宽窗口)
    expect(SRC).toMatch(/beforeTs:\s*scrollToMs/);
    expect(SRC, '把宽窗口当成了滚动深度').not.toMatch(/beforeTs:\s*sinceMs/);
  });

  it('滚动深度有 12 小时上限(关机数天也不会单轮跑失控)', () => {
    expect(SRC).toMatch(/MAX_SCROLL_DEPTH_HOURS\s*=\s*12/);
  });
});
