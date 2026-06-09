/**
 * tableAdapter — 5B Stage 7 重做(2026-05-29 规范字面对齐)
 *
 * 把 table PM node 展开为:
 *   - table atom draft (payload=Atom<'pm'>, payload.payload.type='table', content=[])
 *   - cell drafts (tableCell + tableHeader) — parentTmpId 字面指向 tableTmpId
 *
 * 算法字面(5 步):
 *   1. 生成 tableDraft (tmpId=tableTmpId, payload.payload.type='table', content=[])
 *   2. 遍历 tablePmNode.content 顶层 (tableRow), rowIdx 0 起
 *   3. 遍历每 tableRow.content (cells), colIdx 0 起
 *   4. 每 cell 生成 cellDraft (tmpId=allocTmpId(), parentTmpId=tableTmpId,
 *      payload.payload.type=cell.type, attrs 注入 rowIndex/colIndex, content=cell.content)
 *   5. 不生成 tableRow draft (5A 拍板 tableRow 不是 atom)
 *
 * 规范依据:
 *  - Atom<'pm'> = { domain:'pm', payload: PmPayload } (atom/spec.md §1 + decision 010)
 *  - childOf 边由 createNotesBatch 单点合成 (走 parentTmpId 隐式表达)
 *  - tableRow 仍在 STRUCTURAL_CONTAINER_TYPES 集合 (5A 拍板硬契约)
 */

import { STRUCTURAL_CONTAINER_TYPES } from '@semantic/types/structural';
import type { PmAtomDraft, AtomFrom } from '@semantic/types';
import type { PmPayload } from '@semantic/types';
import { generateUlid } from '@shared/ulid';

/** inline 类型(不带 attrs.id 字段)—— 与 atoms-to-pm INLINE_TYPES / dissect 同源 */
const INLINE_TYPES = new Set(['text', 'hardBreak', 'fileLink', 'noteLink', 'mathInline']);

/**
 * 递归给 cell 内的「应有 id 的 block」注入真 ULID。
 *
 * 根因(2026-06-09 真实数据定位 / Go 书 PDF 第 1 章 table):
 * PDF/markdown 提取的 table,cell 内容是 [{type:'paragraph',content:[...]}] —— 这些
 * 嵌套 paragraph **无 attrs.id**。tableAdapter 原先把 cellContent 原样塞进 cell payload
 * (本文件第 112 行 content: cellContent),cell 内 paragraph 既不是独立 draft(拿不到
 * createSingleNoteFromDrafts 分配的 realId),也没人补 id → 落库后 dissect 该 cell 内容时
 * 命中无 id block 直接 throw(decision 026 §5.1)。
 *
 * 故在此处一次性补真 id:结构性容器(tableRow/list 等)/ inline 不补,其余 block 补
 * 真 generateUlid()(已有真 id 幂等保留)—— 与 buildAutoBlockIdPlugin shouldHaveId 同源。
 */
function injectCellContentIds(nodes: PmPayload[]): PmPayload[] {
  const visit = (node: PmPayload): PmPayload => {
    const out: PmPayload = { ...node };
    if (Array.isArray(node.content)) {
      out.content = node.content.map(visit);
    }
    if (!STRUCTURAL_CONTAINER_TYPES.has(node.type) && !INLINE_TYPES.has(node.type)) {
      const attrs = (out.attrs ?? {}) as Record<string, unknown>;
      if (attrs.id == null) {
        out.attrs = { ...attrs, id: generateUlid() };
      }
    }
    return out;
  };
  return nodes.map(visit);
}

// 静态断言:tableRow 仍是结构性容器(5A 拍板硬契约);否则本算法的"跳层"前提失效.
if (!STRUCTURAL_CONTAINER_TYPES.has('tableRow')) {
  throw new Error(
    '[content-ingest/tableAdapter] STRUCTURAL_CONTAINER_TYPES 字面不含 tableRow — ' +
      '违反 5A 拍板硬契约(decision 026 §3.1.2 修订附记).',
  );
}

export interface TableAdapterInput {
  /** table PM node (含 attrs + content);content 顶层是 tableRow 数组 */
  tablePmNode: PmPayload;
  /** table 自身的 tmpId (由 caller markdown-to-atoms 分配) */
  tableTmpId: string;
  /** 新 tmpId 分配器 (caller 传递的递增 counter 引用,字面避免 tmpId 碰撞) */
  allocTmpId: () => string;
  from?: AtomFrom;
}

export interface TableAdapterOutput {
  /** table atom draft (payload.payload.type='table', content=[]) */
  tableDraft: PmAtomDraft;
  /** cell drafts (tableCell + tableHeader); parentTmpId 字面指向 tableTmpId */
  cellDrafts: PmAtomDraft[];
}

/** tableAdapter 字面实施(5B Stage 7 重做). */
export function tableAdapter(input: TableAdapterInput): TableAdapterOutput {
  const { tablePmNode, tableTmpId, allocTmpId, from } = input;

  // (1) tableDraft 自身 — payload.payload.content = [] (容器,decision 026 §3.4)
  const tableDraft: PmAtomDraft = {
    tmpId: tableTmpId,
    payload: {
      domain: 'pm',
      payload: {
        type: 'table',
        attrs: tablePmNode.attrs ?? {},
        content: [],
      },
    },
    ...(from ? { from } : {}),
  };

  const cellDrafts: PmAtomDraft[] = [];

  const tableContent = Array.isArray(tablePmNode.content) ? tablePmNode.content : [];

  // (2) 遍历 tableRow,rowIdx 0 起
  let rowIdx = 0;
  for (const rowNode of tableContent) {
    if (!rowNode || rowNode.type !== 'tableRow') {
      // 非 tableRow 顶层节点字面跳过
      continue;
    }

    const rowCells = Array.isArray(rowNode.content) ? rowNode.content : [];

    // (3) 遍历 cells,colIdx 0 起
    let colIdx = 0;
    for (const cellNode of rowCells) {
      if (!cellNode) {
        colIdx++;
        continue;
      }
      const cellType = cellNode.type;
      if (cellType !== 'tableCell' && cellType !== 'tableHeader') {
        // PM schema 保证 tableRow > (tableCell | tableHeader)+;字面跳过
        continue;
      }

      const cellAttrs = (cellNode.attrs ?? {}) as Record<string, unknown>;
      // cell 内嵌套 block(paragraph 等)补真 id —— 否则落库后 dissect 命中无 id block throw
      const cellContent = injectCellContentIds(
        Array.isArray(cellNode.content) ? cellNode.content : [],
      );

      // (4) cellDraft
      const cellDraft: PmAtomDraft = {
        tmpId: allocTmpId(),
        parentTmpId: tableTmpId,
        payload: {
          domain: 'pm',
          payload: {
            type: cellType,
            attrs: {
              ...cellAttrs,
              rowIndex: rowIdx,
              colIndex: colIdx,
            },
            content: cellContent,
          },
        },
        ...(from ? { from } : {}),
      };

      cellDrafts.push(cellDraft);
      colIdx++;
    }

    rowIdx++;
  }

  // (5) 不生成 tableRow draft(5A 拍板)
  return { tableDraft, cellDrafts };
}
