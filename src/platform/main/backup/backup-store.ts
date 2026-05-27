/**
 * Backup / Restore — 数据安全网
 *
 * Backup  → surreal export → database.surql + 文件目录复制 → tar.gz
 * Restore → tar.gz 解压 → manifest 校验 → 旧 DB 改名 .pre-restore →
 *           surreal import + 文件恢复 → 失败回滚旧 DB
 *
 * V2 数据布局({userData}/krig-data/):
 *   surreal/         SurrealDB rocksdb 数据(不直接打包,走 surreal export → .surql)
 *   media/           media:// 协议下的图片 / PDF / 视频副本
 *   ebook/library/   managed 模式电子书副本({ebookAtomId}.{ext})
 *   learning/        vocab.json
 *   (.db-credentials 在 userData 根目录,不在 krig-data 下,但必须打包)
 *
 * 兼容性:manifest.version=2 + app='KRIG Note V2',严格拒绝 V1 备份。
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { app } from 'electron';

import {
  findSurrealBinary,
  getConnectionInfo,
  shutdownSurrealDBAsync,
} from '@storage/surreal/client';
import { initStorage } from '@storage/index';
import { storage } from '@storage/index';
import type { AtomEntity, EBookPayload } from '@semantic/types';

import type { BackupResult, RestoreResult } from '@shared/ipc/backup-types';

export type ProgressReporter = (
  message: string,
  current?: number,
  total?: number,
) => void;

const noop: ProgressReporter = () => {};

const MANIFEST_VERSION = 2;
const MANIFEST_APP = 'KRIG Note V2';

interface BackupPaths {
  userData: string;
  /** SurrealDB rocksdb 数据(restore 时整目录 rename → .pre-restore) */
  dbDir: string;
  /** media:// 协议存储 */
  mediaDir: string;
  /** 电子书 managed 库(library 子目录) */
  ebookLibraryDir: string;
  /** learning(vocab.json 单文件 + 未来可扩展) */
  learningDir: string;
  /** SurrealDB 凭据文件(无此文件 restore 后连不上库) */
  credentialsFile: string;
}

function getPaths(): BackupPaths {
  const userData = app.getPath('userData');
  return {
    userData,
    dbDir: path.join(userData, 'krig-data', 'surreal'),
    mediaDir: path.join(userData, 'krig-data', 'media'),
    ebookLibraryDir: path.join(userData, 'krig-data', 'ebook', 'library'),
    learningDir: path.join(userData, 'krig-data', 'learning'),
    credentialsFile: path.join(userData, '.db-credentials'),
  };
}

/** 执行子进程,Promise 包装 */
function run(
  cmd: string,
  args: string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const proc = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    proc.stdout?.on('data', (d: Buffer) => {
      stdout += d.toString();
    });
    proc.stderr?.on('data', (d: Buffer) => {
      stderr += d.toString();
    });
    proc.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
    proc.on('error', (err) => resolve({ code: 1, stdout: '', stderr: err.message }));
  });
}

/**
 * 重写 managed 电子书 atom 的 payload.filePath 到当前 ebookLibraryDir。
 *
 * managed 文件名约定:{ebookAtomId}{ext}(见 ebook capability-impl.ts §27 路径注释)。
 * 备份里 atom.payload.filePath 是源机的绝对路径,跨机器还原时必须按本机 path 拼装。
 * link 模式书原样保留(依赖用户原盘路径)。
 */
async function rewriteManagedEBookPaths(currentLibraryDir: string): Promise<void> {
  const atoms = (await storage.listAtoms({
    domain: 'ebook',
  })) as AtomEntity<'ebook'>[];

  for (const atom of atoms) {
    const payload = atom.payload.payload as EBookPayload;
    if (payload.storage !== 'managed' || !payload.filePath) continue;
    const ext = path.extname(payload.filePath);
    const newPath = path.join(currentLibraryDir, `${atom.id}${ext}`);
    if (newPath === payload.filePath) continue;
    const updated: EBookPayload = { ...payload, filePath: newPath };
    await storage.putAtom<'ebook'>({
      id: atom.id,
      payload: { domain: 'ebook', payload: updated },
    });
  }
}

