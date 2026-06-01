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
import { registerMarkdownImport } from './markdown-import';
import { registerWordImport } from './word-import';
import { registerImportCacheIpc } from './word-import/import-cache';
import { registerProgressBridge } from './window/progress-bridge';
import { registerBackupMenu } from './backup';
import { mediaStore } from './media/media-store-impl';
import { registerWebviewExtractionHook } from './extraction/handlers';
import { registerAIWebviewHook } from './ai';
import { registerWebContextMenuHook } from './web-context-menu/handler';
import { registerWebShortcutsHook } from './web-shortcuts/handler';
import { registerWebDownloadHook } from './web-download/handler';
import { registerWebProxyHandler } from './web-proxy/handler';
import { registerWebSettingsHandler } from './web-settings/handler';
import { initStorage, shutdownStorageSync } from '@storage/index';
import { clearLegacyGraphStorage } from './graph/migration';
import { runMigration021IfNeeded } from '@storage/migrations/021-clear-all';
import { runMigration022IfNeeded } from '@storage/migrations/022-ebook-thought';
import { runMigration023IfNeeded } from '@storage/migrations/023-note-title-cache';

// L5-B3.5:把 media: 注册为"特权协议"(必须在 app ready 之前调)
// - standard: true     让 URL 解析按 http 同款规则(host / path / origin)
// - secure: true       浏览器视为 secure context(允许 Service Worker / Subresource Integrity 等)
// - supportFetchAPI:   ★ 关键 ★ 允许 fetch() / XMLHttpRequest 加载 media:// URL
//                       否则 Chromium 报 "URL scheme \"media\" is not supported"(SVG block 必需)
// - corsEnabled: true  允许跨 origin 加载(media:// 默认 origin 不同)
// - stream:     true   ★ L5-B3.16 ★ 允许 <video> / <audio> 元素加载本协议
//                       缺它 → audio/video 元素根本不发请求,显 0:00/0:00 静默失败
//                       (Electron docs: "Whether requests for this protocol should
//                        be supported by <video> and <audio> HTML tags")
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
      stream: true,
    },
  },
]);

