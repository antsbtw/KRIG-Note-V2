/**
 * ai-conversation 跨模块广播工具(对齐 thought/broadcast.ts 同模式)
 *
 * 广播 main 进程产生的 AI 事件(回复完成 / 错误 / 流式增量)给所有 renderer 窗口。
 * 后台 webview(BrowserWindow.show=false)不会订阅这些事件 — 仅前台 renderer 看到。
 */

import { BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '@shared/ipc/channel-names';
import type {
  AIResponseReadyPayload,
  AIErrorPayload,
  AIStreamChunk,
} from '@shared/ipc/ai-types';

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed() && win.isVisible()) {
      win.webContents.send(channel, payload);
    }
  }
}

export function broadcastAIResponseReady(payload: AIResponseReadyPayload): void {
  broadcast(IPC_CHANNELS.AI_RESPONSE_READY, payload);
}

export function broadcastAIError(payload: AIErrorPayload): void {
  broadcast(IPC_CHANNELS.AI_ERROR, payload);
}

export function broadcastAIStreamChunk(payload: AIStreamChunk): void {
  broadcast(IPC_CHANNELS.AI_RESPONSE_STREAM, payload);
}
