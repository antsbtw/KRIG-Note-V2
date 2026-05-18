/**
 * thought 跨模块广播工具(对齐 note/broadcast.ts 同模式)
 */

import { BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '@shared/ipc/channel-names';
import { listThoughts } from './capability-impl';

export async function broadcastThoughtListChanged(): Promise<void> {
  try {
    const list = await listThoughts();
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(IPC_CHANNELS.THOUGHT_LIST_CHANGED, list);
      }
    }
  } catch (err) {
    console.warn('[thought] broadcast list-changed failed:', err);
  }
}
