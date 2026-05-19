/**
 * askAI orchestrator —— 主进程端到端 "向 AI 提问" 编排
 *
 * 流程:ensureReady → clearResponses → pasteText → clickSend → waitForResponse → 返回 Markdown
 *
 * V1 源:src/plugins/web-bridge/capabilities/ai-interaction.ts(字面搬,改 import alias + 接 V2 broadcast)
 */

import type { AIServiceId } from '@shared/types/ai-service-types';
import type { AIAskResult, AISSEStatus } from '@shared/ipc/ai-types';
import { backgroundAI } from './background-webview';
import { SSECaptureManager } from './interceptor';
import { pasteTextToAI, clickSendButton } from './writer';
import { broadcastAIResponseReady, broadcastAIError } from './broadcast';

/** 单例 SSE 拦截 manager — 首次 askAI 时创建 */
let captureManager: SSECaptureManager | null = null;

/**
 * 给 AI 服务发 prompt 等完整回复返回。
 *
 * @param serviceId  哪个 AI 服务
 * @param prompt     要发送的文字
 * @param timeoutMs  最大等待时间(默认 60s)
 */
export async function askAI(
  serviceId: AIServiceId,
  prompt: string,
  timeoutMs = 60_000,
): Promise<AIAskResult> {
  try {
    // 1. 后台 webview 就绪 + 导航到指定服务
    const webContents = await backgroundAI.ensureReady(serviceId);

    // 2. SSE 拦截 manager 复用判断(切服务时旧 manager stop,新建)
    if (!captureManager || captureManager.getWebContents() !== webContents) {
      captureManager?.stop();
      captureManager = new SSECaptureManager(webContents);
      captureManager.start();
      // Give the hook a moment to inject after page load
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    // 3. 清掉之前的 response 缓存
    await captureManager.clearResponses();

    // 4. 粘贴 prompt 到输入框
    const pasted = await pasteTextToAI(webContents, serviceId, prompt);
    if (!pasted) {
      const err = 'Failed to paste text into AI input box';
      broadcastAIError({ serviceId, error: err });
      return { success: false, error: err };
    }

    // 5. 稍等一下 UI 更新(部分服务必须)
    await new Promise((resolve) => setTimeout(resolve, 300));

    // 6. 点发送
    await clickSendButton(webContents, serviceId);

    // 7. 等回复
    const markdown = await captureManager.waitForResponse(timeoutMs);
    if (!markdown) {
      const err = 'AI response timed out';
      broadcastAIError({ serviceId, error: err });
      return { success: false, error: err };
    }

    broadcastAIResponseReady({ serviceId, markdown });
    return { success: true, markdown };
  } catch (error) {
    const err = String(error);
    broadcastAIError({ serviceId, error: err });
    return { success: false, error: err };
  }
}

/**
 * 取 SSE 拦截状态(debug 用)。
 */
export async function getSSEStatus(): Promise<AISSEStatus> {
  if (!captureManager) {
    return { count: 0, latestStreaming: false, hooked: false };
  }
  return captureManager.getStatus();
}

/**
 * pasteAndSend — 只 paste prompt + click send,不等 AI 回复。
 *
 * 用于"问 AI"主动让用户看到 AI Web 实时聊天体验:用户能在 AI 网页里看 AI
 * 打字、追问、修改回复。askAI 的"等回复 + 一次性返 Markdown"路径在这场景不合适。
 *
 * SSE 拦截 manager 仍然 start,后台一直抓所有 AI 回复入 cache;
 * 用户点"提取整页对话"时一次性从 cache 拿全部 turn(Phase 6.5 实现)。
 */
export async function pasteAndSend(
  serviceId: AIServiceId,
  prompt: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const webContents = await backgroundAI.ensureReady(serviceId);

    if (!captureManager || captureManager.getWebContents() !== webContents) {
      captureManager?.stop();
      captureManager = new SSECaptureManager(webContents);
      captureManager.start();
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    const pasted = await pasteTextToAI(webContents, serviceId, prompt);
    if (!pasted) {
      return { success: false, error: 'Failed to paste text into AI input box' };
    }

    await new Promise((resolve) => setTimeout(resolve, 300));
    await clickSendButton(webContents, serviceId);
    return { success: true };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

/**
 * 取 SSECaptureManager 抓到的最新一次完整 AI 回复 markdown。
 *
 * 用于"提取整页对话"(Phase 6.5)从 capture 缓存拿 AI 最后一段回复。
 * 本期简化:只返最新一次;后续 sub-phase 可扩展为"取所有 turn"。
 */
export async function getLatestCapturedResponse(): Promise<string | null> {
  if (!captureManager) return null;
  return captureManager.getLatestResponse();
}
