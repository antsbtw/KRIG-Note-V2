/**
 * backup-restore IPC handlers
 *
 * 注册入口:src/platform/main/ipc/ipc-bus.ts initIpcBus()
 *
 * 2 invoke = BACKUP_RUN / BACKUP_RESTORE。
 * 长耗时,handler 内走 runWithProgress 向主 renderer 推 PROGRESS_* 事件。
 *
 * 实际打包 / 解包 / SurrealDB export-import 在 ./backup-store。
 */

import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '@shared/ipc/channel-names';
import type { BackupResult, RestoreResult } from '@shared/ipc/backup-types';
import { runWithProgress } from '../window/run-with-progress';
import { backupStore } from './backup-store';

export function registerBackupHandlers(): void {
  ipcMain.handle(
    IPC_CHANNELS.BACKUP_RUN,
    async (_e, destPath: unknown): Promise<BackupResult> => {
      if (typeof destPath !== 'string' || !destPath) {
        return { success: false, error: 'invalid destPath' };
      }
      try {
        return await runWithProgress(
          '数据备份中',
          (report) => backupStore.backup(destPath, report),
          {
            doneMessage: (r) =>
              r.success
                ? {
                    success: true,
                    message: `备份完成 (${((r.size ?? 0) / 1024 / 1024).toFixed(1)} MB)`,
                  }
                : { success: false, message: r.error ?? 'Unknown error' },
          },
        );
      } catch (err) {
        return { success: false, error: String(err) };
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.BACKUP_RESTORE,
    async (_e, archivePath: unknown): Promise<RestoreResult> => {
      if (typeof archivePath !== 'string' || !archivePath) {
        return { success: false, error: 'invalid archivePath' };
      }
      try {
        return await runWithProgress(
          '数据恢复中',
          (report) => backupStore.restore(archivePath, report),
          {
            doneMessage: (r) =>
              r.success
                ? { success: true, message: '恢复完成。应用即将退出,请手动启动。' }
                : { success: false, message: r.error ?? 'Unknown error' },
          },
        );
      } catch (err) {
        return { success: false, error: String(err) };
      }
    },
  );
}
