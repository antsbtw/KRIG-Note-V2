/**
 * bookmark 跨模块广播工具
 *
 * 抽出 broadcastBookmarkListChanged 单独文件,避免 handlers.ts 既挂 ipcMain 又被
 * 其他模块 import 时引起 ipcMain.handle 副作用重复触发(handlers.ts 模块加载即注册)。
 *
 * 对齐 src/platform/main/note/broadcast.ts / graph/broadcast.ts 模板。
 *
 * 用法:
 * - src/platform/main/bookmark/handlers.ts 内书签写操作后调
 * - src/platform/main/bookmark/chrome-import.ts 导入完刷新 NavSide 书签段
 */

import { BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '@shared/ipc/channel-names';
import { list } from './capability-impl';

/** 广播书签列表变更到所有 renderer(照 ebook broadcastBookshelfChanged) */
export async function broadcastBookmarkListChanged(): Promise<void> {
  try {
    const all = await list();
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(IPC_CHANNELS.BOOKMARK_LIST_CHANGED, all);
      }
    }
  } catch (err) {
    console.warn('[bookmark] broadcast list-changed failed:', err);
  }
}
