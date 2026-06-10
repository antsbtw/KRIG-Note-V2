/**
 * X(Twitter)IPC handlers(阶段 0/1)— 对齐 ai/handlers.ts 同模式
 *
 * 注册入口:src/platform/main/ipc/ipc-bus.ts initIpcBus()
 *
 * 1 invoke:X_EXTRACT_TWEET — 按坐标定位 + 抽该条推文。
 * (X_EXTRACT_TWEET_REQUEST 是 main→renderer 广播,由 webview-hook 发,不在此 handle。)
 */

import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '@shared/ipc/channel-names';
import { extractTweetAt } from './x-extract-tweet';

function isXServiceId(v: unknown): v is 'x' {
  return v === 'x';
}

export function registerXHandlers(): void {
  // X_EXTRACT_TWEET — 右键「提取此推文到笔记」:按坐标定位 + 抓全字段
  ipcMain.handle(IPC_CHANNELS.X_EXTRACT_TWEET, async (_e, payload: unknown) => {
    const p = payload as { serviceId?: unknown; x?: unknown; y?: unknown } | null;
    if (!p || !isXServiceId(p.serviceId) || typeof p.x !== 'number' || typeof p.y !== 'number') {
      return { success: false, error: 'invalid extractTweet payload' };
    }
    return extractTweetAt(p.serviceId, p.x, p.y);
  });
}
