/**
 * ai-conversation IPC handlers(对齐 thought/handlers.ts 同模式)
 *
 * 注册入口:src/platform/main/ipc/ipc-bus.ts initIpcBus()
 *
 * 4 invoke + 3 broadcast = 7 channel-names。
 */

import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '@shared/ipc/channel-names';
import { AI_SERVICE_PROFILES, type AIServiceId } from '@shared/types/ai-service-types';
import type { AIAskOptions, AIAskResult } from '@shared/ipc/ai-types';
import { askAI, getSSEStatus } from './ask-orchestrator';
import { backgroundAI } from './background-webview';

function isServiceId(v: unknown): v is AIServiceId {
  return v === 'chatgpt' || v === 'claude' || v === 'gemini';
}

export function registerAIHandlers(): void {
  // #1 ai.ask — askAI 端到端
  ipcMain.handle(
    IPC_CHANNELS.AI_ASK,
    async (
      _e,
      payload: unknown,
    ): Promise<AIAskResult> => {
      const p = payload as { serviceId?: unknown; prompt?: unknown; options?: unknown } | null;
      if (!p || !isServiceId(p.serviceId) || typeof p.prompt !== 'string' || !p.prompt) {
        return { success: false, error: 'invalid askAI payload' };
      }
      const opts = (p.options as AIAskOptions | undefined) ?? {};
      return askAI(p.serviceId, p.prompt, opts.timeoutMs);
    },
  );

  // #2 ai.open-session — 把后台 webview 转前台(本期占位,返回当前状态)
  ipcMain.handle(IPC_CHANNELS.AI_OPEN_SESSION, async (_e, serviceId: unknown) => {
    if (!isServiceId(serviceId)) return { success: false, error: 'invalid serviceId' };
    try {
      await backgroundAI.ensureReady(serviceId);
      return { success: true, ...backgroundAI.getStatus() };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  });

  // #3 ai.service-list — 三服务清单(UI 下拉菜单用)
  ipcMain.handle(IPC_CHANNELS.AI_SERVICE_LIST, async () => {
    return AI_SERVICE_PROFILES.map((p) => ({ id: p.id, name: p.name, icon: p.icon }));
  });

  // #4 ai.sse-status — debug
  ipcMain.handle(IPC_CHANNELS.AI_SSE_STATUS, async () => getSSEStatus());
}
