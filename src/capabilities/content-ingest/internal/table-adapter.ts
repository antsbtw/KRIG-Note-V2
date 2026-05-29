/**
 * tableAdapter — 5B Stage 5 Q1 字面实施
 *
 * 把契约 `table.content.tiptapContent` (PMNode[], 顶层 tableRow) 展开为:
 *   - table atom 自身(content=[], attrs.id 占位 null)
 *   - cell / header atoms(带 attrs.rowIndex / colIndex / id 占位 null)
 *   - childOf 边集(cellAtom → tableAtom,**跳过 tableRow** — 5A 拍板 tableRow 不是 atom)
 *
 * 算法 5 步(5B Q1 §3 字面):
 *   1. 遍历 tiptapContent 顶层 tableRow,rowIdx 从 0 起
 *   2. 遍历每 tableRow 的 children(tableCell / tableHeader),colIdx 从 0 起
 *   3. 字面生成 `cellAtom = { id:null, type:'tableCell'|'tableHeader',
 *      content:{ pmContent: cell.content }, parentId:tableAtomId, from,
 *      attrs:{ rowIndex, colIndex, colspan, rowspan, colwidth, align, id:null } }`
 *   4. 生成 childOf 边
 *   5. 不再生成 tableRow atom(5A 拍板)
 *
 * **不实现** pm-to-tiptap 反向桥(5B Q1 §4 拍板;留 Stage 7+ 写库时考虑).
 *
 * id 占位策略:
 *   - generateUlid 字面 import 但本期**不调用** — id 由 capability 层 inject(5B §7.3.1
 *     五处消费方第 5 项 injectIdsForCreate). 当前所有 atom.id 字面 null.
 *
 * STRUCTURAL_CONTAINER_TYPES:
 *   - 字面 import from `@semantic/types/structural` 单点 — Stage 1-2 已收敛(5 项).
 *   - 本算法只对 tableRow 做"跳层"处理(它是 5 项之一),不复用 set 本身;import
 *     维持是为校验"tableRow 仍在结构性容器集合"的字面契约.
 */

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- id 占位策略:本期不调用,但保持 import 让 5B §7.3.1 inject 阶段字面可见依赖.
import { generateUlid } from '@shared/ulid';
import { STRUCTURAL_CONTAINER_TYPES } from '@semantic/types/structural';
import type { Atom, AtomFrom } from '../types';

// 静态断言:tableRow 仍是结构性容器(5A 拍板硬契约);否则本算法的"跳层"前提失效.
// 字面执行一次,失败时 capability 装载即报错.
if (!STRUCTURAL_CONTAINER_TYPES.has('tableRow')) {
  throw new Error(
    '[content-ingest/tableAdapter] STRUCTURAL_CONTAINER_TYPES 字面不含 tableRow — ' +
      '违反 5A 拍板硬契约(decision 026 §3.1.2 修订附记).',
  );
}

export interface TableAdapterInput {
  /** 契约 table.content.tiptapContent: PMNode[],顶层 tableRow */
  tiptapContent: unknown[];
  /** 父 atom id(table 自身的 ULID,给 cell.parentId 用,可选) */
  tableAtomId?: string;
  /** 来源信息(透传到生成的 cell atoms) */
  from?: AtomFrom;
}

export interface TableAdapterOutput {
  /** table atom 自身(content=[] + attrs.id 占位 null) */
  tableAtom: Atom;
  /** cell / header atoms(带 attrs.rowIndex / colIndex / id 占位 null) */
  cellAtoms: Atom[];
  /** 边集:cellAtom → tableAtom 的 childOf */
  childOfEdges: Array<{ subjectId: string; objectId: string }>;
}

/** PMNode 局部形态(只取本算法用得到的字段;避免与 md-to-pm.ts PMNode 强耦合) */
interface PmNodeLike {
  type?: string;
  attrs?: Record<string, unknown>;
  content?: PmNodeLike[];
}

/**
 * tableAdapter 字面实施(5B Q1 §3 算法 5 步).
 *
 * **不**生成 tableRow atom(5A 拍板).
 * **生成** table atom(content=[], attrs.id 占位 null)+ cell atoms + childOf 边.
 */
