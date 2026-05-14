/**
 * sub-phase 022 migration (decision 022 §7) — ebook + annotation → atom 体系迁移
 *
 * 字面 7 步实施 (沿决议 §7.2 字面):
 *   [0] flag 存在 → return (绝不重跑)
 *   [1] 读旧 JSON store (bookshelf.json + annotations/*.json)
 *   [2] 转换 entries → ebook atom + reading-state atom + hasReadingState 边
 *   [3] 转换 folders → folder atom + folderForView 边 ('ebook') + inFolder 边 (parent)
 *   [4] 关联 entries 到 folder (inFolder 边)
 *   [5] 转换 annotations → thought pm atom + PM block (3 分支) + hasReadingThought 边
 *   [6] L3 末段互斥扫描 (§4.3.1-L3) — 若 violations > 0 → throw + 不写 flag
 *   [7] 写 flag
 *
 * ID 映射表 (沿决议 §7.2 v0.4 字面登记):
 *   ebookIdMap   旧 entry.id (uuid) → 新 ebook atom ULID
 *   folderIdMap  旧 folder.id (uuid) → 新 folder atom ULID
 *
 * 字面纪律:
 *   - L3 末段扫描 fail 时**绝不写 flag** (启动下次重试)
 *   - bookshelf-store.ts / annotation-store.ts 字面整文件保留 (沿 §10.B-2 字面口径) —
 *     migration 字面字面字面字面字面直接 import 这两个 store class 字面字面读旧 JSON,
 *     Step 5.10 字面字面 store 文件整体 git rm 一并清除
 *   - 字面 putAtom + putEdge 字面绕过 L1 ensureReadingThought 字面互斥校验 (因 migration
 *     字面直接调 storage), L3 末段扫描字面字面 fallback 防御
 */

