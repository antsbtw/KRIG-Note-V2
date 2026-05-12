/**
 * note 跨模块广播工具
 *
 * 抽出 broadcastNoteListChanged 单独文件,避免 handlers.ts 既挂 ipcMain 又被
 * 其他模块 import 时引起 ipcMain.handle 副作用重复触发(handlers.ts 模块加载即注册)。
 *
 * 用法:
 * - src/platform/main/note/handlers.ts 内 noteCapability 写操作后调
 * - src/platform/main/folder/handlers.ts 删 folder Path Y 后跨域广播
 */

import { BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '@shared/ipc/channel-names';
import { listNotes } from './capability-impl';

export async function broadcastNoteListChanged(): Promise<void> {
  try {
    const list = await listNotes();
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(IPC_CHANNELS.NOTE_LIST_CHANGED, list);
      }
    }
  } catch (err) {
    console.warn('[note] broadcast list-changed failed:', err);
  }
}
