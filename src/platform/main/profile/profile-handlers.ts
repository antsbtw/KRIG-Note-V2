/**
 * Window Profile IPC handlers（主进程）
 *
 * 5 invoke（list / get / create / update / delete）
 * + 1 广播（PROFILE_LIST_CHANGED）在写操作后发给所有窗口。
 */

import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '@shared/ipc/channel-names';
import type { Profile, ProfileColor } from '@shared/types/profile-types';
import { profileStore } from './profile-store';
import { getAllWindows } from '../window/main-window';

function broadcastProfileListChanged(): void {
  void profileStore.list().then((list) => {
    for (const win of getAllWindows()) {
      win.webContents.send(IPC_CHANNELS.PROFILE_LIST_CHANGED, list);
    }
  });
}

export function registerProfileHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.PROFILE_LIST, async (): Promise<Profile[]> => {
    return profileStore.list();
  });

  ipcMain.handle(IPC_CHANNELS.PROFILE_GET, async (_event, id: string): Promise<Profile | null> => {
    return (await profileStore.get(id)) ?? null;
  });

  ipcMain.handle(
    IPC_CHANNELS.PROFILE_CREATE,
    async (
      _event,
      input: { name: string; color: ProfileColor; proxyId?: string; userAgent?: string },
    ): Promise<Profile> => {
      const profile = await profileStore.create({
        name: typeof input.name === 'string' ? input.name.trim() || 'New Profile' : 'New Profile',
        color: input.color ?? 'blue',
        proxyId: input.proxyId,
        userAgent: input.userAgent,
      });
      broadcastProfileListChanged();
      return profile;
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.PROFILE_UPDATE,
    async (
      _event,
      id: string,
      patch: Partial<{ name: string; color: ProfileColor; proxyId: string; userAgent: string }>,
    ): Promise<Profile | null> => {
      const updated = await profileStore.update(id, patch);
      if (updated) broadcastProfileListChanged();
      return updated;
    },
  );

  ipcMain.handle(IPC_CHANNELS.PROFILE_DELETE, async (_event, id: string): Promise<void> => {
    await profileStore.remove(id);
    broadcastProfileListChanged();
  });
}
