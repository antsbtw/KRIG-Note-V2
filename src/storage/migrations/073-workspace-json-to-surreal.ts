/**
 * 迁移 073：Workspace JSON → SurrealDB（S3-b）
 *
 * 首次启动检查 userData/workspace-state.json 是否存在：
 * - 存在：把内容写进 workspace 表（UPSERT rid='current'），然后删 JSON 文件
 * - 不存在：跳过（首次安装，workspace-manager-main 会在 initWorkspaceManager 里
 *           按正常逻辑从 DB 加载，DB 为空则 ensureMinimum 新建默认 ws）
 *
 * 幂等：JSON 文件删除后再启动跳过；workspace 表 UPSERT 重复执行无副作用。
 */

import path from 'node:path';
import fs from 'node:fs';
import { app } from 'electron';
import { RecordId } from 'surrealdb';
import { getDB } from '@storage/surreal/client';
import type { WorkspaceManagerState } from '@workspace/workspace-state/workspace-state';

const WS_RECORD_ID = new RecordId('workspace', 'current');

export async function runMigration073IfNeeded(): Promise<void> {
  const jsonPath = path.join(app.getPath('userData'), 'workspace-state.json');

  if (!fs.existsSync(jsonPath)) {
    // JSON 已删或从未存在，跳过
    return;
  }

  let state: WorkspaceManagerState;
  try {
    const raw = fs.readFileSync(jsonPath, 'utf-8');
    state = JSON.parse(raw) as WorkspaceManagerState;
  } catch (err) {
    console.warn('[migration073] workspace-state.json parse failed, skipping:', err);
    return;
  }

  const db = getDB();
  await db.query(
    `UPSERT $rid SET workspaces = $workspaces, activeId = $activeId, counter = $counter`,
    {
      rid: WS_RECORD_ID,
      workspaces: state.workspaces,
      // SurrealDB option<string> 需要 undefined（NONE），不接受 null
      activeId: state.activeId ?? undefined,
      counter: state.counter,
    },
  );

  // 迁移成功后删 JSON 文件（避免下次启动重复迁入）
  try {
    fs.unlinkSync(jsonPath);
    console.log('[migration073] workspace-state.json migrated to SurrealDB and deleted');
  } catch (err) {
    console.warn('[migration073] failed to delete workspace-state.json:', err);
    // 不阻塞启动，下次启动会再 UPSERT 一次（幂等）
  }
}
