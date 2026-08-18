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
import { createWindow, markAppQuitting, setPerWindowWebviewHooks, getLiveWsIds } from './window/main-window';
import { initIpcBus } from './ipc/ipc-bus';
import { initWorkspaceManager, getFullState, reconcileHasWindow } from './workspace/workspace-manager-main';
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
import { registerProfileHandlers } from './profile/profile-handlers';
import { registerWebSettingsHandler } from './web-settings/handler';
import { authService } from './auth/auth-service';
import { initStorage, shutdownStorageSync } from '@storage/index';
import { clearLegacyGraphStorage } from './graph/migration';
import { runMigration021IfNeeded } from '@storage/migrations/021-clear-all';
import { runMigration022IfNeeded } from '@storage/migrations/022-ebook-thought';
import { runMigration023IfNeeded } from '@storage/migrations/023-note-title-cache';
import { runMigration028IfNeeded } from '@storage/migrations/028-block-structure-attrs';
import { runMigration073IfNeeded } from '@storage/migrations/073-workspace-json-to-surreal';
import { seedRecipes } from './db/search-recipe-repo';
import { startXSearchScheduler, stopXSearchScheduler } from './x';

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

  // S3-b migration073 — workspace JSON → SurrealDB（必须在 initStorage 后）
  try {
    await runMigration073IfNeeded();
  } catch (err) {
    console.error('[migration/073] 执行失败,启动下次会重试:', err);
  }

  // X 时间线智能筛选 Phase 1 — 种子配方 + 调度器（必须在 migration_1_8_0 之后）
  await seedRecipes().catch((err) => {
    console.error('[x-timeline] seedRecipes failed:', err);
  });
  startXSearchScheduler();

  // S3-b — 主进程楼长（必须在 initStorage + migration073 之后，createMainWindow 之前）
  // renderer 加载后即可 invoke WORKSPACE_GET_STATE 拿到已初始化状态。
  await initWorkspaceManager();

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

  // L1 — 恢复上次打开的窗口
  // 使用 hasWindow 字段（退出前有独立窗口的 ws）而非 isOpen（tab bar 可见性）来决定开几个窗口。
  // 兜底：至少保证 activeId 对应的窗口被打开。
  const { workspaces: allWs, activeId: initialActiveId } = getFullState();
  if (!initialActiveId) throw new Error('[main] initWorkspaceManager 后 activeId 仍为 null，无法创建首窗口');

  // 多窗口(S3-b)根治:per-window webview 钩子经 setPerWindowWebviewHooks 注入,
  // createWindow 对**每个**窗口(含次级 New Window / 恢复窗口)在 loadURL 前挂一遍。
  // 历史 bug:这些 hook 只在第一个 mainWindow 挂 → 次级窗口 webview 无 did-attach-webview
  // 监听 → 右键菜单弹不出来 / 快捷键失效 / 提取失效。全部为纯 per-window did-attach-webview
  // 类 hook,无全局单例副作用(ipcMain / will-download 会话级仍在下方一次性注册)。
  setPerWindowWebviewHooks((win) => {
    // L5-C6:webview attach hook(PDF 提取 download 拦截)
    registerWebviewExtractionHook(win);
    // ai-extraction:AI Host webview did-navigate 到 AI URL 时注册到 ai-webview-registry,
    // 并挂原生右键菜单「📥 提取此对话到笔记」(复用 web-service-base 底座)。
    registerAIWebviewHook(win);
    // X 集成 阶段 0/1:X Host webview 注册 + 原生右键「提取此推文到笔记」(同 AI 底座)。
    registerXWebviewHook(win);
    // web view 原生右键菜单(Phase 2 根治 HTML 菜单被 webview OS 层遮挡)— 只接管普通浏览 webview
    registerWebContextMenuHook(win);
    // web view 快捷键整层 + 弹窗导流(Phase 4 Commit 2)— 只接管普通浏览 webview(排除 AI/翻译)。
    registerWebShortcutsHook(win);
    // web view 下载管理(Phase 3)— per-window did-attach-webview 里按 guest.session 挂
    // will-download;会话级 WeakSet 去重,故次级窗口/新 partition 也能触发下载而不会 N 倍回调。
    registerWebDownloadHook(win);
    // per-ws 代理阶段1:每个 ws 的 webview 首次 attach 时对其 session 补注册 media:// 协议(去重),
    // 否则新 partition 里图片 ERR_UNKNOWN_URL_SCHEME。
    win.webContents.on('did-attach-webview', (_e, guest) => {
      mediaStore.registerMediaForSession(guest.session);
      // L5-G7b:字体记名方案无 font:// 协议,无需 per-ws session 补注册(渲染走 IPC 按名读)。
    });
  });

  // 先开 activeId 对应的主窗口(per-window webview 钩子已由上方 setPerWindowWebviewHooks 注入,
  // createWindow 内部对每个窗口自动挂;此处不再需要窗口引用做一次性 hook)。
  await createWindow(initialActiveId);

  // 其余退出前有独立窗口的 ws 并行恢复（跳过已开的 activeId）
  const otherWindowWs = allWs.filter((ws) => ws.hasWindow && ws.id !== initialActiveId);
  await Promise.all(otherWindowWs.map((ws) => createWindow(ws.id)));

  // Window Profile CRUD IPC。
  registerProfileHandlers();
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
    const wsId = getFullState().activeId;
    if (!wsId) throw new Error('[main] activate: activeId 为 null，无法重新创建窗口');
    await createWindow(wsId);
  }
});

