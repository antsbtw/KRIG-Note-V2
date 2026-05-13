/**
 * graph 跨模块广播工具 (decision 014 §5.6.bis 引入)
 *
 * 抽出 broadcastGraphListChanged 单独文件,避免 library-handlers.ts 既挂 ipcMain 又被
 * 其他模块 import 时引起 ipcMain.handle 副作用重复触发 (handlers.ts 模块加载即注册)。
 *
 * 用法:
 * - src/platform/main/graph/library-handlers.ts 内 graph 写操作后调
 * - src/platform/main/folder/handlers.ts 删 folder Path Y (cascade graph-canvas) 后跨域广播
 *
 * 对齐 src/platform/main/note/broadcast.ts 模板。
 */

import { BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '@shared/ipc/channel-names';
import { canvasStore } from './canvas-store';

export async function broadcastGraphListChanged(): Promise<void> {
  try {
    const list = await canvasStore.list();
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(IPC_CHANNELS.GRAPH_LIST_CHANGED, list);
      }
    }
  } catch (err) {
    console.warn('[graph] broadcast list-changed failed:', err);
  }
}
