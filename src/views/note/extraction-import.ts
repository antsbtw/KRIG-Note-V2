/**
 * extraction-import — Atom JSON 批 → 文件夹 + 多 Note 落地(L5-C6)
 *
 * 输入:main 通过 EXTRACTION_NOTE_CREATE 推送的 KRIG_IMPORT batch:
 *   {
 *     type: 'batch',
 *     chapters: [
 *       {
 *         fileName: string,      // 原始下载文件名(带页码后缀)
 *         bookName: string,      // PDF 书名(去 .pdf)
 *         title: string,         // 章节标题(失败时回退到 bookName)
 *         pageStart: number,
 *         pageEnd: number,
 *         pages: Array<{ pageNumber: number; atoms: any[] }>,
 *       },
 *       ...
 *     ],
 *   }
 *
 * 流程(对齐 V1 src/main/extraction/import-service.ts 但纯 renderer):
 * 1. bookName → 找/建文件夹(folderCapability)
 * 2. 每个 chapter:
 *    a. atoms = [noteTitle, ...flatten(pages.map(p => p.atoms with from.pdfPage))]
 *    b. sanitizeAtoms(atoms)
 *    c. PM doc 拼装(Stage 7 后下沉到 capability/storage 层,view 不再做)
 *    d. 封 DriverSerialized 信封
 *    e. noteCapability.createNote(doc, folderId) (title 派生自 doc 首段)
 * 3. 同名同文件夹章节去重
 *
 * **不做** Graph 关系建立(V1 graphStore.relateNoteToEBook);V2 graph 是 view-only 视图,
 * 关系语义在 atom.from.pdfPage(已附 from)— 真要关联到 ebookId,留 graph 阶段做。
 */

import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import type { NoteCapabilityApi, CreateNoteBatchItem } from '@capabilities/note/types';
import type { FolderCapabilityApi } from '@capabilities/folder/types';
// 5B Stage 7 重做(2026-05-29 规范字面对齐):
// extraction batch → krigBatchToAtoms 产 PmAtomDraft[] (per chapter) →
// noteCap.createNotesBatch 单事务多 note.
// 删除 V1 import 中间形态 + V1 atom→PM 转换器 + sanitizeAtoms + buildAtoms + DriverSerialized
// — view 端不再做 PM doc 拼装.
import { krigBatchToAtoms } from '@capabilities/content-ingest';
import type { KrigImportBatch } from '@capabilities/content-ingest';
import { runRendererProgress } from '@shell/global-progress-overlay/run-renderer-progress';

function noteCap(): NoteCapabilityApi {
  return requireCapabilityApi<NoteCapabilityApi>('note');
}
function folderCap(): FolderCapabilityApi {
  return requireCapabilityApi<FolderCapabilityApi>('folder');
}

export interface ImportResult {
  folderId: string;
  noteIds: string[];
  skippedTitles: string[];
}

/**
 * 单批导入入口 (5B Stage 7 重做).
 *
 * 路径:KRIG_IMPORT batch → krigBatchToAtoms 产 chapter × PmAtomDraft[]
 *      → noteCap.createNotesBatch 单事务多 note.
 *
 * 不抛异常 — 失败时返回 noteIds=[], skippedTitles 含 'ALL_FAILED' 标记.
 */
export async function importExtractionBatch(data: unknown): Promise<ImportResult> {
  const batch = data as KrigImportBatch;
  const chapters = Array.isArray(batch?.chapters) ? batch.chapters : [];
  if (chapters.length === 0) {
    return { folderId: '', noteIds: [], skippedTitles: [] };
  }

  // 2026-05-29 import UX:KRIG_IMPORT (PDF 提取) 链路也走全链路进度 overlay。
  // 场景固定为"批量章节",文案用"章节"区分于 markdown 的"文件/段"。
  return runRendererProgress<ImportResult>(
    `正在导入 ${chapters.length} 个章节`,
    async ({ report, reportIndeterminate }) => {
  reportIndeterminate('正在分析提取内容…');
  // 1. krigBatchToAtoms 产 章节 × PmAtomDraft[]
  const { chapters: chapterResults } = await krigBatchToAtoms(batch);
  if (chapterResults.length === 0) {
    return { folderId: '', noteIds: [], skippedTitles: ['ALL_FAILED'] };
  }
  const bookName = chapterResults[0].bookName;

  // 2. 拿/建文件夹
  const folderId = await getOrCreateFolder(bookName);
  if (!folderId) {
    return { folderId: '', noteIds: [], skippedTitles: ['ALL_FAILED'] };
  }

  // 3. 收集已存在的同文件夹下笔记标题(去重)
  const allNotes = await noteCap().listNotes();
  const existingTitles = new Set(
    allNotes
      .filter((n) => n.folderId === folderId)
      .map((n) => n.title),
  );

  // 4. 拼 batch items (跳过同名重复)
  const batchItems: CreateNoteBatchItem[] = [];
  const batchLabels: string[] = [];
  const skippedTitles: string[] = [];

  let processed = 0;
  for (const chRes of chapterResults) {
    if (chRes.warnings.length) {
      console.warn(`[extraction-import] chapter "${chRes.title}" warnings:`, chRes.warnings);
    }
    if (existingTitles.has(chRes.title)) {
      skippedTitles.push(chRes.title);
      continue;
    }
    batchItems.push({
      atoms: chRes.atoms,
      folderId,
      titleHint: chRes.title,
    });
    batchLabels.push(chRes.title);
    existingTitles.add(chRes.title);
    processed++;
    report(
      `已处理 ${processed}/${chapterResults.length} 个章节: ${chRes.title}`,
      processed,
      chapterResults.length,
    );
  }

  // 5. 单事务批量写入
  const noteIds: string[] = [];
  if (batchItems.length > 0) {
    reportIndeterminate(`正在保存 ${batchItems.length} 个章节…`);
    const result = await noteCap().createNotesBatch({
      items: batchItems,
      broadcastMode: 'final',
    });
    console.log(
      `[extraction-import] BATCH createNotesBatch: items=${batchItems.length} notes=${result.notes.length} failures=${result.failures.length}`,
    );
    for (const note of result.notes) {
      noteIds.push(note.id);
    }
    for (const f of result.failures) {
      const label = f.index >= 0 ? batchLabels[f.index] ?? `index=${f.index}` : 'tx-failed';
      console.warn(`[extraction-import] BATCH failure ${label}: ${f.error}`);
      skippedTitles.push(`${label} (FAILED: ${f.error})`);
    }
  }

      return { folderId, noteIds, skippedTitles };
    },
    {
      doneMessage: (result) => {
        const ok = result.noteIds.length;
        const skip = result.skippedTitles.length;
        const base = `已导入 ${ok} 个章节`;
        return {
          success: skip === 0,
          message: skip === 0 ? base : `${base}(${skip} 项跳过/失败,详见控制台)`,
        };
      },
    },
  );
}

// ── Helpers ──

async function getOrCreateFolder(name: string): Promise<string | null> {
  const folders = await folderCap().listFolders('note');
  const existing = folders.find((f) => f.title === name && f.parentId === null);
  if (existing) return existing.id;
  const folder = await folderCap().createFolder(name, null, 'note');
  return folder?.id ?? null;
}
