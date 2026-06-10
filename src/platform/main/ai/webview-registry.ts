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
 *
 * 铁律 1(底座复用):注册/识别/destroy 清除/attach 监听 的服务无关链路已抽到
 * web-service-base/createWebviewServiceRegistry;本文件只提供 AI 专属的 detectByUrl
 * 绑定 + 保留历史导出名(consumers 依赖)。X view 复用同一底座。
 */

import type { WebContents } from 'electron';
import {
  detectAIServiceByUrl,
  type AIServiceId,
} from '@shared/types/ai-service-types';
import { createWebviewServiceRegistry } from '../web-service-base';

const aiRegistry = createWebviewServiceRegistry<AIServiceId>(
  'ai-webview-registry',
  (url) => detectAIServiceByUrl(url)?.id ?? null,
);

/**
 * 取某服务的活跃 webContents(askAI / pasteAndSend 用)。
 * 返 null 表示该服务的 AI Host webview 尚未挂载或还未 navigate 到对应 URL。
 */
export function getActiveAIWebContents(serviceId: AIServiceId): WebContents | null {
  return aiRegistry.getActive(serviceId);
}

/**
 * 订阅 "某服务的活跃 webContents 变更" 事件(SSECaptureManager 用,跟随 attach
 * 新 webview 时切换底层 webContents 重启拦截)。
 */
export function subscribeAttachAIWebContents(
  listener: (serviceId: AIServiceId, wc: WebContents) => void,
): () => void {
  return aiRegistry.subscribeAttach(listener);
}

/**
 * 给 webContents 挂"AI URL 检测" — did-navigate 到 AI 服务页时注册到 registry。
 *
 * 在 main window did-attach-webview 钩子内对每个 guest webContents 调一次。
 * 多次调安全(底座内 setActive 对同一 wc 防重)。
 */
export function trackWebContentsForAIService(wc: WebContents): void {
  aiRegistry.track(wc);
}
