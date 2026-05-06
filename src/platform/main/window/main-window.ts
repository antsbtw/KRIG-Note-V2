/**
 * 主 BrowserWindow 创建
 *
 * L1 窗口层职责:仅创建 BrowserWindow + 加载 renderer + 监听窗口事件。
 * Shell 视图(三栏布局等)在 L2 层完成,本文件不做。
 *
 * V1 学习参考:V1 createShell()(652 行)混合了 L1+L2+L4+L5,V2 拆开。
 */

import path from 'node:path';
import { BrowserWindow } from 'electron';
import { reportL1Alive } from '../diagnostics/L1-alive';
import { IPC_CHANNELS } from '@shared/ipc/channel-names';

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

let mainWindow: BrowserWindow | null = null;

const DEFAULT_WIDTH = 1200;
const DEFAULT_HEIGHT = 800;

export async function createMainWindow(): Promise<BrowserWindow> {
  const win = new BrowserWindow({
    width: DEFAULT_WIDTH,
    height: DEFAULT_HEIGHT,
    minWidth: 800,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 12, y: 10 },
    backgroundColor: '#1e1e1e',
    webPreferences: {
      // forge-vite 把 preload 输出到主进程构建目录(.vite/build/),
      // entry 'src/platform/main/preload/main-window-preload.ts' → 'main-window-preload.js'
      preload: path.join(__dirname, 'main-window-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // L5-B4:启用 <webview> tag(给 web view 嵌网页用)
      webviewTag: true,
    },
  });

  // L5-B4:拦截 webview 的 attach,强制安全配置(对齐 V1 will-attach-webview)
  // - contextIsolation: true / nodeIntegration: false 保证 guest 不能访问 Node
  // - 不设 preload(本阶段 webview 内不需要 IPC;后续 web-bridge epic 时再补)
  win.webContents.on('will-attach-webview', (_event, webPreferences) => {
    webPreferences.contextIsolation = true;
    webPreferences.nodeIntegration = false;
  });

  // 加载 renderer
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    await win.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    await win.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`));
  }

  // 窗口全屏状态变化 → 通知 renderer(用于 UI 自适应,如 NavSide Toggle 位置)
  win.on('enter-full-screen', () => {
    win.webContents.send(IPC_CHANNELS.WINDOW_FULLSCREEN_CHANGED, true);
  });
  win.on('leave-full-screen', () => {
    win.webContents.send(IPC_CHANNELS.WINDOW_FULLSCREEN_CHANGED, false);
  });

  // 窗口关闭时清理引用
  win.on('closed', () => {
    mainWindow = null;
  });

  mainWindow = win;
  reportL1Alive({
    windowId: win.id,
    width: DEFAULT_WIDTH,
    height: DEFAULT_HEIGHT,
  });

  return win;
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}
