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
 *    c. atomsToProseMirror({atoms}) → PM doc content
 *    d. 封 DriverSerialized 信封
 *    e. noteCapability.createNote(doc, folderId) (title 派生自 doc 首段)
 * 3. 同名同文件夹章节去重
 *
 * **不做** Graph 关系建立(V1 graphStore.relateNoteToEBook);V2 graph 是 view-only 视图,
 * 关系语义在 atom.from.pdfPage(已附 from)— 真要关联到 ebookId,留 graph 阶段做。
 */

import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import type { NoteCapabilityApi } from '@capabilities/note/types';
import type { FolderCapabilityApi } from '@capabilities/folder/types';
import type {
  AtomInput,
  DriverSerialized,
  TextEditingApi,
} from '@capabilities/text-editing/types';

function noteCap(): NoteCapabilityApi {
  return requireCapabilityApi<NoteCapabilityApi>('note');
}
function folderCap(): FolderCapabilityApi {
  return requireCapabilityApi<FolderCapabilityApi>('folder');
}

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
  const folderId = await getOrCreateFolder(bookName);
  if (!folderId) {
    return { folderId: '', noteIds: [], skippedTitles: ['ALL_FAILED'] };
  }

  // 收集已存在的同文件夹下笔记标题(去重)
  const allNotes = await noteCap().listNotes();
  const existingTitles = new Set(
    allNotes
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

    // 诊断:统计 PM doc 顶层节点 type + 扫描嵌套是否还有 paragraph/heading 漏网
    const topTypes: Record<string, number> = {};
    const leaked: string[] = [];
    const scan = (n: { type?: string; content?: unknown[] }): void => {
      if (n.type === 'paragraph' || n.type === 'heading') {
        leaked.push(n.type);
      }
      if (Array.isArray(n.content)) {
        for (const c of n.content as Array<{ type?: string; content?: unknown[] }>) scan(c);
      }
    };
    for (const n of pmContent) {
      const t = n.type ?? '?';
      topTypes[t] = (topTypes[t] ?? 0) + 1;
      scan(n);
    }
    console.log(
      '[extraction-import] PM doc:',
      title,
      '| topTypes=',
      topTypes,
      '| leaked paragraph/heading=',
      leaked.length,
    );

    const doc: DriverSerialized = {
      format: 'pm-doc-json',
      version: '0.1',
      payload: { type: 'doc', content: pmContent },
    };

    // L7-sub2:noteCap().createNote 是 async,title 字段已不可写
    // (派生自 doc.content[0]),import 路径用 doc 首段文本 (= title) 自然兜底
    const note = await noteCap().createNote(doc, folderId);
    noteIds.push(note.id);
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

async function getOrCreateFolder(name: string): Promise<string | null> {
  const folders = await folderCap().listFolders();
  const existing = folders.find((f) => f.title === name && f.parentId === null);
  if (existing) return existing.id;
  const folder = await folderCap().createFolder(name, null);
  return folder?.id ?? null;
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
