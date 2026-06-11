/**
 * X Webview Hook — 给 mainWindow 挂 did-attach-webview,任何 guest webview 都丢给
 * x-webview-registry 跟踪 did-navigate 到 x.com / twitter.com 自动注册为活跃。
 *
 * 另:在 X 页挂原生右键菜单「提取此推文到笔记」—— click 把 guest viewport 坐标
 * (params.x/y) 经 X_EXTRACT_TWEET_REQUEST 推回 renderer,由 x-view.extract-tweet
 * 命令完成「定位单条推文 → 抽取 → 构造 tweetBlock → 落右槽 / 当前 Note」。
 *
 * 铁律 1(底座复用):registry track + 右键 Menu.popup + 坐标上送 全复用 web-service-base,
 * 与 AI hook 同一底座,只换 X 专属的 URL 判定 + 菜单文案。
 *
 * 注:普通浏览的 web-context-menu / 快捷键 / 弹窗导流 钩子的 shouldHandle 已按 X URL 排除
 * X webview(X 与 AI / 浏览器同 ws 共用 persist:webview-${ws} partition,靠 URL 而非
 * partition 区分),故这里弹的菜单与那边不冲突。
 *
 * 调用时机:platform/main/index.ts 在 createMainWindow 后调一次,跟 registerAIWebviewHook 平级。
 */

import {
  type BrowserWindow,
  type MenuItemConstructorOptions,
} from 'electron';
import { IPC_CHANNELS } from '@shared/ipc/channel-names';
import { detectXServiceByUrl } from '@shared/types/x-service-types';
import { attachWebviewContextMenu } from '../web-service-base';
import { trackWebContentsForXService } from './webview-registry';

export function registerXWebviewHook(mainWindow: BrowserWindow): void {
  mainWindow.webContents.on('did-attach-webview', (_event, guestWebContents) => {
    trackWebContentsForXService(guestWebContents);

    attachWebviewContextMenu(
      mainWindow,
      guestWebContents,
      (url) => detectXServiceByUrl(url) !== null,
      ({ guest, params }) => {
        const service = detectXServiceByUrl(guest.getURL());
        if (!service) return [];
        // 写方向(发推/回复)已改为「拖 note block 到 X」交互,故右键只保留读方向的
        // 「提取此推文到笔记」。原「✍️ 在 note 里写回复」「𝕏 发到这里(发推)」两项已去掉
        // (拖拽验证通过,总指挥拍板移除)。
        const template: MenuItemConstructorOptions[] = [
          {
            label: '📥 提取此推文到笔记',
            click: () => {
              mainWindow.webContents.send(IPC_CHANNELS.X_EXTRACT_TWEET_REQUEST, {
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
