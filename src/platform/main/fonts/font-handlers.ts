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
import { scanSystemFonts, readFontByName } from './system-font-scan';
import { fontStore } from './font-store-impl';

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
  ipcMain.handle(IPC_CHANNELS.FONT_READ_BY_NAME, async (_event, family: unknown) => {
    if (typeof family !== 'string' || !family) return null;
    return readFontByName(family);
  });

  // G7.2:嵌入选中系统字体(.ttc 抽子字体)→ 落盘 font:// → 返回 fontId/URL/sizeKb
  ipcMain.handle(
    IPC_CHANNELS.FONT_EMBED,
    async (_event, sourcePath: unknown, fontIndex: unknown, meta: unknown) => {
      if (typeof sourcePath !== 'string' || !sourcePath) {
        return { success: false, error: 'invalid sourcePath' };
      }
      const idx = typeof fontIndex === 'number' && Number.isInteger(fontIndex) ? fontIndex : 0;
      const m =
        meta && typeof meta === 'object'
          ? (meta as { family?: string; style?: string })
          : undefined;
      return fontStore.embed(sourcePath, idx, m);
    },
  );
}