import path from 'node:path';
import { existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { app } from 'electron';

import { storage } from '@storage/index';
import {
  scanMarkerEdgeMutexViolations,
} from '@storage/health/cardinality-check';
import { bookshelfStore } from '@platform/main/ebook/bookshelf-store';
import { annotationStore } from '@platform/main/ebook/annotation-store';
import type { EBookEntry, EBookFolder } from '@platform/main/ebook/bookshelf-store';
import type { StoredAnnotation } from '@platform/main/ebook/annotation-store';
import type { BookAnchor } from '@drivers/text-editing-driver/blocks/_shared/book-anchor';
import type { PmPayload } from '@semantic/types';

const FLAG_DIR = path.join(app.getPath('userData'), 'krig-data');
const FLAG_PATH = path.join(FLAG_DIR, 'migration-022-completed');

const HAS_READING_THOUGHT_PREDICATE = 'user:krig:hasReadingThought';
const HAS_READING_STATE_PREDICATE = 'user:krig:hasReadingState';
const IN_FOLDER_PREDICATE = 'user:krig:inFolder';
const FOLDER_FOR_VIEW_PREDICATE = 'user:krig:folderForView';

const EBOOK_VIEW_LITERAL = '__view__/ebook';

/**
 * 一个 StoredAnnotation → 一个 PM block (沿决议 §7.3 字面 3 分支映射).
 *
 * - rect + thumbnail → image block (含 thumbnail src)
 * - underline + cfi → highlight 类型 → blockquote block + 内嵌 paragraph(textContent)
 * - underline 无 cfi → 普通 underline → paragraph block
 *
 * 决议 §7.3 字面 type 字段是 source-of-truth, 决定 block 类型:
 *   ann.type='rect' → BookAnchor.type='rect' → image (有 thumbnail) or paragraph
 *   ann.type='underline' + cfi='string' → BookAnchor.type='highlight' → blockquote
 *   ann.type='underline' + cfi 无 → BookAnchor.type='underline' → paragraph
 */
function convertAnnotationToBlock(ann: StoredAnnotation): PmPayload {
  // 字面 BookAnchor.type 字面映射 (沿决议 §7.3 字面):
  //   ann.type='rect' → 'rect'
  //   ann.type='underline' + ann.cfi 非空 → 'highlight' (EPUB)
  //   ann.type='underline' + ann.cfi 无 → 'underline' (PDF)
  const anchorType: BookAnchor['type'] =
    ann.type === 'rect'
      ? 'rect'
      : ann.cfi
        ? 'highlight'
        : 'underline';

  const bookAnchor: BookAnchor = {
    pageNum: ann.pageNum,
    rect: ann.rect.w > 0 ? ann.rect : undefined,
    cfi: ann.cfi,
    textContent: ann.textContent,
    thumbnail: ann.thumbnail,
    color: ann.color,
    type: anchorType,
    createdAt: ann.createdAt,
  };

  // 3 分支字面 (沿决议 §7.3 字面 if/elif/else):
  if (anchorType === 'rect' && bookAnchor.thumbnail) {
    return {
      type: 'image',
      attrs: { src: bookAnchor.thumbnail, alt: '', bookAnchor },
      content: [
        { type: 'paragraph', attrs: { bookAnchor: null }, content: [] },
      ],
    };
  }
  if (anchorType === 'highlight' && bookAnchor.textContent) {
    return {
      type: 'blockquote',
      attrs: { bookAnchor },
      content: [
        {
          type: 'paragraph',
          attrs: { bookAnchor: null },
          content: [{ type: 'text', text: bookAnchor.textContent }],
        },
      ],
    };
  }
  return {
    type: 'paragraph',
    attrs: { bookAnchor },
    content: [],
  };
}

/**
 * Folder 拓扑排序 (沿决议 §7.2 字面 [3c] 字面登记).
 *
 * 旧 EBookFolder 数组字面 child 字面字面字面字面字面字面字面 parent (沿 V1 现状字面
 * sort_order 字面字面字面 sibling 顺序但不保证 parent → child 全局顺序), migration
 * 字面 build folderIdMap + putEdge inFolder 字面需要 parent 先字面字面.
 *
 * 字面 Kahn's algorithm 拓扑排序: parent_id = null 字面 root, 依次出队 + 加入下游.
 */
function topoSortFolders(folders: EBookFolder[]): EBookFolder[] {
  const sorted: EBookFolder[] = [];
  const remaining = [...folders];
  const visited = new Set<string>();

  // 字面循环防御: 字面 V1 现状字面字面字面字面字面 parent_id 字面字面字面字面 cycle,
  // 若数据已坏 (parent_id 形成 cycle) 字面 break.
  let lastSize = -1;
  while (remaining.length > 0 && remaining.length !== lastSize) {
    lastSize = remaining.length;
    for (let i = remaining.length - 1; i >= 0; i--) {
      const f = remaining[i];
      if (f.parent_id === null || visited.has(f.parent_id)) {
        sorted.push(f);
        visited.add(f.id);
        remaining.splice(i, 1);
      }
    }
  }

  // 若 remaining 非空 (cycle 或孤儿 parent_id), 字面 append 末尾 (字面字面 best-effort)
  if (remaining.length > 0) {
    console.warn(
      `[migration/022] folder 拓扑排序 ${remaining.length} 项 cycle/孤儿 — 字面 append 末尾 best-effort`,
    );
    for (const f of remaining) {
      sorted.push(f);
      visited.add(f.id);
    }
  }
  return sorted;
}

export async function runMigration022IfNeeded(): Promise<void> {
  // ── [0] flag 检查 ──
  if (existsSync(FLAG_PATH)) {
    return; // 绝不重跑
  }

  console.warn(
    '[migration/022] sub-phase 022 ebook + annotation → atom 体系迁移启动\n' +
      'JSON store (bookshelf + annotations) → ebook + reading-state + pm atom + 边\n' +
      'L3 末段互斥扫描 fail 时不写 flag, 启动下次重试',
  );

  // ── [1] 读旧 JSON store ──
  const entries: EBookEntry[] = bookshelfStore.list();
  const folders: EBookFolder[] = bookshelfStore.folderList();

  console.log(
    `[migration/022] 读旧 JSON: ${entries.length} entries, ${folders.length} folders`,
  );

  // 若 0 entry + 0 folder, 直接写 flag (无数据要迁)
  if (entries.length === 0 && folders.length === 0) {
    console.log('[migration/022] 无数据需要迁移, 直接写 flag');
    writeFlag();
    return;
  }

  // ID 映射表 (内存, throwaway, 沿决议 §7.2 v0.4 字面登记)
  const ebookIdMap = new Map<string, string>(); // 旧 entry.id → 新 ebook atom ULID
  const folderIdMap = new Map<string, string>(); // 旧 folder.id → 新 folder atom ULID

  // ── [2] 转换 entries → ebook atom + reading-state atom + hasReadingState 边 ──
  for (const entry of entries) {
    const ebookAtom = await storage.putAtom<'ebook'>({
      payload: {
        domain: 'ebook',
        payload: {
          fileType: entry.fileType,
          storage: entry.storage,
          filePath: entry.filePath,
          originalPath: entry.originalPath,
          fileName: entry.fileName,
          displayName: entry.displayName,
          pageCount: entry.pageCount,
          addedAt: entry.addedAt,
        },
      },
    });
    ebookIdMap.set(entry.id, ebookAtom.id);

    const rsAtom = await storage.putAtom<'reading-state'>({
      payload: {
        domain: 'reading-state',
        payload: {
          lastOpenedAt: entry.lastOpenedAt,
          lastPosition: entry.lastPosition ?? {},
          bookmarks: entry.bookmarks ?? [],
          cfiBookmarks: entry.cfiBookmarks ?? [],
        },
      },
    });

    await storage.putEdge({
      predicate: HAS_READING_STATE_PREDICATE,
      subject: { kind: 'atom', atomId: ebookAtom.id },
      object: { kind: 'atom', atomId: rsAtom.id },
      attrs: { createdBy: 'user-default', createdAt: Date.now() },
    });
  }
  console.log(`[migration/022] [2] entries → ebook+reading-state 完成 (${entries.length})`);

  // ── [3] 转换 folders → folder atom + folderForView 边 + inFolder 边 ──
  const sortedFolders = topoSortFolders(folders);
  for (const folder of sortedFolders) {
    const folderAtom = await storage.putAtom<'folder'>({
      payload: {
        domain: 'folder',
        payload: { title: folder.title },
      },
    });
    folderIdMap.set(folder.id, folderAtom.id);

    // folderForView 边 ('ebook' literal)
    await storage.putEdge({
      predicate: FOLDER_FOR_VIEW_PREDICATE,
      subject: { kind: 'atom', atomId: folderAtom.id },
      object: { kind: 'literal', type: 'string', value: EBOOK_VIEW_LITERAL },
      attrs: { createdBy: 'user-default', createdAt: Date.now() },
    });

    // inFolder 边 (parent 非空时)
    if (folder.parent_id) {
      const parentAtomId = folderIdMap.get(folder.parent_id);
      if (parentAtomId) {
        await storage.putEdge({
          predicate: IN_FOLDER_PREDICATE,
          subject: { kind: 'atom', atomId: folderAtom.id },
          object: { kind: 'atom', atomId: parentAtomId },
          attrs: { createdBy: 'user-default', createdAt: Date.now() },
        });
      } else {
        console.warn(
          `[migration/022] folder ${folder.id} parent_id ${folder.parent_id} ` +
            `未找到映射 (孤儿 parent), 字面 skip inFolder 边`,
        );
      }
    }
  }
  console.log(`[migration/022] [3] folders → folder atom + folderForView 完成 (${folders.length})`);

  // ── [4] 关联 entries 到 folder (inFolder 边) ──
  let entryInFolderCount = 0;
  for (const entry of entries) {
    if (!entry.folderId) continue;
    const ebookAtomId = ebookIdMap.get(entry.id);
    const folderAtomId = folderIdMap.get(entry.folderId);
    if (!ebookAtomId || !folderAtomId) {
      console.warn(
        `[migration/022] entry ${entry.id} folderId ${entry.folderId} ` +
          `映射缺失 (ebook=${ebookAtomId}, folder=${folderAtomId}), 字面 skip`,
      );
      continue;
    }
    await storage.putEdge({
      predicate: IN_FOLDER_PREDICATE,
      subject: { kind: 'atom', atomId: ebookAtomId },
      object: { kind: 'atom', atomId: folderAtomId },
      attrs: { createdBy: 'user-default', createdAt: Date.now() },
    });
    entryInFolderCount++;
  }
  console.log(`[migration/022] [4] entries → inFolder 完成 (${entryInFolderCount})`);

  // ── [5] 转换 annotations → thought pm atom + PM block + hasReadingThought 边 ──
  let thoughtCount = 0;
  let blockCount = 0;
  for (const entry of entries) {
    const annotations = annotationStore.list(entry.id);
    if (annotations.length === 0) continue; // lazy: 无标注的书不创空 thought (沿决议 §4.1.2 §0.5)

    // 排序: pageNum 升序 + createdAt 升序 (沿决议 §7.2 [5a] 字面)
    const sorted = [...annotations].sort(
      (a, b) => a.pageNum - b.pageNum || a.createdAt - b.createdAt,
    );
    const blocks = sorted.map(convertAnnotationToBlock);

    // PM doc (沿 V2 现状 PM payload 字面 — type='doc' + content=[blocks])
    const doc: PmPayload = { type: 'doc', content: blocks };

    const thoughtAtom = await storage.putAtom<'pm'>({
      payload: { domain: 'pm', payload: doc },
    });

    const ebookAtomId = ebookIdMap.get(entry.id);
    if (!ebookAtomId) {
      console.warn(
        `[migration/022] entry ${entry.id} 映射缺失, 字面 skip hasReadingThought 边`,
      );
      continue;
    }

    await storage.putEdge({
      predicate: HAS_READING_THOUGHT_PREDICATE,
      subject: { kind: 'atom', atomId: ebookAtomId },
      object: { kind: 'atom', atomId: thoughtAtom.id },
      attrs: { createdBy: 'user-default', createdAt: Date.now() },
    });
    thoughtCount++;
    blockCount += blocks.length;
  }
  console.log(
    `[migration/022] [5] annotations → ${thoughtCount} thought atom (${blockCount} blocks)`,
  );

  // ── [6] L3 末段互斥扫描 (decision 022 §4.3.1-L3) ──
  // 防 migration 直 putAtom/putEdge 绕过 L1 ensureReadingThought 互斥校验留毒:
  // 若 V1/V2 annotation JSON 数据本身已坏 (某 pm atom 已挂 hasNoteView 又被
  // migration 错挂 hasReadingThought), 字面 L3 末段扫描即时阻断.
  //
  // 字面前置: migration 之前 (021 clearAll 之后) 数据库字面应该是空的, V2 也不会有
  // 既有 hasNoteView 边. 但 022 之后用户可能字面用过应用 (021 后 → 022 前), 字面有 note,
  // 故 L3 扫描字面字面必要 (沿决议 §4.3.1-L3 字面"存在意义"字面登记).
  const violations = await scanMarkerEdgeMutexViolations(storage);
  if (violations.length > 0) {
    console.error(
      `[migration/022] L3 末段扫描 FAIL — 发现 ${violations.length} 个 pm atom 同时挂 ` +
        `hasNoteView + hasReadingThought 互斥违反:`,
      violations,
    );
    throw new Error(
      `MarkerEdgeMutexViolation in migration 022: ${violations.length} pm atoms violate mutex ` +
        `(decision 022 §4.3.1-L3). Migration 字面 fail, flag 不写, 启动下次重试.`,
    );
  }
  console.log('[migration/022] [6] L3 末段互斥扫描 PASS (0 violations)');

  // ── [7] 写 flag ──
  writeFlag();
  console.warn(
    `[migration/022] 完成: ${entries.length} entries + ${folders.length} folders + ` +
      `${thoughtCount} thoughts (${blockCount} blocks)`,
  );
}

function writeFlag(): void {
  try {
    mkdirSync(FLAG_DIR, { recursive: true });
    writeFileSync(FLAG_PATH, '', 'utf-8');
  } catch (err) {
    console.error('[migration/022] flag 写入失败, 启动下次会重跑 migration:', err);
    throw err;
  }
}
