/**
 * AI Webview Registry — 主进程跟踪所有"加载了 AI 服务网页"的前台 webview
 *
 * 用途:askAI / pasteAndSend 不再走后台隐藏 BrowserWindow(那个收不到 OS 输入事件),
 * 改走用户右槽实际可见的 AI Host webview 的 webContents。
 *
 * 注册时机:在 main window 的 did-attach-webview 钩子里挂监听 — 任何 webview
 * did-navigate 到 AI 服务 URL(claude.ai / chatgpt.com / gemini.google.com)时
 * 注册为活跃 AI webview。SSE 拦截 + paste + send 全走这个 webContents。
 *
 * registry 模型:per-serviceId 单例(同一时刻每个服务最多一个活跃 webview);
 * 多 workspace 都嵌 AI Host webview 时,最后一个 navigate 的胜出(简化策略;
 * 实际多 ws 同时跟同一 AI 对话场景罕见,留待真实需求触发再迭代)。
 */

import type { WebContents } from 'electron';
import {
  detectAIServiceByUrl,
  type AIServiceId,
} from '@shared/types/ai-service-types';

const registry = new Map<AIServiceId, WebContents>();
const onAttachListeners = new Set<(serviceId: AIServiceId, wc: WebContents) => void>();

/**
 * 注册或更新某服务对应的活跃 webContents。
 * webContents destroy 时自动从 registry 移除。
 */
function setActiveWebContents(serviceId: AIServiceId, wc: WebContents): void {
  const prev = registry.get(serviceId);
  if (prev === wc) return;
  registry.set(serviceId, wc);
  console.log(
    `[ai-webview-registry] active ${serviceId} webview = wc#${wc.id}`,
  );
  // wc destroy 时清除
  wc.once('destroyed', () => {
    if (registry.get(serviceId) === wc) {
      registry.delete(serviceId);
      console.log(
        `[ai-webview-registry] ${serviceId} webview wc#${wc.id} destroyed, cleared`,
      );
    }
  });
  // 通知监听者(SSECaptureManager 跟随更换 webContents)
  for (const listener of onAttachListeners) {
    try {
      listener(serviceId, wc);
    } catch (err) {
      console.error('[ai-webview-registry] listener error:', err);
    }
  }
}

/**
 * 取某服务的活跃 webContents(askAI / pasteAndSend 用)。
 * 返 null 表示该服务的 AI Host webview 尚未挂载或还未 navigate 到对应 URL。
 */
export function getActiveAIWebContents(serviceId: AIServiceId): WebContents | null {
  const wc = registry.get(serviceId);
  if (!wc || wc.isDestroyed()) {
    registry.delete(serviceId);
    return null;
  }
  return wc;
}

/**
 * 订阅 "某服务的活跃 webContents 变更" 事件(SSECaptureManager 用,跟随 attach
 * 新 webview 时切换底层 webContents 重启拦截)。
 */
export function subscribeAttachAIWebContents(
  listener: (serviceId: AIServiceId, wc: WebContents) => void,
): () => void {
  onAttachListeners.add(listener);
  return () => {
    onAttachListeners.delete(listener);
  };
}

/**
 * 给 webContents 挂"AI URL 检测" — did-navigate 到 AI 服务页时注册到 registry。
 *
 * 在 main window did-attach-webview 钩子内对每个 guest webContents 调一次。
 * 多次调安全(checkAndRegister 内有同一 wc 防重)。
 */
export function trackWebContentsForAIService(wc: WebContents): void {
  const checkAndRegister = (url: string): void => {
    const profile = detectAIServiceByUrl(url);
    if (!profile) return;
    setActiveWebContents(profile.id, wc);
  };

  wc.on('did-navigate', (_e, url) => checkAndRegister(url));
  wc.on('did-navigate-in-page', (_e, url) => checkAndRegister(url));

  // 立即检查当前 URL(可能 attach 时已加载到 AI 页)
  const currentUrl = wc.getURL();
  if (currentUrl) checkAndRegister(currentUrl);
}
