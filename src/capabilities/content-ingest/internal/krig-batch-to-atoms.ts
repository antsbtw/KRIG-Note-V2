/**
 * krigBatchToAtoms — 5B Stage 7 重做(2026-05-29 规范字面对齐)
 *
 * KRIG_IMPORT batch (extraction-handler 产物) → 章节 × PmAtomDraft[].
 *
 * 算法字面:
 *   1. 遍历 batch.chapters (每章一个 import 单元)
 *   2. 每章字面:
 *      a. 走 sanitize (LegacyExtractionAtom 形态 PM-JSON atom)
 *      b. 遍历 sanitized atoms,为每个分配 tmpId + 转 PmAtomDraft
 *         (payload 字面 { domain:'pm', payload: 原 atom 剥 id/parentId/from/meta 字段 })
 *      c. 老 atom.parentId 字面映射到 parentTmpId (建 oldParentId → tmpId 映射)
 *      d. table 字面调 tableAdapter 展开(同 markdownToAtoms)
 *   3. 每 chapter 产 { title, bookName, atoms, warnings }
 *
 * 边界:
 *   - 字面**不调** noteCap.createNote (那是 Stage 7 createNotesBatch 的事)
 *   - 字面**不走** PM editor / 不产 PM doc
 *   - 字面**兼容** 契约 §4.7 tiptapContent 字段名(从 LegacyExtractionAtom.content.tiptapContent 读)
 */

