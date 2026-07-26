/**
 * 主 BrowserWindow 创建
 *
 * L1 窗口层职责:仅创建 BrowserWindow + 加载 renderer + 监听窗口事件。
 * Shell 视图(三栏布局等)在 L2 层完成,本文件不做。
 *
 * V1 学习参考:V1 createShell()(652 行)混合了 L1+L2+L4+L5,V2 拆开。
 */

import path from 'node:path';
import { BrowserWindow, ipcMain, nativeTheme, shell } from 'electron';
import { reportL1Alive } from '../diagnostics/L1-alive';
import { IPC_CHANNELS } from '@shared/ipc/channel-names';
import { detectXServiceByUrl } from '@shared/types/x-service-types';
import { applyWsConfigToSession, wsSetHasWindow } from '../workspace/workspace-manager-main';
import { themeBgColor } from '../ipc/native-theme-handler';

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

const windowRegistry = new Map<number, { win: BrowserWindow; wsId: string | null }>();

/**
 * 每窗口 webview 钩子回调 —— 多窗口(S3-b)根治点。
 *
 * 背景:AI / X / 普通 web 的原生右键菜单、快捷键、PDF 提取拦截、media:// 补注册 全部
 * 走 `mainWindow.webContents.on('did-attach-webview')`。历史上这些 hook 只在**第一个**
 * mainWindow 上挂一次(index.ts),导致 New Window / 恢复出的**次级窗口**里的 webview
 * 没有 did-attach-webview 监听 → 右键菜单弹不出来 / 快捷键失效 / 提取失效。
 *
 * 修法:index.ts 注入本回调,createWindow 对**每个**新窗口调一次,把纯 per-window 的
 * did-attach-webview 类 hook 挂到该窗口。全局单例 hook(will-download 会话级、各 ipcMain
 * handler)仍在 index.ts 一次性注册,不进本回调。
 */
let perWindowWebviewHooks: ((win: BrowserWindow) => void) | null = null;
export function setPerWindowWebviewHooks(cb: (win: BrowserWindow) => void): void {
  perWindowWebviewHooks = cb;
}

// app.quit() 时所有窗口连带关闭，此时不应清除 hasWindow（否则重启后只剩一个窗口）
let appIsQuitting = false;
export function markAppQuitting(): void { appIsQuitting = true; }

// renderer 启动后主动 invoke 来获取自己的 wsId（比 push 方式更可靠，避免 loadURL 完成
// 与 preload 脚本注册监听器之间的竞态）。
ipcMain.handle(IPC_CHANNELS.WINDOW_GET_WS_ID, (event) => {
  const webContentsId = event.sender.id;
  for (const { win, wsId } of windowRegistry.values()) {
    if (win.webContents.id === webContentsId) return wsId ?? null;
  }
  return null;
});

const DEFAULT_WIDTH = 1200;
const DEFAULT_HEIGHT = 800;

export async function createWindow(wsId?: string): Promise<BrowserWindow> {
  const win = new BrowserWindow({
    width: DEFAULT_WIDTH,
    height: DEFAULT_HEIGHT,
    minWidth: 800,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 12, y: 10 },
    backgroundColor: themeBgColor(nativeTheme.shouldUseDarkColors),
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

  // loadURL 前先入注册表：renderer 在 loadURL 过程中可能 invoke WINDOW_GET_WS_ID，
  // handler 需要能在 windowRegistry 里找到这个窗口。
  windowRegistry.set(win.id, { win, wsId: wsId ?? null });

  // 窗口有独立 BrowserWindow — 记录到 ws 状态，启动恢复时据此判断开几个窗口
  if (wsId) wsSetHasWindow(wsId, true);

  // 窗口关闭时：清注册表；仅在用户手动关单窗口时清 hasWindow（app 退出时保留状态供下次恢复）
  win.on('closed', () => {
    const entry = windowRegistry.get(win.id);
    windowRegistry.delete(win.id);
    if (entry?.wsId && !appIsQuitting) wsSetHasWindow(entry.wsId, false);
  });

  // 多窗口(S3-b)：每个窗口都挂 per-window webview 钩子（右键菜单/快捷键/提取/media）。
  // 必须在 loadURL 之前挂 —— did-attach-webview 在 renderer 加载 <webview> 时即触发，
  // 晚挂会漏掉首个 guest（次级窗口右键菜单弹不出来的历史根因）。
  perWindowWebviewHooks?.(win);

  // 加载 renderer
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    await win.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    await win.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`));
  }

  // 多窗口:renderer 就绪后立即推送本窗口绑定的 wsId(push 补充路径，invoke 是主路径)
  if (wsId) {
    win.webContents.send(IPC_CHANNELS.WINDOW_WS_ID, wsId);
    // 应用 workspace 代理/UA 配置到 session（异步，不阻塞窗口显示）
    void applyWsConfigToSession(wsId);
  }

  // 窗口全屏状态变化 → 通知 renderer(用于 UI 自适应,如 NavSide Toggle 位置)
  win.on('enter-full-screen', () => {
    win.webContents.send(IPC_CHANNELS.WINDOW_FULLSCREEN_CHANGED, true);
  });
  win.on('leave-full-screen', () => {
    win.webContents.send(IPC_CHANNELS.WINDOW_FULLSCREEN_CHANGED, false);
  });
  reportL1Alive({
    windowId: win.id,
    width: DEFAULT_WIDTH,
    height: DEFAULT_HEIGHT,
  });

  return win;
}

// 向后兼容，S3/S4 完成后再删
export async function createMainWindow(): Promise<BrowserWindow> {
  return createWindow();
}

export function getWindow(windowId: number): BrowserWindow | null {
  return windowRegistry.get(windowId)?.win ?? null;
}

export function getAllWindows(): BrowserWindow[] {
  return Array.from(windowRegistry.values()).map((e) => e.win);
}

export function getFocusedWindowWsId(): string | null {
  const focused = BrowserWindow.getFocusedWindow();
  if (!focused) return null;
  return windowRegistry.get(focused.id)?.wsId ?? null;
}

export function getWindowByWsId(wsId: string): BrowserWindow | null {
  for (const { win, wsId: wid } of windowRegistry.values()) {
    if (wid === wsId) return win;
  }
  return null;
}

// 向后兼容：返回注册表第一个窗口，S3/S4 完成后逐步替换调用方
export function getMainWindow(): BrowserWindow | null {
  const first = windowRegistry.values().next().value;
  return first?.win ?? null;
}
