/**
 * Extraction IPC handlers + webview attach 监听(L5-C6)
 *
 * 三件事:
 * - EXTRACTION_UPLOAD:上传当前打开的 PDF → 返 md5 + platformUrl(view 拿到后调
 *   bus.slot.openRight('web-view', { url: <platformUrl> }))
 * - registerWebviewExtractionHook:挂 mainWindow.webContents 的 did-attach-webview,
 *   自动给 Platform URL 域的 webview 注入 download intercept 脚本 + 监听
 *   console-message;识别 'KRIG_IMPORT:' 前缀 → 解析 → 推 EXTRACTION_NOTE_CREATE
 *   广播给 renderer
 * - EXTRACTION_IMPORT:renderer 主动 ipcRenderer.invoke 触发(备用 / 测试入口),
 *   等同直接广播 EXTRACTION_NOTE_CREATE(供 main 端无 webview 场景手动测试)
 *
 * **职责边界**(关键设计):
 * - main 不直接写 atom (noteCapability 桥接在 renderer)— main 只负责 IPC 转发 +
 *   Platform 交互;atom→PM 转换 + folder/note 创建在 view 端做
 *   注:L7-sub2 后 noteCapability impl 居 main 进程,但 extraction 流仍走"broadcast
 *      给 renderer,view 端调 noteCapability.createNote"路径保持单向数据流
 * - V1 ctx.openCompanion('extraction') 一步开右栏 → V2 留给 view 端走 bus;
 *   main 不感知 view 状态机
 */

import { BrowserWindow, ipcMain, type WebContents } from 'electron';
import { IPC_CHANNELS } from '@shared/ipc/channel-names';
import { getEBookData } from '../ebook/file-loader';
// sub-phase 022 (§10.B-3): 旧 bookshelfStore JSON store 字面 git rm,
// 改走 ebook capability-impl 字面 list() 函数 (走 atom CRUD)
import { list as listEBooks } from '../ebook/capability-impl';
import { uploadPdfToPlatform } from './upload-service';
import { setupExtractionInterceptor } from './extraction-handler';
import { PLATFORM_API, PLATFORM_WEB_UI } from './config';

/** Platform 域名前缀(给 console-message 监听 + intercept 注入用)*/
const PLATFORM_HOST_PREFIXES = [PLATFORM_API, PLATFORM_WEB_UI].map((u) => {
  try {
    return new URL(u).origin;
  } catch {
    return '';
  }
}).filter(Boolean);

/** 检查 url 是否属于 Platform(用于决定是否注入 intercept)*/
function isPlatformUrl(url: string): boolean {
  return PLATFORM_HOST_PREFIXES.some((origin) => url.startsWith(origin));
}

/**
 * 给指定 webContents 安装 extraction intercept + console-message 监听:
 * - 注入 download intercept 脚本(setupExtractionInterceptor)
 * - 监听 console-message 事件,识别 'KRIG_IMPORT:' 前缀 → 解析 JSON → importExtractionData
 *
 * 多次调同一 webContents 安全:setupExtractionInterceptor 内的 `__krigDownloadInterceptInstalled`
 * 防重;console-message listener 用 once-flag 防重(本函数自管 attached set)。
 */
const attachedWebContents = new WeakSet<WebContents>();

function attachExtractionToWebContents(wc: WebContents): void {
  if (attachedWebContents.has(wc)) return;
  attachedWebContents.add(wc);

  console.log('[Extraction] attach to webContents id=', wc.id, 'url=', wc.getURL());
  setupExtractionInterceptor(wc);

  // Electron 40 console-message 签名:
  //   (details: Event<WebContentsConsoleMessageEventParams>, level, message, line, sourceId)
  // message 既在 details.message(新)也在第三参数(deprecated 但仍存)— 都试一遍最稳。
  wc.on('console-message', (details, _level, messageArg) => {
    const message =
      (details as unknown as { message?: string }).message ?? messageArg ?? '';
    if (!message.startsWith('KRIG_IMPORT:')) return;
    const json = message.slice('KRIG_IMPORT:'.length);
    try {
      const data = JSON.parse(json);
      console.log(
        '[Extraction] KRIG_IMPORT received:',
        (data as { type?: string; chapters?: unknown[] }).type ?? 'unknown',
        (data as { chapters?: unknown[] }).chapters?.length ?? 0,
        'chapters',
      );
      broadcastImport(data);
    } catch (err) {
      console.error('[Extraction] Failed to parse KRIG_IMPORT JSON:', err);
    }
  });
}

