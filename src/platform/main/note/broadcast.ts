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
import type { NoteDocContentChangedPayload } from '@shared/ipc/note-folder-types';
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

/**
 * broadcastNoteDocContentChanged — 单 note doc 变化推送
 *
 * 与 broadcastNoteListChanged 的区别:
 * - 只携 noteId+doc, 不整 list 派发, 带宽更小
 * - emitterId 用于排除发起 renderer(防 echo 触发 NoteView Host 回灌跳光标)
 * - origin 用于诊断 + view 层策略化(目前 NoteView 不区分, 但保留扩展)
 *
 * 调用方:
 * - note handlers NOTE_UPDATE (emitterId=event.sender.id, origin='note-editor')
 * - ebook capability addReadingThoughtBlock / removeReadingThoughtBlock
 *   (emitterId 不传, origin='ebook-reading-thought')
 */
export function broadcastNoteDocContentChanged(payload: NoteDocContentChangedPayload): void {
  try {
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.isDestroyed()) continue;
      // 排除发起 renderer(防 NoteView Host useEffect[doc] echo 回灌)
      if (payload.emitterId != null && win.webContents.id === payload.emitterId) continue;
      win.webContents.send(IPC_CHANNELS.NOTE_DOC_CONTENT_CHANGED, payload);
    }
  } catch (err) {
    console.warn('[note] broadcast doc-content-changed failed:', err);
  }
}
