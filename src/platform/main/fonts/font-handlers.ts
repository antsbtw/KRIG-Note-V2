/**
 * 字体 IPC handlers(main 进程)— L5-G7
 *
 * Renderer 通过 window.electronAPI.fontListSystem / fontEmbed 调用。
 * 逻辑在 system-font-scan.ts(扫描)+ font-store-impl.ts(嵌入,G7.2)。
 *
 * G7.1:FONT_LIST_SYSTEM(扫系统字体)。
 * G7.2:FONT_EMBED(嵌入选中字体)在 font-store 落地后接入。
 */

import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '@shared/ipc/channel-names';
import { scanSystemFonts } from './system-font-scan';

export function registerFontHandlers(): void {
  // G7.1:扫本机系统字体(纯主进程 fs + opentype;渲染经此 IPC 拿,W5 边界)
  ipcMain.handle(IPC_CHANNELS.FONT_LIST_SYSTEM, async () => {
    try {
      return { success: true, fonts: scanSystemFonts() };
    } catch (err) {
      // fail loud:扫描整体失败(不该发生,scanSystemFonts 内部已逐项容错)
      console.error('[font] FONT_LIST_SYSTEM 扫描失败', err);
      return { success: false, error: String(err), fonts: [] };
    }
  });
}
