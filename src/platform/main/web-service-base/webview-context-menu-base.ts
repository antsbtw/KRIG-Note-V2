/**
 * 服务无关的 webview 原生右键菜单底座(铁律 1)
 *
 * 背景:AI view 与 X view 都需要「在某服务页右键 → 弹原生菜单项 → 点击把 guest viewport
 * 坐标 (params.x/y) 经 IPC 推回 renderer,由 renderer 命令完成定位+抽取+落 note」。
 * Menu.popup 弹在光标位置、坐标随 IPC 上送供 guest 端 elementFromPoint 定位的模式与
 * 具体服务无关,抽成泛型底座。各服务传入「URL 是否属于本服务」+「菜单项模板」即可。
 *
 * 注:Menu.popup 不传 x/y → 弹在光标位置(params.x/y 是 guest viewport 坐标,弹窗用需叠
 * 加 webview 窗口内偏移;光标定位免换算)。坐标本身仍随 IPC 上送供 guest 端 elementFromPoint
 * 定位用 —— 那是 guest viewport 坐标,正合适。
 */

import {
  Menu,
  type BrowserWindow,
  type ContextMenuParams,
  type MenuItemConstructorOptions,
  type WebContents,
} from 'electron';

export interface WebviewContextMenuOptions {
  /** 本服务的宿主窗口(Menu.popup 用) */
  mainWindow: BrowserWindow;
  /** 触发右键的 guest webContents */
  guest: WebContents;
  /** 右键事件参数(含 guest viewport 坐标 x/y) */
  params: ContextMenuParams;
}

/**
 * 给一个 guest webContents 挂原生右键菜单(仅当 URL 属于本服务时弹)。
 *
 * @param mainWindow    宿主窗口
 * @param guest         guest webContents
 * @param belongsToService  URL 是否属于本服务(命中才弹菜单)
 * @param buildTemplate 构造菜单项模板(返空数组 = 不弹)
 */
export function attachWebviewContextMenu(
  mainWindow: BrowserWindow,
  guest: WebContents,
  belongsToService: (url: string) => boolean,
  buildTemplate: (opts: WebviewContextMenuOptions) => MenuItemConstructorOptions[],
): void {
  guest.on('context-menu', (_e, params: ContextMenuParams) => {
    if (!belongsToService(guest.getURL())) return;
    const template = buildTemplate({ mainWindow, guest, params });
    if (template.length === 0) return;
    const menu = Menu.buildFromTemplate(template);
    menu.popup({ window: mainWindow });
  });
}