import { sanitizeAtoms, type LegacyExtractionAtom } from './sanitize-atoms';
import { tableAdapter } from './table-adapter';
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

  // 收集 raw atom 列表 (LegacyExtractionAtom 形态)
  const rawAtoms: LegacyExtractionAtom[] = [];

  rawAtoms.push({
    type: 'noteTitle',
    content: { children: [{ type: 'text', text: title }] },
  });

  const pages = Array.isArray(ch.pages) ? ch.pages : [];
  for (const page of pages) {
    const pageAtoms = Array.isArray(page.atoms) ? (page.atoms as LegacyExtractionAtom[]) : [];
    for (const atom of pageAtoms) {
      const stamped: LegacyExtractionAtom = {
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

  // sanitize (8 条容错)
  let sanitized: LegacyExtractionAtom[];
  try {
    sanitized = sanitizeAtoms(rawAtoms);
  } catch (err) {
    warnings.push(`sanitizeAtoms failed: ${String(err)}`);
    sanitized = rawAtoms;
  }

  // tmpId 分配器(本章 atoms 内唯一)
  let counter = 0;
  const allocTmpId = (): string => `tmp-${counter++}`;

  // 映射:原 sanitize-atom.id (V1 string id) → tmpId (本章本批新分配)
  const oldIdToTmpId = new Map<string, string>();
  const drafts: PmAtomDraft[] = [];

  // 第一遍:遍历 sanitized,为每 atom 分配 tmpId(table 除外 — table 走 tableAdapter)
  // 字面记录映射先做完才能解析 parentTmpId(parent 可能在 child 后出现 — 防御性)
  // 但在实际数据里 parent 通常在 child 之前, 直接顺序遍历能 cover; 即便不行 oldIdToTmpId 已建好
  for (const atom of sanitized) {
    if (typeof atom.id === 'string' && atom.id) {
      const tmpId = allocTmpId();
      oldIdToTmpId.set(atom.id, tmpId);
      // 注:tmpId 已分配但 draft 还没产; table 走单独路径会再分配新 tmpId,
      // 所以 table 不预分配在此 map. 改用 fresh table tmp 逻辑见下:
    }
  }

  // 重置 counter — 第二遍真正生成 drafts. 因 oldIdToTmpId 用旧 tmpId 已建好引用,
  // 这里要重建一套同步映射(简化:用同一个 counter 但 table 路径吃多个 tmpId).
  //
  // 实际:为简化, 上面 map 建好后立刻进入第二遍,直接用 oldIdToTmpId 拿 tmpId
  // 后续 atom (无 id 的) allocTmpId 在原 counter 之后续号.
  // 但 table cells 是 tableAdapter 内部 allocTmpId,跟当前 counter 共用 → 冲突.
  //
  // 修法:第二遍直接 sequential 处理,(1) 已有 id 的 atom 用 oldIdToTmpId.get(atom.id);
  // (2) 没 id 的 atom 用 allocTmpId(); (3) table 走 tableAdapter 字面用 allocTmpId
  // (共用同一个 counter,所有 tmpId 在本章内唯一).
  //
  // 为此重新初始化 counter(因为第一遍已经消耗了 counter 给 oldIdToTmpId 占位).
  // 然而 oldIdToTmpId 里的 tmpId 已固化, 续走的 allocTmpId 不能撞 — 故 counter
  // 维持第一遍结束后的值,继续 ++.
  // (已经如此:上面 counter let 闭包,allocTmpId 续号 OK.)

  for (const atom of sanitized) {
    // table 单独走 tableAdapter
    if (atom.type === 'table') {
      const tiptapContent =
        (atom.content?.tiptapContent as unknown[] | undefined) ?? [];
      // 构造一个 PmPayload-like 节点喂 tableAdapter
      const tableNode: PmPayload = {
        type: 'table',
        attrs: {},
        content: tiptapContent as PmPayload[],
      };
      // table 自身 tmpId:若 sanitize 时已有 id,用 oldIdToTmpId 映射;否则新分配
      let tableTmpId: string;
      if (typeof atom.id === 'string' && atom.id && oldIdToTmpId.has(atom.id)) {
        tableTmpId = oldIdToTmpId.get(atom.id)!;
      } else {
        tableTmpId = allocTmpId();
      }
      const { tableDraft, cellDrafts } = tableAdapter({
        tablePmNode: tableNode,
        tableTmpId,
        allocTmpId,
        from: atom.from,
      });
      // 处理 parentTmpId(老 atom.parentId 字面映射)
      if (atom.parentId && oldIdToTmpId.has(atom.parentId)) {
        tableDraft.parentTmpId = oldIdToTmpId.get(atom.parentId);
      }
      drafts.push(tableDraft);
      for (const cd of cellDrafts) {
        drafts.push(cd);
      }
      continue;
    }

    // 非 table:转 PmAtomDraft
    // tmpId
    let tmpId: string;
    if (typeof atom.id === 'string' && atom.id && oldIdToTmpId.has(atom.id)) {
      tmpId = oldIdToTmpId.get(atom.id)!;
    } else {
      tmpId = allocTmpId();
    }

    // 构造 payload PmPayload — 字面是 V1 PM-JSON atom 形态(type + content),
    // 不能直接当 PmPayload(PmPayload.content 是 PmPayload[],而 LegacyExtractionAtom.content
    // 是 Record<string, unknown>).这里字面把 V1 atom 数据搬到 PmPayload 槽位.
    //
    // 注:Stage 7 不再做"atom JSON → PM JSON"转换(那是 atomsToProseMirror 的事,
    // V1 内部专用);Stage 7 createNotesBatch 字面消费 PmAtomDraft,storage 持久化
    // 后由 assemblePmDoc 字面重建 PM JSON.若直接持久化 V1 PM-JSON 形态,
    // assemble 端无法识别(它读 storage 期待 PmPayload).
    //
    // 故 krigBatchToAtoms 字面:仅把已是 PM 形态的 atom (sanitize 后 tiptapContent /
    // 嵌套 paragraph/heading/list 等) 透传,attrs.id 字面剥(由 storage 分配真 ULID).
    //
    // 为最小破坏 V1 兼容,字面保留 atom.content 字段原样 — 但 storage 端 PmPayload
    // schema 字面只认 type + content + attrs + marks + text 字段,V1 形态的
    // content.{children, tiptapContent} 会在 storage 持久化时被丢弃或保留为 attrs.
    //
    // 简化路径:字面把 atom 数据全部塞到 PmPayload.attrs.legacyAtom 里作为 escape hatch,
    // type 维持 atom.type.下游 assemble 端字面识别 attrs.legacyAtom 时走 V1 兼容路径.
    //
    // 实际上,为最小风险,本期字面**保留原 atom 形态作为 attrs.legacyContent 字段**
    // (storage 持久化 PmPayload 时 attrs 是 Record<string, unknown> 任意透传).

    const draftPayload: PmPayload = {
      type: atom.type,
      attrs: {
        ...(atom.attrs ?? {}),
        // V1 atom 兼容数据透传(legacy 形态,assemble 端字面识别)
        ...(atom.content ? { legacyContent: atom.content } : {}),
        ...(atom.meta ? { legacyMeta: atom.meta } : {}),
      },
      content: [],
    };

    const draft: PmAtomDraft = {
      tmpId,
      payload: {
        domain: 'pm',
        payload: draftPayload,
      },
      ...(atom.from ? { from: atom.from as AtomFrom } : {}),
    };

    // parentTmpId 字面映射
    if (atom.parentId && oldIdToTmpId.has(atom.parentId)) {
      draft.parentTmpId = oldIdToTmpId.get(atom.parentId);
    }

    drafts.push(draft);
  }

  return {
    title,
    bookName,
    atoms: drafts,
    warnings,
  };
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
