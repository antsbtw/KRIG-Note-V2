/**
 * font-storage capability — renderer 侧字体能力(L5-G7b 记名方案)
 *
 * 职责:列本机系统字体(供 Aa 面板选)。**不再嵌入字体本体**(L5-G7b 转向:
 * 记名不嵌入)。选字体由 node-toolbar 直接 patchInstance({ text_font:'sysname:<family>' });
 * 本机渲染时 loadFont 经 IPC(fontReadByName)按名读 buffer,对方没装回退打包字体。
 *
 * 实现位置:src/platform/main/fonts/*(纯 main 进程 fs + name 解析)。本文件是
 * renderer 侧 IPC 调用封装,仿 [media-storage/index.ts](../media-storage/index.ts)。
 *
 * W5:capability 层是唯一允许业务 npm 的位置,但本能力纯 IPC,无 npm 依赖。
 */

import { capabilityRegistry } from '@slot/capability-registry/capability-registry';
import type { SystemFontEntryDTO } from '@shared/ipc/message-types';

export type { SystemFontEntryDTO };

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

capabilityRegistry.register({
  id: 'font-storage',
  api: { fontListSystem },
});
