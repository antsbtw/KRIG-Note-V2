/**
 * krigBatchToAtoms — KRIG_IMPORT batch (PDF 提取) → 章节 × PmAtomDraft[].
 *
 * 统一标准链路(2026-06-05 重做):与 markdownToAtoms 走**同一条**转换管线 ——
 *   源 → atomsToProseMirror(raw atom → PM 节点)→ pmNodeToDrafts(PM 节点 → PmAtomDraft[])
 *
 * 此前(Stage 7)PDF 导入自写一套「atom 透传」逻辑,绕过标准转换器,埋了两个雷:
 *   1. type 原样透传 → noteTitle 直接进 PM doc,但 V2 schema 无 noteTitle 节点
 *      (它是 paragraph[isTitle],决议 D1)→ deserializeDoc 抛 "Unknown node type" →
 *      整篇 fallback 空 doc(PDF 首块恒 noteTitle,故每篇都崩)。
 *   2. inline 文字塞进 attrs.legacyContent,但 assemble 端无人读 → 文字丢失。
 * atomsToProseMirror 早已正确处理全部 13 种 atom type + noteTitle 映射 + inline,
 * 故改为复用它(canvas-text-node 已是此模式),不再各写各的。
 *
 * 每章:[noteTitle atom + flatten(pages.atoms)] → sanitize → atomsToProseMirror →
 *       pmNodeToDrafts → PmAtomDraft[]。
 */

import { sanitizeAtoms, type LegacyExtractionAtom } from './sanitize-atoms';
import { pmNodeToDrafts } from './pm-nodes-to-drafts';
import { expandDirtyMathBlocks } from './expand-dirty-math';
import {
  atomsToProseMirror,
  type V1NoteViewAtom,
} from '@capabilities/text-editing/converters/atoms-to-pm';
import type { PmAtomDraft, AtomFrom, PmPayload } from '@semantic/types';
import type {
  KrigBatchToAtomsResult,
  KrigChapterResult,
  KrigImportBatch,
  KrigImportChapter,
} from '../types';

/**
 * krigBatchToAtoms 入口.
 *
 * 容错:
 *   - batch.chapters 不是数组 → 返回 { chapters: [] }
 *   - 单章 sanitize 抛错 → warnings 累积该章
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
 * 字面对齐原 buildAtoms 的 flatten:
 *   - 首 atom 字面是 { type:'noteTitle', content:{ children:[{type:'text',text:title}] } }
 *   - 后续 = flatten(pages.map(p => p.atoms 加 from.pdfPage))
 *
 * sanitize 后字面遍历转 PmAtomDraft.
 */
async function processChapter(
  ch: KrigImportChapter,
  bookName: string,
): Promise<KrigChapterResult> {
  const warnings: string[] = [];

  const title =
    ch.title ||
    `${bookName} (p${ch.pageStart ?? '?'}-${ch.pageEnd ?? '?'})`;

  // 收集 raw atom 列表(LegacyExtractionAtom 形态):noteTitle + flatten(pages.atoms)
  const rawAtoms: LegacyExtractionAtom[] = [];
  rawAtoms.push({
    type: 'noteTitle',
    content: { children: [{ type: 'text', text: title }] },
  });

  const defaultFrom: AtomFrom = { extractionType: 'pdf', extractedAt: Date.now() };
  const pages = Array.isArray(ch.pages) ? ch.pages : [];
  for (const page of pages) {
    const pageAtoms = Array.isArray(page.atoms) ? (page.atoms as LegacyExtractionAtom[]) : [];
    for (const atom of pageAtoms) {
      rawAtoms.push({
        ...atom,
        from: atom.from ?? { extractionType: 'pdf', pdfPage: page.pageNumber, extractedAt: Date.now() },
      });
    }
  }

  // sanitize(8 条容错 + type 迁移)
  let sanitized: LegacyExtractionAtom[];
  try {
    sanitized = sanitizeAtoms(rawAtoms);
  } catch (err) {
    warnings.push(`sanitizeAtoms failed: ${String(err)}`);
    sanitized = rawAtoms;
  }

  // 标准链路 step 1:raw atom → PM 节点(noteTitle→paragraph[isTitle]、inline、13 type 全处理)
  let pmNodes: PmPayload[];
  try {
    pmNodes = (await atomsToProseMirror({
      atoms: sanitized as unknown as V1NoteViewAtom[],
    })) as unknown as PmPayload[];
  } catch (err) {
    warnings.push(`atomsToProseMirror failed: ${String(err)}`);
    return { title, bookName, atoms: [], warnings };
  }

  // eBook 兼容垫片:展开 OCR 脏 mathBlock(latex 混入 $$/$ 分隔符 + 正文)。
  // 仅 ~2% 脏数据触发,纯净公式不动。未来后端产出干净 latex 后整段可撤。
  try {
    pmNodes = await expandDirtyMathBlocks(pmNodes);
  } catch (err) {
    warnings.push(`expandDirtyMathBlocks failed (non-fatal): ${String(err)}`);
  }

  // 标准链路 step 2:PM 节点 → PmAtomDraft[](与 markdownToAtoms 同一函数)
  let counter = 0;
  const allocTmpId = (): string => `tmp-${counter++}`;
  const drafts: PmAtomDraft[] = [];
  for (const node of pmNodes) {
    pmNodeToDrafts(node, undefined, drafts, allocTmpId, defaultFrom);
  }

  return { title, bookName, atoms: drafts, warnings };
}

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
