/**
 * Mail Webview Registry — 主进程跟踪「加载了网页版邮箱」的前台 webview
 *
 * 用途:右键提取单封邮件时走用户实际可见的 Mail Host webview 的 webContents
 * (带登录态、所见即所得),不开隐藏窗口。
 *
 * 底座复用:did-navigate → detect → setActive → destroy 清除 的服务无关链路复用
 * web-service-base/createWebviewServiceRegistry,与 AI / X registry 同一底座;
 * 本文件只绑定邮箱专属的 detectMailServiceByUrl。
 *
 * ⚠️ 只导出 track,不导出 getActive —— 照 X 的收口形态(2026-06-11),不照 AI
 * (AI 还留着 @deprecated getActive 供 SSE subscribeAttach 用)。底座内部的
 * setActive 仍在跑,但**没有业务读 getActive**:全局「最后 navigate 胜出」不分 ws,
 * 多 ws 并存时会把操作打到用户没在看的那个实例。业务取实例一律走
 * mail-webcontents 的 requireMailWebContents(按活跃 ws 定向,fail loud)。
 */

import type { WebContents } from 'electron';
import {
  detectMailServiceByUrl,
  type MailServiceId,
} from '@shared/types/mail-service-types';
import { createWebviewServiceRegistry } from '../web-service-base';

const mailRegistry = createWebviewServiceRegistry<MailServiceId>(
  'mail-webview-registry',
  (url) => detectMailServiceByUrl(url)?.id ?? null,
);

/**
 * 给 webContents 挂「邮箱 URL 检测」— did-navigate 到邮箱页时注册到 registry。
 * 在 main window did-attach-webview 钩子内对每个 guest webContents 调一次。
 */
export function trackWebContentsForMailService(wc: WebContents): void {
  mailRegistry.track(wc);
}
