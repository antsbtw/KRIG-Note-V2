/**
 * mind IPC handlers(diglot mind v0,方案 B1)
 *
 * 对齐 graph/library-handlers.ts 模板。
 * ⚠️ 每个写操作后广播 list-changed —— 否则左侧树不刷新(看起来像"没保存")。
 */

import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '@shared/ipc/channel-names';
import { mindStore } from './mind-store';
import { broadcastMindListChanged } from './broadcast';

/** 入参窄化:IPC 边界一律不信任入参,类型不对就早退(fail loud 到日志)。 */
function asString(v: unknown, what: string): string | null {
  if (typeof v === 'string' && v.length > 0) return v;
  console.warn(`[mind] IPC 入参非法:${what} =`, v);
  return null;
}

export function registerMindHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.MIND_LIST, async () => mindStore.list());

  ipcMain.handle(IPC_CHANNELS.MIND_LOAD, async (_e, id: unknown) => {
    const mid = asString(id, 'id');
    return mid ? mindStore.load(mid) : null;
  });

  ipcMain.handle(
    IPC_CHANNELS.MIND_CREATE,
    async (_e, title: unknown, semantic: unknown, graphic: unknown, folderId: unknown) => {
      const t = typeof title === 'string' ? title : '未命名导图';
      const s = typeof semantic === 'string' ? semantic : '';
      const g = typeof graphic === 'string' ? graphic : '';
      const f = typeof folderId === 'string' ? folderId : null;
      const rec = await mindStore.create(t, s, g, f);
      await broadcastMindListChanged();
      return rec;
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.MIND_SAVE,
    async (_e, id: unknown, semantic: unknown, graphic: unknown, title: unknown) => {
      const mid = asString(id, 'id');
      if (!mid) return;
      // ⚠️ semantic/graphic 必须是字符串:传错类型就整个不写,
      //    不做「部分保存」—— 半写比不写更难查(可靠性纲领:反静默坍缩)。
      if (typeof semantic !== 'string' || typeof graphic !== 'string') {
        console.warn('[mind] save 入参非法,已拒绝写入', { semantic, graphic });
        return;
      }
      await mindStore.save(mid, semantic, graphic, typeof title === 'string' ? title : '未命名导图');
      await broadcastMindListChanged();
    },
  );

  ipcMain.handle(IPC_CHANNELS.MIND_DELETE, async (_e, id: unknown) => {
    const mid = asString(id, 'id');
    if (!mid) return;
    await mindStore.remove(mid);
    await broadcastMindListChanged();
  });

  ipcMain.handle(IPC_CHANNELS.MIND_RENAME, async (_e, id: unknown, title: unknown) => {
    const mid = asString(id, 'id');
    const t = asString(title, 'title');
    if (!mid || !t) return;
    await mindStore.rename(mid, t);
    await broadcastMindListChanged();
  });

  ipcMain.handle(
    IPC_CHANNELS.MIND_MOVE_TO_FOLDER,
    async (_e, id: unknown, folderId: unknown) => {
      const mid = asString(id, 'id');
      if (!mid) return;
      await mindStore.moveToFolder(mid, typeof folderId === 'string' ? folderId : null);
      await broadcastMindListChanged();
    },
  );

  ipcMain.handle(IPC_CHANNELS.MIND_DUPLICATE, async (_e, id: unknown) => {
    const mid = asString(id, 'id');
    if (!mid) return null;
    const rec = await mindStore.duplicate(mid);
    await broadcastMindListChanged();
    return rec;
  });
}
