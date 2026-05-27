/**
 * 注册 File 菜单的 Backup / Restore 命令(对齐 markdown-import 同模式)
 *
 * 命令:
 *   file.backup    Backup All Data...     → 弹保存对话框 → 调 backupStore.backup
 *   file.restore   Restore from Backup... → 弹确认 + 选文件 → 调 backupStore.restore → 退出 app
 *
 * 进度反馈走 runWithProgress → IPC 推 PROGRESS_* → renderer GlobalProgressOverlay。
 */

import { dialog, app, BrowserWindow } from 'electron';
import { menuRegistry } from '@slot/menu-registry/menu-registry';
import { runWithProgress } from '../window/run-with-progress';
import { backupStore } from './backup-store';

async function runBackup(): Promise<void> {
  const win = BrowserWindow.getFocusedWindow();
  const defaultName = `krig-backup-${new Date().toISOString().slice(0, 10)}.tar.gz`;
  const saveResult = win
    ? await dialog.showSaveDialog(win, {
        title: 'Backup All Data',
        defaultPath: defaultName,
        filters: [{ name: 'KRIG Backup', extensions: ['tar.gz'] }],
      })
    : await dialog.showSaveDialog({
        title: 'Backup All Data',
        defaultPath: defaultName,
        filters: [{ name: 'KRIG Backup', extensions: ['tar.gz'] }],
      });
  if (saveResult.canceled || !saveResult.filePath) return;

  const destPath = saveResult.filePath;
  await runWithProgress(
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
  ).catch((err) => {
    console.error('[backup] runBackup failed:', err);
  });
}

async function runRestore(): Promise<void> {
  const win = BrowserWindow.getFocusedWindow();

  // 显式二次确认 — 恢复会全盘覆盖
  const confirm = win
    ? await dialog.showMessageBox(win, {
        type: 'warning',
        buttons: ['Cancel', 'Restore'],
        defaultId: 0,
        cancelId: 0,
        title: 'Restore from Backup',
        message: 'This will replace ALL current data with the backup.',
        detail: '当前数据库 / 媒体 / 电子书 / 生词将被覆盖,且无法撤销。是否继续?',
      })
    : await dialog.showMessageBox({
        type: 'warning',
        buttons: ['Cancel', 'Restore'],
        defaultId: 0,
        cancelId: 0,
        title: 'Restore from Backup',
        message: 'This will replace ALL current data with the backup.',
      });
  if (confirm.response !== 1) return;

  const openResult = win
    ? await dialog.showOpenDialog(win, {
        title: 'Select Backup File',
        filters: [{ name: 'KRIG Backup', extensions: ['tar.gz'] }],
        properties: ['openFile'],
      })
    : await dialog.showOpenDialog({
        title: 'Select Backup File',
        filters: [{ name: 'KRIG Backup', extensions: ['tar.gz'] }],
        properties: ['openFile'],
      });
  if (openResult.canceled || openResult.filePaths.length === 0) return;

  const archivePath = openResult.filePaths[0];
  const result = await runWithProgress(
    '数据恢复中',
    (report) => backupStore.restore(archivePath, report),
    {
      doneMessage: (r) =>
        r.success
          ? { success: true, message: '恢复完成。应用即将退出,请手动启动。' }
          : { success: false, message: r.error ?? 'Unknown error' },
    },
  ).catch((err) => {
    console.error('[backup] runRestore failed:', err);
    return { success: false } as const;
  });

  if (result.success) {
    // 成功后退出 — 让用户手动重启避免 dev 模式下 relaunch 黑屏
    // 保留 1.5s 让 overlay 显示 "恢复完成" 文案
    setTimeout(() => app.exit(0), 1500);
  }
}

/** 注册菜单命令(由 framework-menus.ts 在 rebuild 前调用) */
export function registerBackupMenu(): void {
  menuRegistry.registerCommand('file.backup', () => {
    void runBackup();
  });
  menuRegistry.registerCommand('file.restore', () => {
    void runRestore();
  });
}
