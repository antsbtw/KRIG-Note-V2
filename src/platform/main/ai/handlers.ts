/**
 * ai-extraction IPC handlers(对齐 thought/handlers.ts 同模式)
 *
 * 注册入口:src/platform/main/ipc/ipc-bus.ts initIpcBus()
 *
 * 4 invoke + 3 broadcast = 7 channel-names。
 */

import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '@shared/ipc/channel-names';
import { AI_SERVICE_PROFILES, type AIServiceId } from '@shared/types/ai-service-types';
import type { AIAskOptions, AIAskResult } from '@shared/ipc/ai-types';
import { askAI, getSSEStatus, pasteAndSend, getLatestCapturedResponse, extractFullConversation } from './ask-orchestrator';
import { getActiveAIWebContents } from './webview-registry';
import { registerAISyncHandlers } from './ai-sync-orchestrator';

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

  // #2 ai.open-session — 探测某服务的活跃前台 AI Host webview 是否就绪
  // (Phase 8 架构改造后:不再创建后台 BrowserWindow,所有 AI 操作走前台 webview;
  //  本 API 退化为"探测 webview 是否注册"诊断用)
  ipcMain.handle(IPC_CHANNELS.AI_OPEN_SESSION, async (_e, serviceId: unknown) => {
    if (!isServiceId(serviceId)) return { success: false, error: 'invalid serviceId' };
    const wc = getActiveAIWebContents(serviceId);
    if (!wc) {
      return {
        success: false,
        status: 'not-attached',
        serviceId,
        error: 'No active webview — open AI tab and navigate to service URL first',
      };
    }
    return {
      success: true,
      status: 'ready',
      serviceId,
      url: wc.getURL(),
    };
  });

  // #3 ai.service-list — 三服务清单(UI 下拉菜单用)
  ipcMain.handle(IPC_CHANNELS.AI_SERVICE_LIST, async () => {
    return AI_SERVICE_PROFILES.map((p) => ({ id: p.id, name: p.name, icon: p.icon }));
  });

  // #4 ai.sse-status — debug
  ipcMain.handle(IPC_CHANNELS.AI_SSE_STATUS, async () => getSSEStatus());

  // #5 ai.paste-and-send — 问 AI 路径:paste + send 不等回复(用户在 AI Web 实时看)
  ipcMain.handle(IPC_CHANNELS.AI_PASTE_AND_SEND, async (_e, payload: unknown) => {
    const p = payload as { serviceId?: unknown; prompt?: unknown } | null;
    if (!p || !isServiceId(p.serviceId) || typeof p.prompt !== 'string' || !p.prompt) {
      return { success: false, error: 'invalid pasteAndSend payload' };
    }
    return pasteAndSend(p.serviceId, p.prompt);
  });

  // #6 ai.get-latest-response — 提取按钮用:从 SSE 缓存取最新回复 markdown
  ipcMain.handle(IPC_CHANNELS.AI_GET_LATEST_RESPONSE, async () => {
    return getLatestCapturedResponse();
  });

  // #7 ai.extract-full — Phase 10.B:整页对话提取(多 turn + artifact + 图片)
  ipcMain.handle(IPC_CHANNELS.AI_EXTRACT_FULL, async (_e, serviceId: unknown) => {
    if (!isServiceId(serviceId)) {
      return { success: false, error: 'invalid serviceId' };
    }
    return extractFullConversation(serviceId);
  });

  // #8/#9 ai-sync.start / ai-sync.stop — renderer 端 ai-sync-integration 控制
  // (上下文:左 ai-view + 右 note-view 槽组合下 start,组合一变就 stop)
  registerAISyncHandlers();
}
