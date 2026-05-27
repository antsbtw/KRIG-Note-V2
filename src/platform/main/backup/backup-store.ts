/**
 * Backup / Restore — 数据安全网(骨架占位,Commit 3 填实现)
 *
 * 设计:
 *   Backup  → surreal export → database.surql + 文件目录复制 → tar.gz
 *   Restore → tar.gz 解压 → manifest 校验 → 旧 DB 改名 .pre-restore →
 *             surreal import + 文件恢复 → 失败回滚旧 DB
 *
 * V2 vs V1:V2 数据集中在 {userData}/krig-data/ 一个根目录下,
 * 备份内容比 V1 多 vocab.json + .db-credentials。
 */

import type { BackupResult, RestoreResult } from '@shared/ipc/backup-types';

/** 进度上报回调 — 阶段文字 + 可选 current/total */
export type ProgressReporter = (
  message: string,
  current?: number,
  total?: number,
) => void;

const noop: ProgressReporter = () => {};

export const backupStore = {
  async backup(
    _destPath: string,
    _report: ProgressReporter = noop,
  ): Promise<BackupResult> {
    return { success: false, error: 'backup-store not yet implemented' };
  },

  async restore(
    _archivePath: string,
    _report: ProgressReporter = noop,
  ): Promise<RestoreResult> {
    return { success: false, error: 'backup-store not yet implemented' };
  },
};
