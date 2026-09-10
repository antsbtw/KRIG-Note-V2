/**
 * mind 跨模块广播(对齐 graph/broadcast.ts 模板)
 *
 * 单独成文件的理由同 graph:避免 handlers.ts 既挂 ipcMain 又被其他模块 import 时
 * 引起 `ipcMain.handle` 副作用重复注册。
 *
 * ⚠️ 广播给**所有窗口** —— 列表是全局数据,每个窗口都要刷新。
 * (与「用户发起的动作要定向投递」不同:那是发起型事件,这是数据变更通知。)
 */

import { BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '@shared/ipc/channel-names';
import { mindStore } from './mind-store';

export async function broadcastMindListChanged(): Promise<void> {
  try {
    const list = await mindStore.list();
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(IPC_CHANNELS.MIND_LIST_CHANGED, list);
      }
    }
  } catch (err) {
    console.warn('[mind] broadcast list-changed failed:', err);
  }
}