export const backupStore = {
  async backup(
    destPath: string,
    report: ProgressReporter = noop,
  ): Promise<BackupResult> {
    const binary = findSurrealBinary();
    if (!binary) {
      return { success: false, error: 'SurrealDB binary not found' };
    }

    const conn = getConnectionInfo();
    const paths = getPaths();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'krig-backup-'));
    const backupName = `krig-backup-${new Date()
      .toISOString()
      .replace(/[:.]/g, '-')
      .slice(0, 19)}`;
    const contentDir = path.join(tmpDir, backupName);
    fs.mkdirSync(contentDir, { recursive: true });

    const TOTAL_STEPS = 7;
    try {
      // 1. surreal export
      report('导出数据库...', 1, TOTAL_STEPS);
      const surqlPath = path.join(contentDir, 'database.surql');
      const exportResult = await run(binary, [
        'export',
        '--endpoint', conn.endpoint,
        '--username', conn.username,
        '--password', conn.password,
        '--namespace', conn.namespace,
        '--database', conn.database,
        surqlPath,
      ]);
      if (exportResult.code !== 0) {
        return {
          success: false,
          error: `surreal export failed: ${exportResult.stderr}`,
        };
      }

      // 2. 复制 media 目录
      report('复制媒体文件...', 2, TOTAL_STEPS);
      if (fs.existsSync(paths.mediaDir)) {
        fs.cpSync(paths.mediaDir, path.join(contentDir, 'media'), { recursive: true });
      }

      // 3. 复制 ebook library 目录(managed 模式文件副本)
      report('复制电子书...', 3, TOTAL_STEPS);
      if (fs.existsSync(paths.ebookLibraryDir)) {
        fs.cpSync(
          paths.ebookLibraryDir,
          path.join(contentDir, 'ebook', 'library'),
          { recursive: true },
        );
      }

      // 4. 复制 learning 目录(vocab.json)
      report('复制学习数据...', 4, TOTAL_STEPS);
      if (fs.existsSync(paths.learningDir)) {
        fs.cpSync(paths.learningDir, path.join(contentDir, 'learning'), {
          recursive: true,
        });
      }

      // 5. 复制 .db-credentials(restore 后必须用来连库,否则启不来)
      report('复制数据库凭据...', 5, TOTAL_STEPS);
      if (fs.existsSync(paths.credentialsFile)) {
        fs.copyFileSync(paths.credentialsFile, path.join(contentDir, 'db-credentials.json'));
      }

      // 6. 写入 manifest
      report('写入元数据...', 6, TOTAL_STEPS);
      fs.writeFileSync(
        path.join(contentDir, 'manifest.json'),
        JSON.stringify(
          {
            version: MANIFEST_VERSION,
            app: MANIFEST_APP,
            createdAt: new Date().toISOString(),
            includes: ['database.surql', 'media', 'ebook/library', 'learning', 'db-credentials.json'],
          },
          null,
          2,
        ),
      );

      // 7. tar 打包(macOS / Linux 内置 tar 支持 -czf)
      report('压缩为归档文件(耗时较长)...', 7, TOTAL_STEPS);
      const tarResult = await run('tar', ['-czf', destPath, '-C', tmpDir, backupName]);
      if (tarResult.code !== 0) {
        return { success: false, error: `tar failed: ${tarResult.stderr}` };
      }

      const stat = fs.statSync(destPath);
      console.log(
        `[Backup] Created: ${destPath} (${(stat.size / 1024 / 1024).toFixed(1)} MB)`,
      );
      return { success: true, path: destPath, size: stat.size };
    } catch (err) {
      return { success: false, error: String(err) };
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  },

  async restore(
    archivePath: string,
    report: ProgressReporter = noop,
  ): Promise<RestoreResult> {
    const binary = findSurrealBinary();
    if (!binary) {
      return { success: false, error: 'SurrealDB binary not found' };
    }

    const paths = getPaths();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'krig-restore-'));
    const TOTAL_STEPS = 9;

    try {
      // 1. 解压
      report('解压备份文件...', 1, TOTAL_STEPS);
      const extractResult = await run('tar', ['-xzf', archivePath, '-C', tmpDir]);
      if (extractResult.code !== 0) {
        return {
          success: false,
          error: `tar extract failed: ${extractResult.stderr}`,
        };
      }

      // 找到解压后的顶层目录(tar 时打的是 backupName/ 子目录)
      const entries = fs.readdirSync(tmpDir);
      const contentDir = entries.length === 1 ? path.join(tmpDir, entries[0]) : tmpDir;

      // 2. 验证 manifest
      report('验证备份文件...', 2, TOTAL_STEPS);
      const manifestPath = path.join(contentDir, 'manifest.json');
      if (!fs.existsSync(manifestPath)) {
        return { success: false, error: 'Invalid backup: manifest.json not found' };
      }
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      if (manifest.version !== MANIFEST_VERSION || manifest.app !== MANIFEST_APP) {
        return {
          success: false,
          error: `Unsupported backup: version=${manifest.version} app=${manifest.app} (V2 仅接受 version=${MANIFEST_VERSION} / app='${MANIFEST_APP}')`,
        };
      }

      const surqlPath = path.join(contentDir, 'database.surql');
      if (!fs.existsSync(surqlPath)) {
        return { success: false, error: 'Invalid backup: database.surql not found' };
      }

      // 3. 关闭 SurrealDB 并安全重命名旧 DB 目录(保留 .pre-restore 作回滚点)
      report('关闭数据库服务...', 3, TOTAL_STEPS);
      await shutdownSurrealDBAsync();

      const preRestoreDir = `${paths.dbDir}.pre-restore`;
      if (fs.existsSync(preRestoreDir)) {
        fs.rmSync(preRestoreDir, { recursive: true, force: true });
      }
      if (fs.existsSync(paths.dbDir)) {
        fs.renameSync(paths.dbDir, preRestoreDir);
      }

      // 备份并恢复 .db-credentials(必须在启 surreal 之前到位,否则 surreal 用旧凭据启,
      // import 时也用旧凭据但 conn 信息保留;先写新凭据再 initStorage)
      const credBackupFromArchive = path.join(contentDir, 'db-credentials.json');
      let preRestoreCredentials: string | null = null;
      if (fs.existsSync(paths.credentialsFile)) {
        preRestoreCredentials = fs.readFileSync(paths.credentialsFile, 'utf-8');
      }
      if (fs.existsSync(credBackupFromArchive)) {
        fs.copyFileSync(credBackupFromArchive, paths.credentialsFile);
      }

      // 4. 启动 SurrealDB(空 rocksdb)+ schema migration
      report('初始化新数据库...', 4, TOTAL_STEPS);
      await initStorage();

      // 5. surreal import
      report('导入数据...', 5, TOTAL_STEPS);
      const conn = getConnectionInfo();
      const importResult = await run(binary, [
        'import',
        '--endpoint', conn.endpoint,
        '--username', conn.username,
        '--password', conn.password,
        '--namespace', conn.namespace,
        '--database', conn.database,
        surqlPath,
      ]);
      if (importResult.code !== 0) {
        // 回滚:恢复旧 DB + 旧凭据
        await shutdownSurrealDBAsync();
        if (fs.existsSync(paths.dbDir)) {
          fs.rmSync(paths.dbDir, { recursive: true, force: true });
        }
        if (fs.existsSync(preRestoreDir)) {
          fs.renameSync(preRestoreDir, paths.dbDir);
        }
        if (preRestoreCredentials != null) {
          fs.writeFileSync(paths.credentialsFile, preRestoreCredentials, 'utf-8');
        }
        await initStorage();
        return {
          success: false,
          error: `surreal import failed: ${importResult.stderr}`,
        };
      }

      // 6. 恢复 media
      report('恢复媒体文件...', 6, TOTAL_STEPS);
      const backupMedia = path.join(contentDir, 'media');
      if (fs.existsSync(backupMedia)) {
        if (fs.existsSync(paths.mediaDir)) {
          fs.rmSync(paths.mediaDir, { recursive: true, force: true });
        }
        fs.mkdirSync(path.dirname(paths.mediaDir), { recursive: true });
        fs.cpSync(backupMedia, paths.mediaDir, { recursive: true });
      }

      // 7. 恢复 ebook library
      report('恢复电子书...', 7, TOTAL_STEPS);
      const backupEbook = path.join(contentDir, 'ebook', 'library');
      if (fs.existsSync(backupEbook)) {
        if (fs.existsSync(paths.ebookLibraryDir)) {
          fs.rmSync(paths.ebookLibraryDir, { recursive: true, force: true });
        }
        fs.mkdirSync(path.dirname(paths.ebookLibraryDir), { recursive: true });
        fs.cpSync(backupEbook, paths.ebookLibraryDir, { recursive: true });
      }

      // 7b. 重写 managed 电子书 atom 的 filePath — 备份里存的是源机绝对路径,
      // 还原到不同 userData(换电脑 / 重置后)时会失效。按 {atomId}{ext} 拼接当前
      // ebookLibraryDir。link 模式书原样保留(依赖用户原盘路径)。
      await rewriteManagedEBookPaths(paths.ebookLibraryDir);

      // 8. 恢复 learning
      report('恢复学习数据...', 8, TOTAL_STEPS);
      const backupLearning = path.join(contentDir, 'learning');
      if (fs.existsSync(backupLearning)) {
        if (fs.existsSync(paths.learningDir)) {
          fs.rmSync(paths.learningDir, { recursive: true, force: true });
        }
        fs.mkdirSync(path.dirname(paths.learningDir), { recursive: true });
        fs.cpSync(backupLearning, paths.learningDir, { recursive: true });
      }

      // 9. 清理 .pre-restore 备份
      report('清理临时文件...', 9, TOTAL_STEPS);
      if (fs.existsSync(preRestoreDir)) {
        fs.rmSync(preRestoreDir, { recursive: true, force: true });
      }

      console.log(
        `[Backup] Restored from: ${archivePath} (backup date: ${manifest.createdAt})`,
      );
      return { success: true };
    } catch (err) {
      return { success: false, error: String(err) };
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  },
};
