/**
 * AI Webview Hook — 给 mainWindow 挂 did-attach-webview,任何 guest webview
 * 都丢给 ai-webview-registry 跟踪 did-navigate 到 AI URL 自动注册为活跃。
 *
 * 另:在 AI 服务页(本期仅 Claude)挂原生右键菜单「📥 提取此对话到笔记」——
 * 对齐 web-context-menu/handler.ts 的 Menu.popup 模式(原生菜单能盖在 webview 上、
 * 坐标准)。click 把 guest viewport 坐标 (params.x/y) 经 AI_EXTRACT_TURN_REQUEST 推回
 * renderer,由 ai-view.extract-turn 命令完成「定位单条 → 抽取 → 落右槽 Note」。
 *
 * 注:普通浏览的 web-context-menu/handler.ts 对 AI webview 显式 return(shouldHandle
 * 过滤掉 AI 页),故这里弹的菜单与那边不冲突,Claude 页只会出本菜单。
 *
 * 调用时机:platform/main/index.ts 在 createMainWindow 后调一次,
 * 跟 registerWebviewExtractionHook 平级。
 */

import {
  Menu,
  type BrowserWindow,
  type ContextMenuParams,
  type MenuItemConstructorOptions,
} from 'electron';
import { IPC_CHANNELS } from '@shared/ipc/channel-names';
import { detectAIServiceByUrl } from '@shared/types/ai-service-types';
import { trackWebContentsForAIService } from './webview-registry';

export function registerAIWebviewHook(mainWindow: BrowserWindow): void {
  mainWindow.webContents.on('did-attach-webview', (_event, guestWebContents) => {
    console.log('[ai-webview-hook] did-attach-webview, guest id=', guestWebContents.id);
    trackWebContentsForAIService(guestWebContents);

    // 原生右键菜单(Claude / ChatGPT / Gemini)
    guestWebContents.on('context-menu', (_e, params: ContextMenuParams) => {
      const service = detectAIServiceByUrl(guestWebContents.getURL());
      if (!service) return;

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

      const menu = Menu.buildFromTemplate(template);
      // 不传 x/y,弹在光标位置(params.x/y 是 guest viewport 坐标,弹窗用需叠加
      // webview 窗口内偏移;光标定位免换算且天然贴鼠标)。坐标本身仍随 IPC 上送供
      // guest 端 elementFromPoint 定位用 —— 那是 guest viewport 坐标,正合适。
      menu.popup({ window: mainWindow });
    });
  });
}
