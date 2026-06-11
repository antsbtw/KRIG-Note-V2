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

import { webContents, type WebContents } from 'electron';
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
 * 取某服务的活跃 webContents(全局「最后 navigate 胜出」单例)。
 *
 * @deprecated 多 ws / 内置浏览器+AI-view 并存时会取错实例(注入打到用户没在看的框)。
 *   业务调用一律改走 {@link resolveAIWebContents}(按 renderer 传来的 targetWcId 定向)。
 *   本函数仅留给底座内部 detect 链路;新代码勿用。
 */
export function getActiveAIWebContents(serviceId: AIServiceId): WebContents | null {
  return aiRegistry.getActive(serviceId);
}

/**
 * 按 renderer 指定的 guest wc id 精确定位 AI Host webContents(按活跃 ws 定向)。
 *
 * 治多实例串扰 bug:renderer 侧 ai-host-registry 按活跃 ws 查出本 ws 的 AI Host guest
 * wc id,经 IPC 透传到这里 webContents.fromId 精确取 —— 不再用全局「最后 navigate」猜。
 *
 * **fail loud(§3.2 总指挥拍板,与 X 的「回退全局」不同)**:targetWcId 缺失 / 对应 wc
 * 已销毁 / 当前不是该 AI 服务页 → 返回明确 error,**绝不静默回退 getActiveAIWebContents**
 * (回退等于没修)。调用方据 error 决定 fail loud(broadcast / 返回失败)。
 *
 * @param serviceId 期望的 AI 服务(校验目标 wc 当前 URL 属于该服务)
 * @param targetWcId renderer 传来的本活跃 ws 的 AI Host guest wc id(undefined/null = 未登记)
 */
export function resolveAIWebContents(
  serviceId: AIServiceId,
  targetWcId: number | null | undefined,
): { wc: WebContents } | { error: string } {
  if (typeof targetWcId !== 'number') {
    return {
      error: `当前 workspace 的 ${serviceId} AI 实例未就绪(未登记 wc id)— 请确保 AI 页已加载`,
    };
  }
  const wc = webContents.fromId(targetWcId);
  if (!wc || wc.isDestroyed()) {
    return {
      error: `指定的 AI 实例(wc#${targetWcId})不存在或已销毁 — 请重新打开 AI 页`,
    };
  }
  const detected = detectAIServiceByUrl(wc.getURL());
  if (detected?.id !== serviceId) {
    return {
      error: `指定的 AI 实例(wc#${targetWcId})当前不是 ${serviceId} 页面(实为 ${detected?.id ?? '非 AI 页'}),无法操作`,
    };
  }
  return { wc };
}

/**
 * 同 {@link resolveAIWebContents} 但带 poll —— 给「问 AI / paste+send」用:
 * renderer 点「问 AI」后 AIView mount → webview navigate → dom-ready 才登记 wc id,
 * 这条链路 1-3s;poll 等本 ws 的 wc 就绪(仍 fail loud,只是给足等待窗口)。
 */
export async function resolveAIWebContentsWithWait(
  serviceId: AIServiceId,
  targetWcId: number | null | undefined,
  timeoutMs = 10_000,
): Promise<{ wc: WebContents } | { error: string }> {
  const start = Date.now();
  let last = resolveAIWebContents(serviceId, targetWcId);
  while ('error' in last && Date.now() - start < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, 200));
    last = resolveAIWebContents(serviceId, targetWcId);
  }
  return last;
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
