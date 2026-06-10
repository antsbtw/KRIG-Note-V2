/**
 * X Webview Registry — 主进程跟踪「加载了 X 网页」的前台 webview
 *
 * 用途:提取推文走用户右槽实际可见的 X Host webview 的 webContents
 * (带登录态、所见即所得),不开隐藏窗口。
 *
 * 铁律 1(底座复用):did-navigate → detect → setActive → destroy 清除 的服务无关链路
 * 复用 web-service-base/createWebviewServiceRegistry,与 AI registry 同一底座;本文件只
 * 绑定 X 专属的 detectXServiceByUrl。
 *
 * 铁律 5(多 ws 扇出守卫):registry per-serviceId 单例,getActive 始终返回「最后一个
 * navigate 到 X 的活跃 webContents」。renderer 命令侧再用 getActiveId 定向到活跃 ws,
 * 两端配合避免「N 个并存 X view 实例各消费一次广播」。
 */

import type { WebContents } from 'electron';
import { detectXServiceByUrl, type XServiceId } from '@shared/types/x-service-types';
import { createWebviewServiceRegistry } from '../web-service-base';

const xRegistry = createWebviewServiceRegistry<XServiceId>(
  'x-webview-registry',
  (url) => detectXServiceByUrl(url)?.id ?? null,
);

/**
 * 取 X 服务的活跃 webContents(提取推文用)。
 * 返 null 表示 X Host webview 尚未挂载或还未 navigate 到 x.com / twitter.com。
 */
export function getActiveXWebContents(serviceId: XServiceId): WebContents | null {
  return xRegistry.getActive(serviceId);
}

/**
 * 给 webContents 挂「X URL 检测」— did-navigate 到 X 页时注册到 registry。
 * 在 main window did-attach-webview 钩子内对每个 guest webContents 调一次。
 */
export function trackWebContentsForXService(wc: WebContents): void {
  xRegistry.track(wc);
}