// 非 macOS:窗口全关后退出
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// 退出前：标记 app 正在退出（窗口 closed 回调跳过清 hasWindow）→ 按此刻真实存活的窗口
// 对账 hasWindow（决定下次启动开几个窗口）→ 关 SurrealDB。
//
// 对账必须在关库**之前**落盘,而 persistState 是异步(WebSocket)。before-quit 是同步回调,
// 直接 void 掉会让 shutdownStorageSync 在写入途中把库关掉 → 修复静默失效。故首次进入时
// preventDefault 拦住退出,等写完再 app.quit() 二次进入（此时 reconciled=true 直接放行）。
let reconciled = false;
app.on('before-quit', (event) => {
  markAppQuitting();
  // 停掉 X 调度器的 60s 轮询 —— 活着的 setInterval 会吊住事件循环让进程不肯退,
  // 且退出途中继续跑配方毫无意义(日志刷 `no active X webContents, skip`)。
  stopXSearchScheduler();
  if (reconciled) {
    shutdownStorageSync();
    return;
  }
  event.preventDefault();
  void reconcileHasWindow(getLiveWsIds())
    .catch((err) => {
      // 对账失败不能卡住退出:记录后照常退（代价是下次启动窗口数可能仍是旧快照）
      console.error('[main] before-quit reconcileHasWindow 失败,按原状态退出:', err);
    })
    .finally(() => {
      reconciled = true;
      app.quit();
    });
});

// ── 信号退出(Ctrl+C / kill)──
//
// Electron 默认**不**把 SIGINT/SIGTERM 转成 app.quit(),所以按 Ctrl+C 时上面整套
// before-quit 逻辑（hasWindow 对账 + 关库 + 停调度器）会被完全跳过。后果:
//   1. SurrealDB 子进程自己收到 SIGINT 退出了,但 WS 客户端不知道 → 指数退避重连
//      (2s→4s→8s→16s…)一直连一个已经死掉的服务端;
//   2. X 调度器 60s setInterval 还活着,吊住事件循环;
//   3. hasWindow 没对账 → 下次启动窗口数是旧快照。
// 表现就是「Ctrl+C 后 shell 提示符回来了、但 app 迟迟不退还在刷日志」。
//
// 这里把信号接回正规退出路径。app.quit() 会触发 before-quit,preventDefault 那条
// 异步分支照常走完(对账落盘 → 二次进入 → 关库),不会丢数据。
//
// 二次信号强杀:用户连按 Ctrl+C 表示不想再等(对齐 SurrealDB 自己的
// "A second signal will force an immediate shutdown" 约定)。此时对账可能没写完,
// 属用户显式选择,故只警告不静默。
let quitSignalReceived = false;
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    if (quitSignalReceived) {
      console.warn(`[main] 再次收到 ${sig},强制立即退出(对账可能未完成)。`);
      process.exit(1);
    }
    quitSignalReceived = true;
    console.log(`[main] 收到 ${sig},开始优雅退出…`);
    app.quit();
  });
}