app.whenReady().then(async () => {
  // L0 — 平台层就绪
  reportL0Alive();

  // L0 — IPC 总线(含健康检查 handlers)
  initIpcBus();

  // L7 — Storage (SurrealDB Sidecar) 基础设施初始化
  // 业务 store 尚未接入;本步仅启动 SurrealDB + 跑 schema migration。
  const storageStartedAt = Date.now();
  try {
    await initStorage();
    console.log(`[storage] cold-start latency: ${Date.now() - storageStartedAt}ms`);
  } catch (err) {
    console.error('[storage] init failed:', err);
  }

  // L7-sub3a-1 (decision 014 §3.6) — 清旧 graph 磁盘 JSON
  // 必须在 initStorage 后 + graph-library-store 任何 IPC 调用前 (initIpcBus 已注册 handlers
  // 但用户尚未触发 IPC,此处幂等清理)。
  clearLegacyGraphStorage();

  // L7-sub021 (decision 021 §7) — clearAll migration:folder 视图隔离重置数据库
  // 必须在 initStorage 后 + createMainWindow 前(IPC handlers 已注册,但 mainWindow 未创建,
  // 无 webContents 触发业务请求,此窗口期内执行 clearAll 安全)。
  // 用户拍板:测试数据可重置 (§0.5)。flag 写入后绝不重跑。
  try {
    await runMigration021IfNeeded();
  } catch (err) {
    console.error('[migration/021] 执行失败,启动下次会重试:', err);
  }

  // L7-sub022 (decision 022 §7) — ebook + annotation → atom 体系迁移
  // 必须严格在 021 之后跑 (021 已 clearAll 全部数据,022 起点是空数据库 + 旧 JSON store)。
  // L3 末段互斥扫描 fail 时不写 flag, 启动下次重试 (沿决议 §4.3.1-L3 字面 + §0.2 字面纪律).
  try {
    await runMigration022IfNeeded();
  } catch (err) {
    console.error('[migration/022] 执行失败,启动下次会重试:', err);
  }

  // sub-phase 023 — 回填老 note attrs.title 缓存(2026-05-28)
  // listNotes / listNoteTitles 走快路径前提是 container payload 含 attrs.title。
  // 新建/更新 note 已写入,本 migration 一次性补老数据。
  //
  // **不 await** — backfill 可能耗时 N 篇 × 200ms,不阻塞窗口启动;
  // 进行中若调 listNoteTitles 仍走 fallback assemble(慢但能用),
  // backfill 完成后下次启动走快路径
  void runMigration023IfNeeded().catch((err) => {
    console.error('[migration/023] 后台执行失败,启动下次会重试:', err);
  });

  // L0/L5-B4.3.1 — 注册 media:// 协议
  // 必须早于 createMainWindow,否则 webview 加载 media:// 会 ERR_FILE_NOT_FOUND
  mediaStore.registerProtocol();

  // L4 — 框架级 Application Menu(取代 Electron 默认 File/Edit/View/Window)
  // markdown-import / backup 必须先注册 command,再 registerFrameworkMenus 调 rebuild 时菜单
  // 项的 command 字符串才能查到 handler
  registerMarkdownImport();
  registerWordImport();
  registerImportCacheIpc(); // 接收 renderer 的诊断落盘(chunk/PM)
  registerProgressBridge(); // 接收 renderer 驱动的进度事件,回推 overlay
  registerBackupMenu();
  registerFrameworkMenus();

  // L1 — 主窗口
  const mainWindow = await createMainWindow();

  // L5-C6:webview attach hook(PDF 提取 download 拦截)— 必须在 mainWindow 创建后挂
  registerWebviewExtractionHook(mainWindow);
  // ai-extraction:webview attach hook(AI Host webview did-navigate 到 AI URL 时
  // 注册到 ai-webview-registry,askAI / pasteAndSend 走前台 webContents 而非后台)
  registerAIWebviewHook(mainWindow);
  // web view 原生右键菜单(Phase 2 根治 HTML 菜单被 webview OS 层遮挡)— 只接管普通浏览 webview
  registerWebContextMenuHook(mainWindow);
  // web view 快捷键整层 + 弹窗导流(Phase 4 Commit 2)— webview 焦点下宿主 onKeyDown
  // 失效,主进程 before-input-event 拦截快捷键 + setWindowOpenHandler 导流弹窗进新 tab。
  // 只接管普通浏览 webview(shouldHandle 排除 AI / 翻译)。
  registerWebShortcutsHook(mainWindow);
  // web view 下载管理(Phase 3)— will-download 挂 persist:webview session **一次**
  // (绝不 per-guest:共享 session per-guest 会 N 倍触发),shouldHandle 排除 AI/翻译,
  // 不 setSavePath(Electron 自动弹系统保存框),进度/完成回推下载条 UI。
  registerWebDownloadHook(mainWindow);
  // per-ws 代理阶段1:partition 改 persist:webview-${wsId} 后,每个 ws 是独立 session。
  // 每个 ws 的 webview 首次 attach 时,对其 session 补注册 media:// 协议(去重),
  // 否则新 partition 里图片 ERR_UNKNOWN_URL_SCHEME(default + 旧 partition 已在
  // registerProtocol 注册)。下载 will-download 的补挂在 registerWebDownloadHook 内部做。
  mainWindow.webContents.on('did-attach-webview', (_e, guest) => {
    mediaStore.registerMediaForSession(guest.session);
  });
  // per-ws 代理阶段1:临时 setProxy IPC(DevTools console 验证不同 ws 不同出口)。
  registerWebProxyHandler();
  // per-ws 代理阶段3:Web 全局设置(搜索/主页)+ 清浏览数据 IPC。
  registerWebSettingsHandler();
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

// 退出前同步关 SurrealDB (300ms SIGTERM,超时 SIGKILL,避免孤儿)
app.on('before-quit', () => {
  shutdownStorageSync();
});
