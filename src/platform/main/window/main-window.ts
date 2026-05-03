/**
 * 主 BrowserWindow 创建
 *
 * L1 窗口层职责:仅创建 BrowserWindow + 加载 renderer + 监听窗口事件。
 * Shell 视图(三栏布局等)在 L2 层完成,本文件不做。
 *
 * V1 学习参考:V1 createShell()(652 行)混合了 L1+L2+L4+L5,V2 拆开。
 */

import { BrowserWindow } from 'electron';
import { reportL1Alive } from '../diagnostics/L1-alive';

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
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // 加载 renderer
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    await win.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    const path = await import('node:path');
    await win.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`));
  }

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
