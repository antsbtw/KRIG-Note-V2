/**
 * askAI orchestrator —— 主进程端到端 "向 AI 提问" 编排
 *
 * Phase 8 架构改造:走前台 AI Host webview(ai-webview-registry 跟踪)而非后台
 * BrowserWindow。原因:后台 BrowserWindow show:false 不被 OS 视为有焦点,
 * sendInputEvent 的 OS 级 Cmd+V/Enter 都不被 Chromium 处理 → paste 失败。
 *
 * 前台 webview 是 user-visible + 有焦点 + 接收 OS input,等价用户手动操作。
 *
 * 流程(对齐你的设计 "问 AI = 用户主导对话"):
 *   1. waitForAIWebContents(serviceId) — poll registry 等待前台 AI Host webview 注册
 *      (用户点 🤖 问 AI 后,bus.slot.openRight('ai-view') 让 AIView mount,
 *      webview navigate 到 claude.ai/new,did-navigate 触发 registry 注册)
 *   2. SSECaptureManager 跟随更换 webContents(订阅 registry attach 事件)
 *   3. pasteTextToAI(前台 wc) — OS Cmd+V 真粘贴
 *   4. clickSendButton(前台 wc) — OS Enter 真发送
 *
 * background-webview 模块已删除(被前台 webview-registry 取代,git rm)。
 */

import type { WebContents } from 'electron';
import type { AIServiceId } from '@shared/types/ai-service-types';
import type { AIAskResult, AISSEStatus } from '@shared/ipc/ai-types';
import { SSECaptureManager } from './interceptor';
import { pasteTextToAI, clickSendButton } from './writer';
import { broadcastAIResponseReady, broadcastAIError } from './broadcast';
import {
  getActiveAIWebContents,
  subscribeAttachAIWebContents,
} from './webview-registry';

/** 单例 SSE 拦截 manager — 跟随活跃 webContents 更换 */
let captureManager: SSECaptureManager | null = null;

/**
 * 订阅 registry 的"活跃 webContents 变更",自动 stop 旧 manager + new + start。
 * 模块加载时立即订阅(IIFE,确保 main 启动后任何 AI webview navigate 都被拦截)。
 */
subscribeAttachAIWebContents((_serviceId, wc) => {
  if (captureManager?.getWebContents() === wc) return;
  captureManager?.stop();
  captureManager = new SSECaptureManager(wc);
  captureManager.start();
});

/**
 * Poll 等待前台 AI Host webview 注册。
 *
 * 用户点 🤖 问 AI → AskAIPanel handleSend → bus.slot.openRight('ai-view') →
 * AIView mount → webview navigate 到 claude.ai/new → did-navigate → registry。
 * 这条链路 1-3s 不等(取决于网络);timeoutMs 给足。
 */
async function waitForAIWebContents(
  serviceId: AIServiceId,
  timeoutMs = 10_000,
): Promise<WebContents | null> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const wc = getActiveAIWebContents(serviceId);
    if (wc) return wc;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return null;
}

/**
 * 给 AI 服务发 prompt 等完整回复返回。
 *
 * 注:本期"问 AI"走的是 pasteAndSend(用户主导),不再走 askAI 这个"自动等回复"
 * 路径。askAI 保留供测试 / 程序化调用 / 未来快问快答场景。
 */
export async function askAI(
  serviceId: AIServiceId,
  prompt: string,
  timeoutMs = 60_000,
): Promise<AIAskResult> {
  try {
    const webContents = await waitForAIWebContents(serviceId);
    if (!webContents) {
      const err = `No active ${serviceId} webview — open AI tab and navigate first`;
      broadcastAIError({ serviceId, error: err });
      return { success: false, error: err };
    }

    // SSE manager 已通过 subscribeAttachAIWebContents 自动 attach,无需手动 start

    // 清掉之前的 response 缓存
    if (captureManager) {
      await captureManager.clearResponses();
    }

    // 粘贴 prompt
    const pasted = await pasteTextToAI(webContents, serviceId, prompt);
    if (!pasted) {
      const err = 'Failed to paste text into AI input box';
      broadcastAIError({ serviceId, error: err });
      return { success: false, error: err };
    }

    // 短暂等 React state propagation
    await new Promise((resolve) => setTimeout(resolve, 250));

    // 点发送
    await clickSendButton(webContents, serviceId);

    // 等回复
    if (!captureManager) {
      const err = 'SSE capture manager not initialized';
      broadcastAIError({ serviceId, error: err });
      return { success: false, error: err };
    }
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
 * 主路径:Phase 7 "问 AI" 用户主导对话 — 用户在前台 AI Host webview 看 AI 实时回复。
 *
 * SSE 拦截 manager 后台一直抓所有 AI 回复入 cache;
 * 用户点"提取整页对话"时一次性从 cache 拿(走 getLatestCapturedResponse)。
 */
export async function pasteAndSend(
  serviceId: AIServiceId,
  prompt: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    // 等前台 AI Host webview 就绪(用户点"问 AI"后,AIView mount → webview navigate
    // → did-navigate → registry 注册,链路 1-3s)
    const webContents = await waitForAIWebContents(serviceId);
    if (!webContents) {
      return {
        success: false,
        error: `No active ${serviceId} webview — wait for AI tab to load`,
      };
    }

    // SSE manager 已通过 subscribeAttachAIWebContents 自动 attach 到这个 wc

    const pasted = await pasteTextToAI(webContents, serviceId, prompt);
    if (!pasted) {
      return { success: false, error: 'Failed to paste text into AI input box' };
    }

    // writer.pasteTextToAI 内已 sleep 400ms + verify content landed,这里只需短
    // 暂 250ms 让 send button disabled 状态解除(React state propagation)。
    await new Promise((resolve) => setTimeout(resolve, 250));
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
