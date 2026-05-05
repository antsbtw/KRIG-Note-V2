/**
 * KRIG-Note V2 主进程入口
 *
 * L0 平台层 + L1 窗口层。仅做 L0+L1 责任,其他层通过 boot hooks 注入(后期)。
 *
 * 启动流程:
 * 1. app.whenReady → L0 alive 诊断
 * 2. 初始化 IPC 总线(健康检查 handlers)
 * 3. 创建主窗口 → L1 alive 诊断
 * 4. 监听 lifecycle 事件
 */

import { app, BrowserWindow } from 'electron';
import { createMainWindow } from './window/main-window';
import { initIpcBus } from './ipc/ipc-bus';
import { reportL0Alive } from './diagnostics/L0-alive';
import { registerFrameworkMenus } from './menu/framework-menus';

app.whenReady().then(async () => {
  // L0 — 平台层就绪
  reportL0Alive();

  // L0 — IPC 总线(含健康检查 handlers)
  initIpcBus();

  // L4 — 框架级 Application Menu(取代 Electron 默认 File/Edit/View/Window)
  registerFrameworkMenus();

  // L1 — 主窗口
  await createMainWindow();
});

// macOS:窗口全关后,点 dock 重新打开
app.on('activate', async () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    await createMainWindow();
  }
});

// 非 macOS:窗口全关后退出
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
