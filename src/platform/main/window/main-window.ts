/**
 * 主 BrowserWindow 创建
 *
 * L1 窗口层职责:仅创建 BrowserWindow + 加载 renderer + 监听窗口事件。
 * Shell 视图(三栏布局等)在 L2 层完成,本文件不做。
 *
 * V1 学习参考:V1 createShell()(652 行)混合了 L1+L2+L4+L5,V2 拆开。
 */

import path from 'node:path';
import { BrowserWindow, shell } from 'electron';
import { reportL1Alive } from '../diagnostics/L1-alive';
import { IPC_CHANNELS } from '@shared/ipc/channel-names';
import { detectXServiceByUrl } from '@shared/types/x-service-types';

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
    // 网页视频 HTML5 全屏 与 app 窗口原生全屏 解耦:
    // 默认 Electron 会让 guest 的 requestFullscreen 连带把宿主 BrowserWindow 也推进
    // macOS 原生全屏 → 两层绑定,一次 ESC 同时塌缩(退视频又退 app 全屏,体验突兀)。
    // 设此项后,网页全屏只在 webview 区域内进行、不动宿主窗口 → ESC 只退视频全屏,
    // app 窗口全屏成为完全独立的事(走系统绿灯)。
    webPreferences.disableHtmlFullscreenWindowResize = true;
  });

  // ── 宿主 renderer 自身的 window.open 拦截 ──
  //
  // 注意:webview 的 window.open 由 web-shortcuts/handler 在 guest 上 setWindowOpenHandler
  // 处理;但**宿主页面内的 <iframe>**(如 Note 里 tweet block 的 platform.twitter.com 官方
  // 嵌入卡片)发起的 window.open 冒到的是**宿主 win.webContents**,不经那套 → Electron
  // 默认开一个独立 BrowserWindow 弹窗(无登录态、飞出工作空间)。这里统一兜底:
  // - x.com / twitter.com 链接(tweet 卡片点「Read replies」/ 作者 / 原推)→ deny 弹窗,
  //   改经 IPC 通知 renderer 用 x-view.open-tweet 在 X webview 内打开(登录态 + 留在 app);
  // - 其余外链 → 系统浏览器(openExternal),不开裸 BrowserWindow。
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (detectXServiceByUrl(url)) {
      win.webContents.send(IPC_CHANNELS.X_OPEN_TWEET_REQUEST, { url });
      return { action: 'deny' };
    }
    if (/^https?:\/\//.test(url)) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
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
