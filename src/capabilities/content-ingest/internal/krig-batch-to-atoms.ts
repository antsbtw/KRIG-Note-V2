/**
 * krigBatchToAtoms — 5B Stage 5 §7.5.1 + Q1 + sanitize 字面实施
 *
 * 包装 KRIG_IMPORT batch(extraction-handler 产物)→ 章节 × atoms[] 结构.
 *
 * 算法:
 *   1. 遍历 batch.chapters(每章一个 import 单元)
 *   2. 每章:
 *      a. flatten pages → atoms(对齐 view/note/extraction-import.ts:191 buildAtoms)
 *      b. 走 sanitizeAtoms(8 条容错,决议 §9)
 *      c. table 字面走 tableAdapter 展开为 cells + childOf 边
 *      d. 非 table atom 字面归一化 attrs.id null 占位 + from 透传
 *   3. 输出 `{ chapters: Array<{ title, bookName, atoms, warnings }> }`
 *
 * 边界纪律:
 *   - 字面**不调** noteCap.createNote(那是 Stage 7 createNotesBatch 的事)
 *   - 字面**不走** PM editor / 不产 PM doc
 *   - 字面**兼容** 契约 §4.7 `tiptapContent` 字段名(Stage 8 才 rename pmContent)
 */

import { sanitizeAtoms } from './sanitize-atoms';
import { tableAdapter } from './table-adapter';
import type {
  Atom,
  AtomFrom,
  KrigBatchToAtomsResult,
  KrigChapterResult,
  KrigImportBatch,
  KrigImportChapter,
} from '../types';

/**
 * krigBatchToAtoms 入口.
 *
 * 输入容错:
 *   - batch.chapters 不是数组 → 返回 `{ chapters: [] }`
 *   - 单章 sanitize 抛错 → warnings 累积该章(不影响其他章节)
 */
export async function krigBatchToAtoms(
  batch: KrigImportBatch,
): Promise<KrigBatchToAtomsResult> {
  const chapters: KrigChapterResult[] = [];

  const bookName = extractBookName(batch);
  const inputChapters = Array.isArray(batch?.chapters) ? batch.chapters : [];

  for (const ch of inputChapters) {
    const chapterResult = await processChapter(ch, bookName);
    chapters.push(chapterResult);
  }

  return { chapters };
}

/**
 * 单章处理.
 *
 * 字面对齐 view/note/extraction-import.ts:191 buildAtoms 的 flatten 规则:
 *   - 首 atom 字面是 `{ type:'noteTitle', content:{ children:[{type:'text', text:title}] } }`
 *   - 后续 = flatten(pages.map(p => p.atoms 带 from.pdfPage))
 */
async function processChapter(
  ch: KrigImportChapter,
  bookName: string,
): Promise<KrigChapterResult> {
  const warnings: string[] = [];

  const title =
    ch.title ||
    `${bookName} (p${ch.pageStart ?? '?'}-${ch.pageEnd ?? '?'})`;

  // 收集 raw atom 列表(对齐 extraction-import.ts:191)
  const rawAtoms: Atom[] = [];

  rawAtoms.push({
    type: 'noteTitle',
    content: { children: [{ type: 'text', text: title }] },
  });

  const pages = Array.isArray(ch.pages) ? ch.pages : [];
  for (const page of pages) {
    const pageAtoms = Array.isArray(page.atoms) ? (page.atoms as Atom[]) : [];
    for (const atom of pageAtoms) {
      const stamped: Atom = {
        ...atom,
        from:
          atom.from ?? {
            extractionType: 'pdf',
            pdfPage: page.pageNumber,
            extractedAt: Date.now(),
          },
      };
      rawAtoms.push(stamped);
    }
  }

  // sanitize(8 条容错,决议 §9). sanitizeAtoms 字面接 AtomLike(id: string | undefined)
  // 与本地 Atom(id: string | null | undefined,inject 占位 null)字面 id 类型偏差 —
  // sanitizeAtoms 内部字面不读 id,只读 type/parentId/content/from/meta,二次 cast 字面安全.
  let sanitized: Atom[];
  try {
    sanitized = sanitizeAtoms(rawAtoms as unknown as Parameters<typeof sanitizeAtoms>[0]) as Atom[];
  } catch (err) {
    warnings.push(`sanitizeAtoms failed: ${String(err)}`);
    sanitized = rawAtoms;
  }

  // table 展开 + 普通 atom 归一化 attrs.id null 占位
  const finalAtoms: Atom[] = [];
  for (const atom of sanitized) {
    if (atom.type === 'table') {
      const tiptapContent =
        (atom.content?.tiptapContent as unknown[] | undefined) ?? [];
      const adapted = tableAdapter({
        tiptapContent,
        tableAtomId: undefined, // 待 inject(5B §7.3.1 第 5 项)
        from: atom.from,
      });
      finalAtoms.push(normalizeAtomId(adapted.tableAtom));
      for (const cell of adapted.cellAtoms) {
        finalAtoms.push(normalizeAtomId(cell));
      }
      // childOf 边集:Stage 7 写库时根据 inject 后的 id 字面重建
      continue;
    }
    finalAtoms.push(normalizeAtomId(atom));
  }

  return {
    title,
    bookName,
    atoms: finalAtoms,
    warnings,
  };
}

/**
 * 归一化 atom.attrs.id null 占位.
 *
 * 字面规则:
 *   - 若 atom.attrs 不存在,字面**不**新建(不强加 attrs 给 inline-only / 无 id 的节点)
 *   - 若 atom.attrs 存在但无 id 字段,字面 set id=null
 *   - 若已有 id,字面**不动**(sanitize 可能从 v1 数据带过来的 id;由 inject 阶段决定保留 / 重发)
 */
function normalizeAtomId(atom: Atom): Atom {
  if (atom.attrs === undefined) return atom;
  if (!('id' in atom.attrs)) {
    return { ...atom, attrs: { ...atom.attrs, id: null } };
  }
  return atom;
}

/**
 * extract bookName 字面规则(对齐 view/note/extraction-import.ts:162 extractBookName):
 *   - batch.bookName 优先
 *   - 否则用首章 bookName / fileName
 *   - 兜底 'PDF Extraction'
 *   - 字面去 `.pdf` 后缀
 */
function extractBookName(batch: KrigImportBatch): string {
  if (typeof batch?.bookName === 'string' && batch.bookName) {
    return stripPdfExt(batch.bookName);
  }
  const firstCh = batch?.chapters?.[0];
  const candidate = firstCh?.bookName || firstCh?.fileName || 'PDF Extraction';
  return stripPdfExt(candidate);
}

function stripPdfExt(name: string): string {
  return name.replace(/\.pdf$/i, '');
}

// 字面 unused 引用(避免 lint 误删):AtomFrom 类型给 from 字段语义说明用,运行时不直接用.
// (TS structural typing 下 AtomFrom 已被 Atom.from 隐式消费;此处仅文档化.)
export type { AtomFrom };
