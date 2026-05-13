/**
 * pm-content IPC handlers (decision 014 §3.4 §5.4)
 *
 * 模板对齐 src/platform/main/note/handlers.ts:
 * - 入参 typeof + envelope 形状严格校验
 * - 本 sub-phase 不广播 list-changed (3a-1 范围内 pm-content 无列表 UI 消费)
 *
 * 注册入口:src/platform/main/ipc/ipc-bus.ts.initIpcBus()
 */

import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '@shared/ipc/channel-names';
import type { PmDocEnvelope } from '@shared/ipc/pm-content-types';
import { createPmAtom, getPmAtom, updatePmAtom } from './capability-impl';

function isDocEnvelope(v: unknown): v is PmDocEnvelope {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return typeof o.format === 'string' && typeof o.version === 'string' && 'payload' in o;
}

export function registerPmContentHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.PM_CONTENT_CREATE, async (_e, doc: unknown) => {
    if (!isDocEnvelope(doc)) return null;
    return createPmAtom(doc);
  });

  ipcMain.handle(IPC_CHANNELS.PM_CONTENT_GET, async (_e, id: unknown) => {
    if (typeof id !== 'string' || !id) return null;
    return getPmAtom(id);
  });

  ipcMain.handle(IPC_CHANNELS.PM_CONTENT_UPDATE, async (_e, id: unknown, doc: unknown) => {
    if (typeof id !== 'string' || !id) return null;
    if (!isDocEnvelope(doc)) return null;
    return updatePmAtom(id, doc);
  });
}
