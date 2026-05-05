/**
 * KRIG Note 主进程入口
 *
 * L0 平台层 + L1 窗口层。仅做 L0+L1 责任,其他层通过 boot hooks 注入(后期)。
 *
 * 启动流程:
 * 1. app.setName / dock.setIcon(macOS 应用菜单 + dock 图标取此为名)
 * 2. app.whenReady → L0 alive 诊断
 * 3. 初始化 IPC 总线(健康检查 handlers)
 * 4. 创建主窗口 → L1 alive 诊断
 * 5. 监听 lifecycle 事件
 */

import path from 'node:path';
import { app, BrowserWindow, nativeImage } from 'electron';
import { createMainWindow } from './window/main-window';
import { initIpcBus } from './ipc/ipc-bus';
import { reportL0Alive } from './diagnostics/L0-alive';
import { registerFrameworkMenus } from './menu/framework-menus';

// 必须在 whenReady 之前调用 — macOS 应用菜单首项 Bold 名取自 app.name
app.setName('KRIG Note');

app.whenReady().then(async () => {
  // macOS dock 图标(dev 模式)— 走 app.getAppPath() 找项目根 → build/icon.png
  // prod 包构建走 forge.config packagerConfig.icon(.icns)
  if (process.platform === 'darwin' && app.dock) {
    const iconPath = path.join(app.getAppPath(), 'build', 'icon.png');
    const image = nativeImage.createFromPath(iconPath);
    if (!image.isEmpty()) app.dock.setIcon(image);
  }
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
