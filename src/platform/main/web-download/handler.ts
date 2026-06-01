/**
 * Web view 下载管理 hook(Phase 3)
 *
 * 给普通浏览 webview(partition `persist:webview`)加下载:点下载链接 → 弹系统
 * 原生保存对话框 → 推送进度 → 完成后 UI 提供「在 Finder 显示」+ 可取消。
 *
 * ⚠️ 头号架构点:will-download 挂 session 一次,绝不 per-guest
 * - `will-download` 是 **Session 级**事件(签名 `(event, item, webContents)`),
 *   不是 webContents 级。前几个 hook(web-context-menu / web-shortcuts)挂在
 *   guest webContents,走 `did-attach-webview` per-guest。**下载绝不能照搬**:
 *   `persist:webview` 是共享 Session 实例(`session.fromPartition` 对同一 partition
 *   字符串返回同一实例),若在 `did-attach-webview` 里对 `guest.session` 挂
 *   will-download → N 个 webview = 同一下载触发 N 次回调(重复弹保存框 / 重复推进度)。
 * - 正确做法:`createMainWindow` 后,对 `session.fromPartition(WEBVIEW_PARTITION)`
 *   **挂一次** will-download(全局单次)。
 *
 * shouldHandle 过滤(必须,排除 AI webview):
 * - AI webview 与普通浏览**共用** `persist:webview`(capabilities/ai-extraction/Host.tsx),
 *   所以 AI 触发的下载也会进本 session 的 will-download 回调。will-download 回调第三参
 *   `webContents` = 发起下载的 webContents,直接 `shouldHandle(webContents)` 排除 AI /
 *   翻译;不命中(普通浏览)才接管。不接管时直接 return(不 preventDefault,让 Chromium
 *   默认行为 / AI 自己处理)。
 *
 * 保存对话框:will-download 里**不调** `item.setSavePath()` → Electron 自动弹系统
 * 原生保存对话框。用户点取消 → done 事件 state='cancelled',savePath 空。
 *
 * DownloadItem 不跨 IPC:main 端自增 `downloadId` + 维护 `Map<id, DownloadItem>`,
 * IPC 只传 id + 元数据(filename / received / total / state / savePath)。
 *
 * 调用时机:platform/main/index.ts 在 createMainWindow 后调一次,跟
 * registerWebContextMenuHook / registerWebShortcutsHook 平级。
 */

import {
  ipcMain,
  session,
  type BrowserWindow,
  type DownloadItem,
} from 'electron';
import { WEBVIEW_PARTITION } from '@shared/constants/webview';
import { IPC_CHANNELS } from '@shared/ipc/channel-names';
import { shouldHandle } from '../web-shared/should-handle';
import { downloadStore, type DownloadEntry } from './download-store';
import { broadcastDownloadHistoryChanged } from './handlers';

/** main → renderer 推送的下载事件 payload(与 electron-api.d.ts 声明保持一致)*/
interface WebDownloadEvent {
  type: 'started' | 'progress' | 'done';
  id: number;
  filename: string;
  /** 下载来源 URL(进行中显示用,started 起即带)*/
  url?: string;
  received?: number;
  total?: number;
  /** 'progressing' | 'completed' | 'cancelled' | 'interrupted' */
  state?: string;
  /** 仅 completed 有效 */
  savePath?: string;
}

let nextId = 1;
/** 进行中的下载:id → DownloadItem。DownloadItem 不能跨 IPC,故 main 端持有,IPC 只传 id。*/
const active = new Map<number, DownloadItem>();

/** cancel invoke handler 只注册一次(防热重载 / 多窗口重复注册)*/
let actionHandlerRegistered = false;

export function registerWebDownloadHook(mainWindow: BrowserWindow): void {
  const sess = session.fromPartition(WEBVIEW_PARTITION);

  // ── 取消 invoke(renderer → main):{ id, action:'cancel' } → item.cancel() ──
  // 注册一次即可,不随 hook 多次调用重复挂。
  if (!actionHandlerRegistered) {
    actionHandlerRegistered = true;
    ipcMain.handle(
      IPC_CHANNELS.WEB_DOWNLOAD_ACTION,
      (_event, payload: { id: number; action: string }) => {
        const item = active.get(payload?.id);
        if (item && payload?.action === 'cancel') {
          item.cancel();
        }
      },
    );
  }

  sess.on('will-download', (_event, item, webContents) => {
    // shouldHandle 过滤:只接管普通浏览 webview(排除 AI / 翻译)。
    // 不接管 → 直接 return(不 preventDefault,走 Chromium 默认行为)。
    if (!shouldHandle(webContents)) return;

    // 不调 item.setSavePath() → Electron 自动弹系统原生保存对话框。
    const id = nextId++;
    active.set(id, item);

    const send = (type: WebDownloadEvent['type'], extra: Partial<WebDownloadEvent>): void => {
      // 窗口可能已销毁(关闭中),防御性判断。
      if (mainWindow.isDestroyed()) return;
      mainWindow.webContents.send(IPC_CHANNELS.WEB_DOWNLOAD_EVENT, {
        type,
        id,
        filename: item.getFilename(),
        ...extra,
      } satisfies WebDownloadEvent);
    };

    send('started', { total: item.getTotalBytes(), url: item.getURL() });

    item.on('updated', (_e, state) => {
      send('progress', {
        received: item.getReceivedBytes(),
        total: item.getTotalBytes(),
        state,
      });
    });

    item.on('done', (_e, state) => {
      // state 可能是 completed / cancelled / interrupted。savePath 仅 completed 有效。
      const savePath = state === 'completed' ? item.getSavePath() : '';
      send('done', { state, savePath });

      // 终态落盘(同进程,无 IPC 时序丢失)。只存 completed/cancelled/interrupted。
      // renderer 收到 done 后凭这条历史(history-changed 广播)把进行中态去重移除。
      const entryState: DownloadEntry['state'] =
        state === 'completed'
          ? 'completed'
          : state === 'interrupted'
            ? 'interrupted'
            : 'cancelled';
      downloadStore
        .add({
          id: String(id),
          filename: item.getFilename(),
          url: item.getURL(),
          savePath,
          total: item.getTotalBytes(),
          completedAt: Date.now(),
          state: entryState,
        })
        .then((added) => {
          if (added) broadcastDownloadHistoryChanged(mainWindow);
        })
        .catch((err) => console.warn('[web-download] 落盘失败:', err));

      active.delete(id);
    });
  });
}
