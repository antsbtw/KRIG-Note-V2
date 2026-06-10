/**
 * X(Twitter)IPC handlers(阶段 0/1/2)— 对齐 ai/handlers.ts 同模式
 *
 * 注册入口:src/platform/main/ipc/ipc-bus.ts initIpcBus()
 *
 * invoke:
 * - X_EXTRACT_TWEET(阶段 1)— 按坐标定位 + 抽该条推文。
 * - X_PASTE_TWEET(阶段 2)— 把纯文本填进 compose 框(发推,用户点发布)。
 * - X_PASTE_REPLY(阶段 2)— 导航到目标推 + 填进 reply 框(回复,用户点发布)。
 * (X_*_REQUEST 是 main→renderer 广播,由 webview-hook 发,不在此 handle。)
 */

import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '@shared/ipc/channel-names';
import { extractTweetAt } from './x-extract-tweet';
import { pasteTweet, pasteReply } from './x-write';

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

  // X_PASTE_TWEET — 发推:把纯文本填进 compose 框(用户随后手动点发布)
  ipcMain.handle(IPC_CHANNELS.X_PASTE_TWEET, async (_e, payload: unknown) => {
    const p = payload as { serviceId?: unknown; text?: unknown } | null;
    if (!p || !isXServiceId(p.serviceId) || typeof p.text !== 'string') {
      return { success: false, error: 'invalid pasteTweet payload' };
    }
    return pasteTweet(p.serviceId, p.text);
  });

  // X_PASTE_REPLY — 回复:导航到目标推 + 填进 reply 框(用户随后手动点回复)
  ipcMain.handle(IPC_CHANNELS.X_PASTE_REPLY, async (_e, payload: unknown) => {
    const p = payload as { serviceId?: unknown; tweetUrl?: unknown; text?: unknown } | null;
    if (
      !p || !isXServiceId(p.serviceId) ||
      typeof p.tweetUrl !== 'string' || typeof p.text !== 'string'
    ) {
      return { success: false, error: 'invalid pasteReply payload' };
    }
    return pasteReply(p.serviceId, p.tweetUrl, p.text);
  });
}
