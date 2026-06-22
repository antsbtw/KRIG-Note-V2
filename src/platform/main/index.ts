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

// ── stdout/stderr EPIPE 防护(进程退出边界,非业务兜底)──
// app 关闭时,接收主进程 stdout 的父进程(dev 下是 electron-forge,prod 下是终端/
// launchd)可能先退出 → 管道关闭。此后任何 console.log(残留的 webContents /
// child_process / SSE 事件回调里的日志)写入已断管道 → stdout/stderr 流抛 EPIPE。
// 这两个流默认没有 'error' 监听器,未处理的流错误会冒泡成 uncaughtException →
// Electron 弹 "A JavaScript error occurred in the main process"。
//
// 在流上直接监听 'error' 并只忽略 EPIPE(此刻进程在退、日志本无意义),错误就被
// 流自身消费、不再冒泡;其余真实异常不经此路径,fail-loud 行为不受影响。
const ignoreEpipe = (err: NodeJS.ErrnoException): void => {
  if (err.code === 'EPIPE') return;
  throw err; // 非 EPIPE 的流错误:照常抛出
};
process.stdout.on('error', ignoreEpipe);
process.stderr.on('error', ignoreEpipe);
import { createMainWindow } from './window/main-window';
import { initIpcBus } from './ipc/ipc-bus';
import { reportL0Alive } from './diagnostics/L0-alive';
import { registerFrameworkMenus } from './menu/framework-menus';
import { registerMarkdownImport } from './markdown-import';
import { registerWordImport } from './word-import';
import { registerImportCacheIpc } from './word-import/import-cache';
import { registerXPlanCacheIpc } from './x/x-plan-cache';
import { registerProgressBridge } from './window/progress-bridge';
import { registerBackupMenu } from './backup';
import { mediaStore } from './media/media-store-impl';
import { registerWebviewExtractionHook } from './extraction/handlers';
import { registerAIWebviewHook } from './ai';
import { registerXWebviewHook } from './x';
import { registerWebContextMenuHook } from './web-context-menu/handler';
import { registerWebShortcutsHook } from './web-shortcuts/handler';
import { registerWebDownloadHook } from './web-download/handler';
import { registerWebProxyHandler } from './web-proxy/handler';
import { registerWebSettingsHandler } from './web-settings/handler';
import { authService } from './auth/auth-service';
import { initStorage, shutdownStorageSync } from '@storage/index';
import { clearLegacyGraphStorage } from './graph/migration';
import { runMigration021IfNeeded } from '@storage/migrations/021-clear-all';
import { runMigration022IfNeeded } from '@storage/migrations/022-ebook-thought';
import { runMigration023IfNeeded } from '@storage/migrations/023-note-title-cache';
import { runMigration028IfNeeded } from '@storage/migrations/028-block-structure-attrs';

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
  // L5-G7b:font:// 嵌入协议已废(改记名方案,字体经 IPC fontReadByName 按名读 buffer,
  // 不再走 fetch 协议),此处无需注册任何 font scheme。
]);

// ── 关闭 Chromium FedCM(Federated Credential Management)──
//
// X / 部分用 Google Identity Services 的站点,「Continue with Google」默认走 FedCM:
// 由 Chromium 在内容区渲染一个**浏览器原生账号选择浮层**(navigator.credentials.get),
// 不经 window.open → setWindowOpenHandler 拦不到、也无法关闭/钉窗,体验不可控。
//
// 关掉 FedCM 后,GIS 退回传统 window.open 弹窗流程 → 命中 setWindowOpenHandler 的 OAuth
// 分支 → 钉成主窗口的子/模态 sheet(parent+modal,见 web-shortcuts/handler.ts):在 app 内、
// 可关闭、cookie 同源。注:GSI 的 /gsi/select?ux_mode=popup 这类 URL 专为 popup 设计,
// 整页 loadURL 会白屏,故只能走 popup(钉窗),无法做成 Gemini 那样的整页登录。
//
// 必须在 app ready 前设(Chromium 启动参数)。
app.commandLine.appendSwitch('disable-features', 'FedCm');

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

  // Decision 028 Phase 3 — 文档结构边 → block atom 属性(noteId/parentId/order)迁移。
  // 必须在 023 title backfill 之前(awaited):028 重写 block atom,023 assemble 拼 title;
  // 若并发会 race(两边同时 assemble + putAtom)。028 内部串行 + round-trip 校验 + 保守删边。
  // 失败 / round-trip 不一致不写 flag,启动下次重试(边仍在,Phase 1 fallback 仍可读)。
  try {
    await runMigration028IfNeeded();
  } catch (err) {
    console.error('[migration/028] 执行失败,启动下次会重试:', err);
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

  // L5-G7b — 字体改记名方案(sysname:<family>),不再嵌入 → 无 font:// 协议要注册。
  // 本机渲染 / 导出经 IPC FONT_READ_BY_NAME 按名读 buffer(registerFontHandlers 接)。

  // L4 — 框架级 Application Menu(取代 Electron 默认 File/Edit/View/Window)
  // markdown-import / backup 必须先注册 command,再 registerFrameworkMenus 调 rebuild 时菜单
  // 项的 command 字符串才能查到 handler
  registerMarkdownImport();
  registerWordImport();
  registerImportCacheIpc(); // 接收 renderer 的诊断落盘(chunk/PM)
  registerXPlanCacheIpc(); // 接收 renderer 的 X 发布中间态(ArticlePlan)落盘,诊断用
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
  // X 集成 阶段 0/1:X Host webview did-navigate 到 x.com 时注册到 x-webview-registry,
  // 并挂原生右键菜单「提取此推文到笔记」(复用 web-service-base 底座,与 AI hook 同模式)。
  registerXWebviewHook(mainWindow);
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
    // L5-G7b:字体记名方案无 font:// 协议,无需 per-ws session 补注册(渲染走 IPC 按名读)。
  });
  // per-ws 代理阶段1:临时 setProxy IPC(DevTools console 验证不同 ws 不同出口)。
  registerWebProxyHandler();
  // per-ws 代理阶段3:Web 全局设置(搜索/主页)+ 清浏览数据 IPC。
  registerWebSettingsHandler();

  // 登录:从磁盘恢复 session(有 token → authenticated,无 → anonymous)。
  // **不 await**:窗口照常起,AuthState 初始 loading,restore 完成后经
  // authService.subscribe → broadcastAuthChanged 推到已创建的窗口(冷启动不闪屏)。
  void authService.restore().catch((err) => {
    console.error('[auth] restore 失败(按未登录处理,可重新登录):', err);
  });
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
