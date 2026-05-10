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
 * 1. bookName → 找/建文件夹(folderStore)
 * 2. 每个 chapter:
 *    a. atoms = [noteTitle, ...flatten(pages.map(p => p.atoms with from.pdfPage))]
 *    b. sanitizeAtoms(atoms)
 *    c. atomsToProseMirror({atoms}) → PM doc content
 *    d. 封 DriverSerialized 信封
 *    e. noteStore.create(doc, title, folderId)
 * 3. 同名同文件夹章节去重
 *
 * **不做** Graph 关系建立(V1 graphStore.relateNoteToEBook);V2 graph 是 view-only 视图,
 * 关系语义在 atom.from.pdfPage(已附 from)— 真要关联到 ebookId,留 graph 阶段做。
 */

import { folderStore } from './folder-store';
import { noteStore } from './note-store';
import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import type {
  AtomInput,
  DriverSerialized,
  TextEditingApi,
} from '@capabilities/text-editing/types';

interface ChapterInput {
  fileName?: string;
  bookName?: string;
  title?: string;
  pageStart?: number;
  pageEnd?: number;
  pages?: Array<{ pageNumber: number; atoms: unknown[] }>;
}

interface BatchInput {
  type?: string;
  chapters?: ChapterInput[];
  bookName?: string;
}

export interface ImportResult {
  folderId: string;
  noteIds: string[];
  skippedTitles: string[];
}

/**
 * 单批导入入口。
 *
 * 不抛异常 — 失败时返回 noteIds=[],skippedTitles 含 'ALL_FAILED' 标记。
 */
export async function importExtractionBatch(data: unknown): Promise<ImportResult> {
  const batch = data as BatchInput;
  const chapters = Array.isArray(batch?.chapters) ? batch.chapters : [];
  if (chapters.length === 0) {
    return { folderId: '', noteIds: [], skippedTitles: [] };
  }

  const bookName = extractBookName(batch);
  const folderId = getOrCreateFolder(bookName);

  // 收集已存在的同文件夹下笔记标题(去重)
  const existingTitles = new Set(
    noteStore
      .getAll()
      .filter((n) => n.folderId === folderId)
      .map((n) => n.title),
  );

  const noteIds: string[] = [];
  const skippedTitles: string[] = [];

  for (const ch of chapters) {
    const title = ch.title || `${bookName} (p${ch.pageStart ?? '?'}-${ch.pageEnd ?? '?'})`;
    if (existingTitles.has(title)) {
      skippedTitles.push(title);
      continue;
    }

    const atoms = buildAtoms(title, ch);
    const tea = requireCapabilityApi<TextEditingApi>('text-editing');
    const cleaned = tea.sanitizeAtoms(atoms);

    let pmContent;
    try {
      pmContent = await tea.atomsToProseMirror({ atoms: cleaned });
    } catch (err) {
      console.error('[extraction-import] atomsToProseMirror failed:', title, err);
      continue;
    }

    const doc: DriverSerialized = {
      format: 'pm-doc-json',
      version: '0.1',
      payload: { type: 'doc', content: pmContent },
    };

    const noteId = noteStore.create(doc, title, folderId);
    noteIds.push(noteId);
    existingTitles.add(title);
  }

  return { folderId, noteIds, skippedTitles };
}

// ── Helpers ──

function extractBookName(batch: BatchInput): string {
  // batch.bookName 优先;否则找首个 chapter 的 bookName / fileName
  if (typeof batch.bookName === 'string' && batch.bookName) {
    return stripPdfExt(batch.bookName);
  }
  const firstCh = batch.chapters?.[0];
  const candidate = firstCh?.bookName || firstCh?.fileName || 'PDF Extraction';
  return stripPdfExt(candidate);
}

function stripPdfExt(name: string): string {
  return name.replace(/\.pdf$/i, '');
}

function getOrCreateFolder(name: string): string {
  const folders = folderStore.getAll();
  const existing = folders.find((f) => f.title === name && f.parentId === null);
  if (existing) return existing.id;
  return folderStore.create(name);
}

/**
 * 构造章节 atom 数组:
 * - 首个 atom = noteTitle(章节标题)
 * - 后续 = flatten(pages.map(p => p.atoms 加 from.pdfPage))
 *
 * 不做 sanitize(交给 caller 调 sanitizeAtoms)
 */
function buildAtoms(title: string, ch: ChapterInput): AtomInput[] {
  const out: AtomInput[] = [];

  out.push({
    type: 'noteTitle',
    content: { children: [{ type: 'text', text: title }] },
  });

  const pages = Array.isArray(ch.pages) ? ch.pages : [];
  for (const page of pages) {
    const pageAtoms = Array.isArray(page.atoms) ? (page.atoms as AtomInput[]) : [];
    for (const atom of pageAtoms) {
      const stamped: AtomInput = {
        ...atom,
        from: atom.from ?? {
          extractionType: 'pdf',
          pdfPage: page.pageNumber,
          extractedAt: Date.now(),
        },
      };
      out.push(stamped);
    }
  }

  return out;
}
