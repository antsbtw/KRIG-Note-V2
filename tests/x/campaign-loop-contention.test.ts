/**
 * 守卫:自动循环不得与用户抢 webview。
 *
 * 2026-09-03 实测:主循环每 3 分钟 loadURL 到通知页,而用户正在同一个
 * webview 上点推文 —— 页面被硬生生导航走,表现为**一直转圈**,
 * 连 /health 都卡住(主进程在等 webview)。
 *
 * 这正是 ws 角色隔离本来要防的争抢,却在**单个 ws 内部**被我又造了一次:
 * 界面操作与后台循环共用同一个 webContents。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (p: string) => readFileSync(resolve(__dirname, '../../', p), 'utf-8');
const loop = read('src/platform/main/x/x-campaign-loop.ts');
const handlers = read('src/platform/main/x/x-timeline-handlers.ts');

describe('webview 争抢防护', () => {
  it('⭐ 循环提供暂停机制', () => {
    expect(loop).toContain('export function pauseCampaignLoop');
    expect(loop).toContain('pausedUntil');
  });

  it('⭐ 暂停期内本轮必须跳过(不是排队等待 —— 等待照样会抢)', () => {
    const fn = loop.slice(loop.indexOf('timer = setInterval'));
    const body = fn.slice(0, fn.indexOf('}, minutes'));
    expect(body).toMatch(/Date\.now\(\)\s*<\s*pausedUntil/);
    expect(body).toContain('return');
  });

  it('⭐ 所有会导航 webview 的手动 handler 都要先让路', () => {
    // 抓通知 / 抓文章回复 / 手动跑配方 —— 三条都会 loadURL
    for (const ch of ['X_HARVEST_NOTIFICATIONS', 'X_FETCH_ARTICLE_REPLIES', 'X_RUN_RECIPE']) {
      const i = handlers.indexOf(`IPC_CHANNELS.${ch}, async`);
      expect(i, `找不到 ${ch} handler`).toBeGreaterThan(0);
      const block = handlers.slice(i, i + 900);
      expect(block, `${ch} 未调 pauseCampaignLoop —— 会与自动循环抢 webview`)
        .toContain('pauseCampaignLoop');
    }
  });

  it('循环自身有重入保护(上一轮没跑完不叠加)', () => {
    expect(loop).toMatch(/if\s*\(running\)/);
  });
});
