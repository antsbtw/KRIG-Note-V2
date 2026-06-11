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
import { armXDragListener, resolveXDropAt, clickReplyAtDrop } from './x-drag-drop';

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
    const p = payload as { serviceId?: unknown; text?: unknown; targetWcId?: unknown } | null;
    if (!p || !isXServiceId(p.serviceId) || typeof p.text !== 'string') {
      return { success: false, error: 'invalid pasteTweet payload' };
    }
    const targetWcId = typeof p.targetWcId === 'number' ? p.targetWcId : undefined;
    return pasteTweet(p.serviceId, p.text, targetWcId);
  });

  // X_PASTE_REPLY — 回复:导航到目标推 + 填进 reply 框(用户随后手动点回复)
  ipcMain.handle(IPC_CHANNELS.X_PASTE_REPLY, async (_e, payload: unknown) => {
    const p = payload as
      | { serviceId?: unknown; tweetUrl?: unknown; text?: unknown; targetWcId?: unknown }
      | null;
    if (
      !p || !isXServiceId(p.serviceId) ||
      typeof p.tweetUrl !== 'string' || typeof p.text !== 'string'
    ) {
      return { success: false, error: 'invalid pasteReply payload' };
    }
    const targetWcId = typeof p.targetWcId === 'number' ? p.targetWcId : undefined;
    return pasteReply(p.serviceId, p.tweetUrl, p.text, targetWcId);
  });

  // X_DRAG_ARM — note 拖起:往指定 X guest 装 mousemove 监听(记录最后坐标)
  ipcMain.handle(IPC_CHANNELS.X_DRAG_ARM, async (_e, payload: unknown) => {
    const p = payload as { targetWcId?: unknown } | null;
    if (!p || typeof p.targetWcId !== 'number') return { ok: false };
    await armXDragListener(p.targetWcId);
    return { ok: true };
  });

  // X_DRAG_RESOLVE — 松手:读回最后坐标 + 解析落点(compose / tweet / other / none)
  ipcMain.handle(IPC_CHANNELS.X_DRAG_RESOLVE, async (_e, payload: unknown) => {
    const p = payload as { serviceId?: unknown; targetWcId?: unknown } | null;
    if (!p || !isXServiceId(p.serviceId) || typeof p.targetWcId !== 'number') {
      return { kind: 'none' };
    }
    return resolveXDropAt(p.serviceId, p.targetWcId);
  });

  // X_DRAG_REPLY_HERE — 落推文:就地点该推回复按钮弹 reply 框(不跳详情页)
  ipcMain.handle(IPC_CHANNELS.X_DRAG_REPLY_HERE, async (_e, payload: unknown) => {
    const p = payload as { serviceId?: unknown; targetWcId?: unknown } | null;
    if (!p || !isXServiceId(p.serviceId) || typeof p.targetWcId !== 'number') {
      return { ok: false, error: 'invalid replyHere payload' };
    }
    return clickReplyAtDrop(p.serviceId, p.targetWcId);
  });
}
