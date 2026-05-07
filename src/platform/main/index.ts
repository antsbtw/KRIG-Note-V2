/**
 * KRIG Note 主进程入口
 *
 * L0 平台层 + L1 窗口层。仅做 L0+L1 责任,其他层通过 boot hooks 注入(后期)。
 *
 * 启动流程:
 * 1. app.whenReady → L0 alive 诊断
 * 2. 初始化 IPC 总线(健康检查 handlers)
 * 3. 创建主窗口 → L1 alive 诊断
 * 4. 监听 lifecycle 事件
 *
 * 应用名 / dock 图标:
 * - dev:scripts/patch-electron-dev.sh(postinstall 钩子)直接改 node_modules 的
 *   Electron.app/Contents/Info.plist + 替换 electron.icns。一次性,重装 electron 时自动重跑。
 * - prod:forge.config packagerConfig.name + icon(.icns)
 *
 * V1 教训:macOS 应用菜单首项 Bold 名取自 Info.plist 的 CFBundleName,
 * 不是 app.setName()。dev 必须 patch Info.plist 才能改首项。
 */

import { app, BrowserWindow, protocol } from 'electron';
import { createMainWindow } from './window/main-window';
import { initIpcBus } from './ipc/ipc-bus';
import { reportL0Alive } from './diagnostics/L0-alive';
import { registerFrameworkMenus } from './menu/framework-menus';
import { mediaStore } from './media/media-store-impl';

// L5-B3.5:把 media: 注册为"特权协议"(必须在 app ready 之前调)
// - standard: true     让 URL 解析按 http 同款规则(host / path / origin)
// - secure: true       浏览器视为 secure context(允许 Service Worker / Subresource Integrity 等)
// - supportFetchAPI:   ★ 关键 ★ 允许 fetch() / XMLHttpRequest 加载 media:// URL
//                       否则 Chromium 报 "URL scheme \"media\" is not supported"(SVG block 必需)
// - corsEnabled: true  允许跨 origin 加载(media:// 默认 origin 不同)
// - bypassCSP:         renderer CSP 仍生效;靠 index.html meta 配置 img-src/connect-src 白名单
//
// 这一步早于 protocol.handle('media', ...)(在 mediaStore.registerProtocol 内)
// 也早于 mainWindow 创建,跟 Electron 文档 protocol.registerSchemesAsPrivileged 要求一致
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'media',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
]);

app.whenReady().then(async () => {
  // L0 — 平台层就绪
  reportL0Alive();

  // L0 — IPC 总线(含健康检查 handlers)
  initIpcBus();

  // L0/L5-B4.3.1 — 注册 media:// 协议
  // 必须早于 createMainWindow,否则 webview 加载 media:// 会 ERR_FILE_NOT_FOUND
  mediaStore.registerProtocol();

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
