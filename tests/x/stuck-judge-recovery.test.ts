/**
 * 守卫:ai_judging 卡住必须能自愈,且必须是**周期性**的。
 *
 * 起因(用户 2026-09-02):「采集了 303,但是显示是 0,是否都是重复的了?」
 * 查库真相:不是重复 —— 460 条卡在 status='ai_judging',最早一条卡了十几小时。
 * 它们既不在「待判」(那查 pending)也不在其他视图,**从收件箱彻底消失**,
 * 而界面毫无异常提示 —— 又一次静默坍缩。
 *
 * 根因:recoverStuckAiJudging **只在启动时跑一次**(index.ts)。
 * app 长时间运行时,判断中断的行就永久停在那里。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const sched = readFileSync(
  resolve(__dirname, '../../src/platform/main/x/x-search-scheduler.ts'), 'utf-8');

describe('ai_judging 卡住自愈', () => {
  it('⭐ 调度器必须周期性调用 recoverStuckAiJudging', () => {
    expect(
      sched.includes('recoverStuckAiJudging'),
      '只在启动时自愈是不够的 —— app 跑一天就会积压出"消失的推文"',
    ).toBe(true);
    // 必须挂在 setInterval 上,不能只在启动路径调一次
    expect(sched).toMatch(/judgeRecoverTimer\s*=\s*setInterval/);
  });

  it('自愈 timer 必须在 stopScheduler 里清理', () => {
    const fn = sched.slice(sched.indexOf('export function stopScheduler'));
    const body = fn.slice(0, fn.indexOf('\n}'));
    expect(
      body.includes('judgeRecoverTimer'),
      '常驻 timer 没有停止调用 → before-quit 走不完(Ctrl+C 不退)',
    ).toBe(true);
  });

  it('自愈发生时必须留痕(不能静默退回)', () => {
    expect(sched).toMatch(/console\.(warn|log)[\s\S]{0,120}ai_judging/);
  });
});
