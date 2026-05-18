/**
 * thought IPC handlers(对齐 note/handlers.ts 同模式)
 *
 * 注册入口:src/platform/main/ipc/ipc-bus.ts initIpcBus()。
 *
 * 8 invoke + 1 broadcast = 9 channel-names(thought-view-port.md v0.5 §5.3 数字对齐)。
 */

import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '@shared/ipc/channel-names';
import type {
  ThoughtAnchor,
  ThoughtInfo,
  ThoughtSource,
} from '@shared/ipc/thought-types';
import {
  createThought,
  listThoughts,
  listThoughtsBySource,
  getThought,
  updateThought,
  deleteThought,
  moveThoughtToFolder,
  updateThoughtAnchor,
} from './capability-impl';
import { broadcastThoughtListChanged } from './broadcast';

// ── 入参校验 ──

function isSource(v: unknown): v is ThoughtSource {
  return v === 'note' || v === 'book' || v === 'graph' || v === 'canvas';
}

function isAnchor(v: unknown): v is ThoughtAnchor {
  if (!v || typeof v !== 'object') return false;
  const a = v as Record<string, unknown>;
  if (!isSource(a.source)) return false;
  if (typeof a.resourceId !== 'string' || !a.resourceId) return false;
  if (!a.locator || typeof a.locator !== 'object') return false;
  return true;
}

function isThoughtCreateInfo(
  v: unknown,
): v is Omit<ThoughtInfo, 'id' | 'createdAt' | 'updatedAt'> {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  if (typeof o.type !== 'string') return false;
  if (typeof o.resolved !== 'boolean') return false;
  if (typeof o.pinned !== 'boolean') return false;
  if (!o.doc || typeof o.doc !== 'object') return false;
  // anchor 必须显式存在(null 或 ThoughtAnchor),不能 undefined
  if (!('anchor' in o)) return false;
  if (o.anchor !== null && !isAnchor(o.anchor)) return false;
  // folderId 必须显式存在(null 或 string)
  if (!('folderId' in o)) return false;
  if (o.folderId !== null && typeof o.folderId !== 'string') return false;
  return true;
}

export function registerThoughtHandlers(): void {
  // #1 thoughtCreate(单步原子)
  ipcMain.handle(IPC_CHANNELS.THOUGHT_CREATE, async (_e, payload: unknown) => {
    if (!isThoughtCreateInfo(payload)) return null;
    const thought = await createThought(payload);
    await broadcastThoughtListChanged();
    return thought;
  });

  // #2 thoughtList
  ipcMain.handle(IPC_CHANNELS.THOUGHT_LIST, async () => listThoughts());

  // #3 thoughtListBySource
  ipcMain.handle(
    IPC_CHANNELS.THOUGHT_LIST_BY_SOURCE,
    async (_e, payload: unknown) => {
      const p = payload as { source?: unknown; resourceId?: unknown } | null;
      if (!p || !isSource(p.source) || typeof p.resourceId !== 'string' || !p.resourceId) {
        return [];
      }
      return listThoughtsBySource(p.source, p.resourceId);
    },
  );

  // #4 thoughtGet
  ipcMain.handle(IPC_CHANNELS.THOUGHT_GET, async (_e, id: unknown) => {
    if (typeof id !== 'string' || !id) return null;
    return getThought(id);
  });

  // #5 thoughtUpdate
  ipcMain.handle(IPC_CHANNELS.THOUGHT_UPDATE, async (_e, payload: unknown) => {
    const p = payload as { id?: unknown; updates?: unknown } | null;
    if (!p || typeof p.id !== 'string' || !p.id) return null;
    if (!p.updates || typeof p.updates !== 'object') return null;
    const updated = await updateThought(
      p.id,
      p.updates as Parameters<typeof updateThought>[1],
    );
    if (updated) await broadcastThoughtListChanged();
    return updated;
  });

  // #6 thoughtDelete
  ipcMain.handle(IPC_CHANNELS.THOUGHT_DELETE, async (_e, id: unknown) => {
    if (typeof id !== 'string' || !id) return;
    await deleteThought(id);
    await broadcastThoughtListChanged();
  });

  // #7 thoughtMoveToFolder
  ipcMain.handle(
    IPC_CHANNELS.THOUGHT_MOVE_TO_FOLDER,
    async (_e, payload: unknown) => {
      const p = payload as { thoughtId?: unknown; folderId?: unknown } | null;
      if (!p || typeof p.thoughtId !== 'string' || !p.thoughtId) return;
      const folderId =
        typeof p.folderId === 'string' && p.folderId ? p.folderId : null;
      await moveThoughtToFolder(p.thoughtId, folderId);
      await broadcastThoughtListChanged();
    },
  );

  // #8 thoughtUpdateAnchor
  ipcMain.handle(
    IPC_CHANNELS.THOUGHT_UPDATE_ANCHOR,
    async (_e, payload: unknown) => {
      const p = payload as { thoughtId?: unknown; anchor?: unknown } | null;
      if (!p || typeof p.thoughtId !== 'string' || !p.thoughtId) return;
      if (!('anchor' in p)) return;
      if (p.anchor !== null && !isAnchor(p.anchor)) return;
      await updateThoughtAnchor(p.thoughtId, p.anchor as ThoughtAnchor | null);
      await broadcastThoughtListChanged();
    },
  );
}