/** 转发拦截到的 atom JSON 给所有 renderer(view 端协调创建 folder + note)*/
function broadcastImport(data: unknown): void {
  let sent = 0;
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(IPC_CHANNELS.EXTRACTION_NOTE_CREATE, data);
      sent++;
    }
  }
  console.log('[Extraction] broadcast EXTRACTION_NOTE_CREATE → windows=', sent);
}

/**
 * 在 mainWindow 上挂 did-attach-webview 监听 — 任何 webview 加载到 Platform URL
 * 时自动注入 intercept。
 *
 * 调用时机:platform/main/index.ts 在 createMainWindow 后调一次。
 */
export function registerWebviewExtractionHook(mainWindow: BrowserWindow): void {
  mainWindow.webContents.on('did-attach-webview', (_event, guestWebContents) => {
    console.log('[Extraction] did-attach-webview, guest id=', guestWebContents.id);
    // attach 后 url 可能还未确定;监听 did-navigate 等首个 Platform URL navigation 触发
    const checkAndAttach = (url: string): void => {
      if (isPlatformUrl(url)) {
        attachExtractionToWebContents(guestWebContents);
      }
    };

    guestWebContents.on('did-navigate', (_e, url) => checkAndAttach(url));
    guestWebContents.on('did-navigate-in-page', (_e, url) => checkAndAttach(url));

    // 当前 url(可能 attach 时已加载)
    const currentUrl = guestWebContents.getURL();
    if (currentUrl) checkAndAttach(currentUrl);
  });
}

export function registerExtractionHandlers(): void {
  // EXTRACTION_UPLOAD:上传当前打开的 PDF
  ipcMain.handle(IPC_CHANNELS.EXTRACTION_UPLOAD, async () => {
    const ebookData = getEBookData();
    if (!ebookData) {
      return { uploaded: false, reason: 'no-file' };
    }
    if (!ebookData.filePath.toLowerCase().endsWith('.pdf')) {
      return { uploaded: false, reason: 'not-pdf' };
    }

    // 从书架取 displayName(避免 UUID 文件名)
    // sub-phase 022: 走 ebook capability-impl 字面 list() (atom CRUD,返 EBookInfo[])
    const allEntries = await listEBooks();
    const entry = allEntries.find((e) => e.filePath === ebookData.filePath);
    const displayName =
      entry?.displayName || ebookData.fileName.replace(/\.pdf$/i, '');

    console.log('[Extraction] Uploading:', displayName, `(${ebookData.filePath})`);

    try {
      const result = await uploadPdfToPlatform(ebookData.filePath, displayName);
      return {
        uploaded: true,
        md5: result.md5,
        alreadyExists: result.alreadyExists,
        platformUrl: `${PLATFORM_WEB_UI}/book/${result.md5}`,
      };
    } catch (err) {
      console.error('[Extraction] Upload failed:', err);
      return { uploaded: false, reason: String(err) };
    }
  });

  // EXTRACTION_IMPORT:renderer 直接触发(用作手动测试入口或备用路径);
  // 主路径仍是 webview console-message 监听 → broadcastImport
  ipcMain.handle(IPC_CHANNELS.EXTRACTION_IMPORT, async (_event, data: unknown) => {
    broadcastImport(data);
    return { success: true };
  });
}
