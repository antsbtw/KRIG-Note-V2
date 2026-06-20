/**
 * font-storage capability — renderer 侧字体存储能力(L5-G7.2)
 *
 * 职责:列系统字体 + 把选中系统字体嵌进画板内容(返回 font:// URL + fontId)。
 * 实现位置:src/platform/main/fonts/*(纯 main 进程,fs + 协议 + JSON 索引)。
 * 本文件是 renderer 侧 IPC 调用封装,1:1 仿
 * [media-storage/index.ts](../media-storage/index.ts)。
 *
 * 用途:
 * - node-toolbar Aa 面板「系统字体」分组:fontListSystem 拉清单
 * - 选系统字体 → fontEmbed 嵌入 → patchInstance({ text_font: 'embed:'+fontId })
 * - 渲染:loadFont 识别 embed: 前缀 → fetch('font://...')(协议 main 注册)
 *
 * W5:capability 层是唯一允许业务 npm 的位置,但本能力纯 IPC,无 npm 依赖。
 */

import { capabilityRegistry } from '@slot/capability-registry/capability-registry';
import type { SystemFontEntryDTO } from '@shared/ipc/message-types';

export type { SystemFontEntryDTO };

export interface FontEmbedResult {
  success: boolean;
  error?: string;
  /** 嵌入字体 id(text_font 写 `embed:<fontId>`) */
  fontId?: string;
  /** font:// URL(loadFont fetch 用) */
  fontUrl?: string;
  /** 落盘体积 KB(供 8MB 体积守卫) */
  sizeKb?: number;
  family?: string;
  style?: string;
}

/** 扫本机系统字体(失败返回空清单,不抛) */
export async function fontListSystem(): Promise<SystemFontEntryDTO[]> {
  if (!window.electronAPI?.fontListSystem) return [];
  try {
    const r = await window.electronAPI.fontListSystem();
    return r.success ? r.fonts : [];
  } catch {
    return [];
  }
}

/**
 * 嵌入一个系统字体(.ttc 抽指定子字体)→ font:// + fontId。
 * 调用前 UI 应已过 8MB 体积守卫 + license 提示确认(G7.4)。
 */
export async function fontEmbed(
  sourcePath: string,
  fontIndex: number,
  meta?: { family?: string; style?: string },
): Promise<FontEmbedResult> {
  if (!window.electronAPI?.fontEmbed) {
    return { success: false, error: 'electronAPI.fontEmbed not available' };
  }
  return window.electronAPI.fontEmbed(sourcePath, fontIndex, meta);
}

capabilityRegistry.register({
  id: 'font-storage',
  api: { fontListSystem, fontEmbed },
});
