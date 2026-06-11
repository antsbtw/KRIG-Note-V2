/**
 * AI Webview Hook — 给 mainWindow 挂 did-attach-webview,任何 guest webview
 * 都丢给 ai-webview-registry 跟踪 did-navigate 到 AI URL 自动注册为活跃。
 *
 * 另:在 AI 服务页(Claude / ChatGPT / Gemini)挂原生右键菜单「📥 提取此对话到笔记」——
 * 对齐 web-context-menu/handler.ts 的 Menu.popup 模式(原生菜单能盖在 webview 上、
 * 坐标准)。click 把 guest viewport 坐标 (params.x/y) 经 AI_EXTRACT_TURN_REQUEST 推回
 * renderer,由 ai-view.extract-turn 命令完成「定位单条 → 抽取 → 落右槽 Note」。
 *
 * 注:普通浏览的 web-context-menu/handler.ts 对 AI webview 显式 return(shouldHandle
 * 过滤掉 AI 页),故这里弹的菜单与那边不冲突,Claude 页只会出本菜单。
 *
 * 铁律 1(底座复用):右键菜单 Menu.popup + 坐标上送的服务无关链路已抽到
 * web-service-base/attachWebviewContextMenu;本文件只提供 AI 专属的 URL 判定 +
 * 菜单项文案。X view 复用同一底座(自带「提取此推文到笔记」文案)。
 *
 * 调用时机:platform/main/index.ts 在 createMainWindow 后调一次,
 * 跟 registerWebviewExtractionHook 平级。
 */

import {
  type BrowserWindow,
  type MenuItemConstructorOptions,
} from 'electron';
import { IPC_CHANNELS } from '@shared/ipc/channel-names';
import { detectAIServiceByUrl } from '@shared/types/ai-service-types';
import { attachWebviewContextMenu } from '../web-service-base';
import { trackWebContentsForAIService } from './webview-registry';

export function registerAIWebviewHook(mainWindow: BrowserWindow): void {
  mainWindow.webContents.on('did-attach-webview', (_event, guestWebContents) => {
    console.log('[ai-webview-hook] did-attach-webview, guest id=', guestWebContents.id);
    trackWebContentsForAIService(guestWebContents);

    // 原生右键菜单(Claude / ChatGPT / Gemini)— 走服务无关底座
    attachWebviewContextMenu(
      mainWindow,
      guestWebContents,
      (url) => detectAIServiceByUrl(url) !== null,
      ({ guest, params }) => {
        const service = detectAIServiceByUrl(guest.getURL());
        if (!service) return [];
        const template: MenuItemConstructorOptions[] = [
          {
            label: '📥 提取此对话到笔记',
            click: () => {
              mainWindow.webContents.send(IPC_CHANNELS.AI_EXTRACT_TURN_REQUEST, {
                serviceId: service.id,
                x: params.x,
                y: params.y,
              });
            },
          },
        ];
        return template;
      },
    );
  });
}
