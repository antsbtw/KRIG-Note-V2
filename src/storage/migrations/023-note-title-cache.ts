/**
 * sub-phase 023 — note title 缓存 backfill (2026-05-28)
 *
 * 背景:
 * - L7 block atomization 后 note title 不存在 atom payload,listNotes 必须
 *   assemblePmDoc 拼整篇 doc 再 deriveTitle → 单 note 200ms × N 篇 = 几十秒
 * - Phase A8 加 attrs.title 缓存 + lazy backfill 时 N 路并发 putAtom 触发
 *   SurrealDB ws 雪崩(NotAllowed auth crash)
 * - 改:**冷启动期串行**回填一次,后续 listNotes/listNoteTitles 直接命中 cache
 *
 * 串行迁移:每篇 note 跑 1 次 assemblePmDoc + 1 次 putAtom(更新 attrs.title),
 * 单 note ~200-300ms。100 篇 = 20-30s 一次性付。
 *
 * flag 文件:{userData}/krig-data/migration-023-completed
 * - 存在 → 跳过(已 backfill 完成)
 * - 不存在 → 启动期跑一遍,每篇成功再继续(失败抛错下次重试,不写 flag)
 *
 * 注:本 migration 不破坏数据,可以中断重跑(每篇 putAtom 是 UPSERT 幂等)。
 */

import path from 'node:path';
import { existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { app } from 'electron';
import { storage } from '@storage/index';
import type { PmPayload } from '@semantic/types';
import { assemblePmDoc } from '@platform/main/note/assemble-pm-doc';
import { deriveTitle } from '@platform/main/note/derive-title';

const FLAG_DIR = path.join(app.getPath('userData'), 'krig-data');
const FLAG_PATH = path.join(FLAG_DIR, 'migration-023-completed');

// migration 023 进行中标记 — listNoteTitles fallback 路径检查此 flag,
// 进行中时 fallback 等待 migration 完成,避免两边同时 assemble + putAtom 雪崩
let backfillInFlight: Promise<void> | null = null;

/** 给 capability-impl 暴露:listNoteTitles fallback 时 await 此函数 */
export function waitForTitleBackfill(): Promise<void> {
  return backfillInFlight ?? Promise.resolve();
}

const NOTE_DOMAIN = 'pm';
const HAS_NOTE_VIEW_PREDICATE = 'user:krig:hasNoteView';

function containerPayloadWithTitle(title: string): PmPayload {
  return { type: 'doc', attrs: { title }, content: [] };
}

function hasCachedTitle(payload: PmPayload): boolean {
  return typeof payload.attrs?.title === 'string';
}

export async function runMigration023IfNeeded(): Promise<void> {
  if (existsSync(FLAG_PATH)) return;
  if (backfillInFlight) return backfillInFlight;

  backfillInFlight = doBackfill().finally(() => {
    backfillInFlight = null;
  });
  return backfillInFlight;
}

async function doBackfill(): Promise<void> {

  // 找所有 note container atom
  // P1-1 (2026-05-29 data-layer-audit): 走 listMarkerAtoms,SQL 走 INSIDE subquery,
  // 免拉全 pm domain (含 block atom)再应用层 filter.
  const noteAtoms = await storage.listMarkerAtoms<'pm'>({
    domain: NOTE_DOMAIN,
    markerPredicate: HAS_NOTE_VIEW_PREDICATE,
    markerObjectMatch: { kind: 'literal', type: 'boolean', value: true },
  });

  // 已缓存 title 的跳过(可能上次 migration 被中断或者 createNote 已写过)
  const pending = noteAtoms.filter((a) => !hasCachedTitle(a.payload.payload));

  if (pending.length === 0) {
    // 全都已有缓存 — 直接写 flag
    try {
      mkdirSync(FLAG_DIR, { recursive: true });
      writeFileSync(FLAG_PATH, '', 'utf-8');
    } catch (err) {
      console.error('[migration/023] flag 写入失败:', err);
    }
    console.log(`[migration/023] all ${noteAtoms.length} notes already have cached title, skip`);
    return;
  }

  console.log(
    `[migration/023] backfilling attrs.title for ${pending.length}/${noteAtoms.length} notes (serial)`,
  );

  const t0 = Date.now();
  let done = 0;
  let failed = 0;

  // 串行 — 避免 SurrealDB ws 并发雪崩(参考 A8 lazy backfill 崩盘教训)
  for (const atom of pending) {
    try {
      const assembled = await assemblePmDoc(atom.id);
      if (!assembled) {
        console.warn(`[migration/023] assemble null for ${atom.id}, skip`);
        failed++;
        continue;
      }
      const title = deriveTitle(assembled);
      await storage.putAtom<'pm'>({
        id: atom.id,
        payload: { domain: NOTE_DOMAIN, payload: containerPayloadWithTitle(title) },
      });
      done++;
      if (done % 10 === 0) {
        console.log(`[migration/023] progress: ${done}/${pending.length}`);
      }
    } catch (err) {
      failed++;
      console.warn(`[migration/023] failed for ${atom.id}:`, err);
    }
  }

  const elapsed = Date.now() - t0;
  console.log(
    `[migration/023] done — backfilled=${done} failed=${failed} total=${pending.length} elapsed=${elapsed}ms`,
  );

  // 即使部分失败也写 flag(失败的 note 走 fallback 仍能工作,留 followup 处理;
  // 否则启动反复重跑同一批失败更糟)
  if (failed === 0) {
    try {
      mkdirSync(FLAG_DIR, { recursive: true });
      writeFileSync(FLAG_PATH, '', 'utf-8');
      console.log('[migration/023] flag 写入');
    } catch (err) {
      console.error('[migration/023] flag 写入失败,启动下次会重跑:', err);
    }
  } else {
    console.warn(
      `[migration/023] 有 ${failed} 篇失败,本次不写 flag,启动下次重试`,
    );
  }
}
