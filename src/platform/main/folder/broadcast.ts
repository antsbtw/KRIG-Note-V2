/**
 * folder 跨模块广播工具
 *
 * 抽出 broadcastFolderListChanged 单独文件,避免 handlers.ts 既挂 ipcMain 又被
 * 其他模块 import 时引起 ipcMain.handle 副作用重复触发(handlers.ts 模块加载即注册)。
 *
 * 对齐 src/platform/main/note/broadcast.ts / graph/broadcast.ts 模板。
 *
 * 用法:
 * - src/platform/main/folder/handlers.ts 内 folder 写操作后调
 * - src/platform/main/bookmark/chrome-import.ts 导入完跨域刷新 NavSide
 */

import { BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '@shared/ipc/channel-names';
import { listAllFoldersGroupedByView } from './capability-impl';

/**
 * decision 021 §4.2 + §10.B-2(方案 C):main 端按 view 分别广播,
 * renderer 端 useAllFolders(viewType) hook 在 onListChanged 内调 listFolders(viewType)
 * 重拉,只保留当前 view folder。onListChanged 签名不动。
 *
 * P1-3(2026-05-29 data-layer-audit):4 次 listFolders → 1 次
 * listAllFoldersGroupedByView,字面 12 次 storage call → 3 次,broadcast 快 4×。
 */
export async function broadcastFolderListChanged(): Promise<void> {
  try {
    const grouped = await listAllFoldersGroupedByView();
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.isDestroyed()) continue;
      win.webContents.send(IPC_CHANNELS.FOLDER_LIST_CHANGED, grouped.note);
      win.webContents.send(IPC_CHANNELS.FOLDER_LIST_CHANGED, grouped.graph);
      win.webContents.send(IPC_CHANNELS.FOLDER_LIST_CHANGED, grouped.ebook);
      win.webContents.send(IPC_CHANNELS.FOLDER_LIST_CHANGED, grouped.thought);
      win.webContents.send(IPC_CHANNELS.FOLDER_LIST_CHANGED, grouped.web);
    }
  } catch (err) {
    console.warn('[folder] broadcast list-changed failed:', err);
  }
}
