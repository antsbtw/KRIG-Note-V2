/**
 * 守卫:存量积压必须被自动清理,不能只靠人点按钮。
 *
 * 起因(2026-09-03 实机观察):换完模型重启 app 后,945 条 pending
 * **静躺 2 分钟纹丝不动**,ai_judging 恒为 0,Ollama 里连模型都没被加载。
 *
 * 根因:两个判断触发点都挂在「本轮**新采到**多少条」上
 * (accumulatePending(saved) → runJudgeBatch),
 * 存量 pending 没有任何东西会去动它 —— 只有手点「AI 判断」才会开始清。
 * 于是积压越堆越高,而界面上看不出任何异常。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const sched = readFileSync(
  resolve(__dirname, '../../src/platform/main/x/x-search-scheduler.ts'), 'utf-8');
const repo = readFileSync(
  resolve(__dirname, '../../src/platform/main/db/tweet-inbox-repo.ts'), 'utf-8');

describe('存量积压自动清理', () => {
  it('⭐ 调度器必须查积压并启动 drain(而非只在新采到时触发)', () => {
    expect(sched).toContain('countPending');
    expect(
      /startJudgeDrain\(/.test(sched),
      '只有 runJudgeBatch 是不够的 —— 它一次只判一批,清不完积压',
    ).toBe(true);
  });

  it('⭐ 积压清理必须独立调度,不能塞在 runEnabledRecipes 里', () => {
    // 踩过:塞进去后被该函数开头的 `activeXWcMap.size === 0` 挡掉,
    // 没开 X 视图时永远走不到 —— 重启两次都纹丝不动。
    // 判断只需要 Ollama + 数据库,不需要 webContents。
    expect(sched).toMatch(/backlogTimer\s*=\s*setInterval/);
    const fn = sched.slice(sched.indexOf('async function runEnabledRecipes'));
    const body = fn.slice(0, fn.indexOf('\n}'));
    expect(
      body.includes('countPending'),
      '积压清理又被塞回 runEnabledRecipes 了 —— 会被 activeXWcMap 守卫挡掉',
    ).toBe(false);
  });

  it('backlogTimer 必须在 stopScheduler 里清理', () => {
    const fn = sched.slice(sched.indexOf('export function stopScheduler'));
    const body = fn.slice(0, fn.indexOf('\n}'));
    expect(body.includes('backlogTimer')).toBe(true);
  });

  it('⭐ countPending 与 queryPending 的排除条件必须一致', () => {
    // 两处判据不一致会导致「数出来有积压、捞的时候是空」的空转
    for (const cond of ['accepted = NONE', "replied != true", 'human:']) {
      const inCount = repo.slice(repo.indexOf('export async function countPending'),
        repo.indexOf('export async function markAiJudging'));
      const inQuery = repo.slice(repo.indexOf('export async function queryPending'),
        repo.indexOf('export async function markAiJudging'));
      expect(inCount.includes(cond), `countPending 缺条件 ${cond}`).toBe(true);
      expect(inQuery.includes(cond), `queryPending 缺条件 ${cond}`).toBe(true);
    }
  });

  it('查积压失败必须留痕', () => {
    expect(sched).toMatch(/console\.error[\s\S]{0,40}积压/);
  });
});
