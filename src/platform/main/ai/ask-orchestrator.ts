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
