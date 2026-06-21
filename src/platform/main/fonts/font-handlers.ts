/**
 * 字体 IPC handlers(main 进程)— L5-G7 / L5-G7b(记名方案)
 *
 * Renderer 通过 window.electronAPI.fontListSystem / fontReadByName 调用。
 * 逻辑全在 system-font-scan.ts(扫描 + 按名读 buffer)。
 *
 * - FONT_LIST_SYSTEM:扫系统字体列清单(供 Aa 面板选)。
 * - FONT_READ_BY_NAME:按 family 名读字体 buffer(本机渲染 / 导出按名 outline;
 *   L5-G7b 记名方案核心,替代已废的 font:// 嵌入协议)。
 */

import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '@shared/ipc/channel-names';
import { scanSystemFonts, readFontByName } from './system-font-scan';

export function registerFontHandlers(): void {
  // G7.1:扫本机系统字体(纯主进程 fs + 轻量 name 解析;渲染经此 IPC 拿,W5 边界)
  ipcMain.handle(IPC_CHANNELS.FONT_LIST_SYSTEM, async () => {
    try {
      return { success: true, fonts: scanSystemFonts() };
    } catch (err) {
      // fail loud:扫描整体失败(不该发生,scanSystemFonts 内部已逐项容错)
      console.error('[font] FONT_LIST_SYSTEM 扫描失败', err);
      return { success: false, error: String(err), fonts: [] };
    }
  });

  // L5-G7b:按 family 名读字体 buffer(记名方案核心,替代 font:// fetch)。
  // 渲染进程 loadFont 识别 sysname: 前缀 → 走此 IPC 拿 ArrayBuffer 喂 opentype。
  // 没装该字体 → 返回 null,渲染层回退打包字体(红线:不乱码)。
  ipcMain.handle(IPC_CHANNELS.FONT_READ_BY_NAME, async (_event, family: unknown, bold: unknown) => {
    if (typeof family !== 'string' || !family) return null;
    return readFontByName(family, bold === true);
  });
}
