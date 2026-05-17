/**
 * columnList commands — 插入 + 嵌套防护
 *
 * 参 V1 SlashMenu.tsx:228-249 创建逻辑(继承当前段落内容到第一列)。
 */

import { TextSelection } from 'prosemirror-state';
import type { Command, EditorState } from 'prosemirror-state';
import type { ResolvedPos } from 'prosemirror-model';

/** 判定光标祖先是否含 columnList(嵌套防护) */
export function isInsideColumnList($from: ResolvedPos): boolean {
  for (let d = $from.depth; d >= 1; d--) {
    if ($from.node(d).type.name === 'columnList') return true;
  }
  return false;
}

/** 找最近 block 节点的起止 pos(参 table/commands.ts findNearestBlock) */
function findNearestBlock(state: EditorState): { from: number; to: number } | null {
  const { $from } = state.selection;
  for (let d = $from.depth; d >= 0; d--) {
    const node = $from.node(d);
    if (node.isBlock && d > 0) {
      const from = $from.before(d);
      return { from, to: from + node.nodeSize };
    }
  }
  return null;
}

/**
 * 插入 columnList(替换当前 block)
 *
 * - cols=2|3,默认 2
 * - 第一列继承当前 block 内容(若为 paragraph 且非空);其余列空 paragraph
 * - 光标进第一列首段
 * - 嵌套防护:已在 columnList 内则 no-op
 */
export function insertColumnList(cols: 2 | 3 = 2): Command {
  return (state, dispatch) => {
    if (cols !== 2 && cols !== 3) return false;

    const schema = state.schema;
    const columnListType = schema.nodes.columnList;
    const columnType = schema.nodes.column;
    const paragraphType = schema.nodes.paragraph;
    if (!columnListType || !columnType || !paragraphType) return false;

    const { $from } = state.selection;
    if (isInsideColumnList($from)) return false;

    const range = findNearestBlock(state);
    if (!range) return false;

    if (dispatch) {
      const currentBlock = state.doc.nodeAt(range.from);
      const firstColumnChildren = currentBlock?.type.name === 'paragraph' && currentBlock.content.size > 0
        ? [paragraphType.create(null, currentBlock.content)]
        : [paragraphType.create()];

      const columns = [columnType.create(null, firstColumnChildren)];
      for (let i = 1; i < cols; i++) {
        columns.push(columnType.create(null, [paragraphType.create()]));
      }
      const columnListNode = columnListType.create({ columns: cols }, columns);

      const tr = state.tr.replaceWith(range.from, range.to, columnListNode);
      // 光标进第一列首段:columnList(+1) → column(+1) → paragraph(+1) = range.from + 3
      try {
        tr.setSelection(TextSelection.create(tr.doc, range.from + 3));
      } catch {
        /* ignore — 边界场景 */
      }
      dispatch(tr);
    }
    return true;
  };
}