export function tableAdapter(input: TableAdapterInput): TableAdapterOutput {
  const { tiptapContent, tableAtomId, from } = input;

  // table atom 自身:content=[](容器,decision 026 §3.4);attrs.id 占位 null
  const tableAtom: Atom = {
    id: null,
    type: 'table',
    content: { tiptapContent: [] },
    attrs: { id: null },
    ...(from ? { from } : {}),
  };

  const cellAtoms: Atom[] = [];
  const childOfEdges: Array<{ subjectId: string; objectId: string }> = [];

  if (!Array.isArray(tiptapContent)) {
    return { tableAtom, cellAtoms, childOfEdges };
  }

  // (1) 遍历 tiptapContent 顶层 tableRow,rowIdx 从 0 起
  let rowIdx = 0;
  for (const rowNode of tiptapContent as PmNodeLike[]) {
    if (!rowNode || rowNode.type !== 'tableRow') {
      // 非 tableRow 顶层节点字面跳过(契约违反由 sanitize 阶段报警;本算法字面安全)
      continue;
    }

    const rowCells = Array.isArray(rowNode.content) ? rowNode.content : [];

    // (2) 遍历每 tableRow 的 children,colIdx 从 0 起
    let colIdx = 0;
    for (const cellNode of rowCells) {
      if (!cellNode) {
        colIdx++;
        continue;
      }
      const cellType = cellNode.type;
      if (cellType !== 'tableCell' && cellType !== 'tableHeader') {
        // PM schema 保证 tableRow > (tableCell | tableHeader)+;非 cell/header 字面跳过
        continue;
      }

      const cellAttrs = (cellNode.attrs ?? {}) as Record<string, unknown>;

      // (3) 字面生成 cellAtom
      //   - content.pmContent:cell 内部 PM children(段落 / 嵌套等)
      //   - attrs.rowIndex / colIndex:本算法字面注入(对齐 dissect-pm-doc.ts:119
      //     Stage 3 tableRow 跳层注入策略 — 5A §5.3 / Q2 选项 B)
      //   - attrs.id 占位 null;由 capability 层 inject(5B §7.3.1 第 5 项)
      //   - attrs.colspan / rowspan / colwidth / align:字面透传 cell.attrs 已有值
      //   - tableCell 有 bookAnchor 字段, tableHeader 无(S1.3.2 / S1.3.3 字面). 本算法
      //     字面**不强制**注入 bookAnchor — 透传原 cell.attrs.bookAnchor(若有),
      //     非 cell type 字面不补.
      const cellAtom: Atom = {
        id: null,
        type: cellType,
        content: { pmContent: cellNode.content ?? [] },
        ...(tableAtomId ? { parentId: tableAtomId } : {}),
        ...(from ? { from } : {}),
        attrs: {
          id: null,
          rowIndex: rowIdx,
          colIndex: colIdx,
          colspan: cellAttrs.colspan ?? 1,
          rowspan: cellAttrs.rowspan ?? 1,
          colwidth: cellAttrs.colwidth ?? null,
          align: cellAttrs.align ?? null,
          // bookAnchor: 仅 tableCell 透传(tableHeader schema 无此字段;S1.3.3 字面)
          ...(cellType === 'tableCell' && 'bookAnchor' in cellAttrs
            ? { bookAnchor: cellAttrs.bookAnchor }
            : cellType === 'tableCell'
              ? { bookAnchor: null }
              : {}),
        },
      };

      cellAtoms.push(cellAtom);

      // (4) 生成 childOf 边:cellAtom → tableAtom(跳过 tableRow,因为它不是 atom)
      // 此处 subjectId/objectId 字面留 null(id 待 inject);Stage 7 inject 时同步绑定.
      // 设计 §7.3.1 第 5 项 injectIdsForCreate 字面承诺会消费此处的 null placeholder.
      if (tableAtomId) {
        childOfEdges.push({
          subjectId: '', // 待 inject(cellAtom.id 写好后字面回填)
          objectId: tableAtomId,
        });
      }

      colIdx++;
    }

    rowIdx++;
  }

  // (5) 不生成 tableRow atom — 字面省略(5A 拍板 + 决议 026 §3.1.2 §6.1)

  return { tableAtom, cellAtoms, childOfEdges };
}
