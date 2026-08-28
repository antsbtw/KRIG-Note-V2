/**
 * Mail Webview Hook — 给 mainWindow 挂 did-attach-webview,任何 guest webview 都丢给
 * mail-webview-registry 跟踪,did-navigate 到网页版邮箱时自动注册为活跃。
 *
 * 另:在邮箱页挂原生右键菜单「提取此邮件到笔记」—— click 把 guest viewport 坐标
 * (params.x/y) 经 MAIL_EXTRACT_REQUEST 推回 renderer,由 mail-view.extract 命令完成
 * 「定位单封邮件 → 抽取 → 落 note」。
 *
 * 底座复用:registry track + 右键 Menu.popup + 坐标上送 全复用 web-service-base,
 * 与 AI / X hook 同一底座,只换邮箱专属的 URL 判定 + 菜单文案。
 *
 * ⚠️ 前置依赖:web-shared/should-handle.ts 必须已把邮箱 URL 排除出「普通浏览」,
 * 否则普通浏览的右键菜单钩子也会接管邮箱页 —— 两套菜单同时弹。
 *
 * 调用时机:platform/main/index.ts 的 setPerWindowWebviewHooks 回调内,
 * 跟 registerAIWebviewHook / registerXWebviewHook 平级。
 * ⚠️ 必须挂进那个**每窗口**回调,不能只挂第一个 mainWindow ——
 * 否则次级窗口的邮箱 webview 右键菜单弹不出来(per-window-webview-hooks 铁律)。
 */

import {
  type BrowserWindow,
  type MenuItemConstructorOptions,
} from 'electron';
import { IPC_CHANNELS } from '@shared/ipc/channel-names';
import { detectMailServiceByUrl } from '@shared/types/mail-service-types';
import { attachWebviewContextMenu } from '../web-service-base';
import { trackWebContentsForMailService } from './webview-registry';

export function registerMailWebviewHook(mainWindow: BrowserWindow): void {
  mainWindow.webContents.on('did-attach-webview', (_event, guestWebContents) => {
    trackWebContentsForMailService(guestWebContents);

    attachWebviewContextMenu(
      mainWindow,
      guestWebContents,
      (url) => detectMailServiceByUrl(url) !== null,
      ({ guest, params }) => {
        const service = detectMailServiceByUrl(guest.getURL());
        if (!service) return [];
        const template: MenuItemConstructorOptions[] = [
          {
            label: '📥 提取此邮件到笔记',
            click: () => {
              mainWindow.webContents.send(IPC_CHANNELS.MAIL_EXTRACT_REQUEST, {
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
