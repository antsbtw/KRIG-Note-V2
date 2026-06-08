/**
 * Migration 028 — 文档结构边 → block atom 属性(Decision 028 Phase 3)
 *
 * electron wrapper:管 flag 文件 + 据 core 汇总判定是否写 flag。
 * 纯迁移逻辑(可单测,无 electron)在 028-block-structure-attrs-core.ts。
 *
 * 把每篇 note 的「顺序 + 层级 + 归属」从结构边(belongsToNote / childOf / nextSibling)
 * 迁移成 block atom 属性(noteId / parentId / order),并删除结构边。
 *
 * 算法(每篇 note,详 core):
 *  1. assemblePmDoc 旧边路径带 keep-latest 去重读**正确顺序**(损坏笔记在此被修复)
 *  2. 重新 dissect 成属性形态 → 3. putAtom 幂等写
 *  4. round-trip 校验(post 属性路径 vs pre hash 比对)
 *  5. 一致 → 删该 note 所有结构边;不一致 → 保留边(保守)
 *
 * 安全:Phase 1 边 fallback 仍在 → 迁移前/中途崩溃旧 assemble 仍能读;
 * 只在 round-trip 一致后才删边(删边前数据双份可回退);中断可重跑(幂等)。
 *
 * flag:{userData}/krig-data/migration-028-completed
 *  - 全篇成功(无 failed 无 round-trip mismatch)才写 flag;否则不写,启动下次重试。
 */

import path from 'node:path';
import { existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { app } from 'electron';
import { migrateAllNotes } from './028-block-structure-attrs-core';

const FLAG_DIR = path.join(app.getPath('userData'), 'krig-data');
const FLAG_PATH = path.join(FLAG_DIR, 'migration-028-completed');

export async function runMigration028IfNeeded(): Promise<void> {
  if (existsSync(FLAG_PATH)) return;

  const summary = await migrateAllNotes();

  // 只有"没有 failed 且没有 round-trip mismatch"才写 flag。
  // skipped(mismatch)说明仍有边未删 / 数据需人工,保守不写 flag → 下次启动重试。
  if (summary.failed === 0 && summary.skipped === 0) {
    writeFlag();
    console.log('[migration/028] flag written');
  } else {
    console.warn(
      `[migration/028] 有 ${summary.failed} 篇失败 + ${summary.skipped} 篇 round-trip 不一致,` +
        `本次不写 flag,启动下次重试`,
    );
  }
}

function writeFlag(): void {
  try {
    mkdirSync(FLAG_DIR, { recursive: true });
    writeFileSync(FLAG_PATH, '', 'utf-8');
  } catch (err) {
    console.error('[migration/028] flag 写入失败,启动下次会重跑:', err);
  }
}
