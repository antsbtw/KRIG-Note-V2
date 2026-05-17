/**
 * Column Collapse Plugin — 空 column 自动收缩
 *
 * 直迁 V1 src/plugins/note/plugins/column-collapse.ts。
 * V2 适配:textBlock → paragraph。
 *
 * appendTransaction 后处理(仅在 column 由非空变空时触发):
 * - column 只剩一个空 paragraph 且之前有内容 → 移除该 column,剩余 column 扩展
 * - columnList 只剩 1 个非空 column → 解散 columnList,子节点平铺到顶层
 * - columnList 所有 column 都空 → 替换为一个空 paragraph
 */

import { Plugin } from 'prosemirror-state';
import { Fragment, type Node as PMNode } from 'prosemirror-model';

function isEmptyColumn(column: PMNode): boolean {
  if (column.type.name !== 'column') return false;
  if (column.childCount !== 1) return false;
  const child = column.child(0);
  return child.type.name === 'paragraph' && child.content.size === 0;
}

export function columnCollapsePlugin(): Plugin {
  return new Plugin({
    appendTransaction(_transactions, oldState, newState) {
      if (oldState.doc.eq(newState.doc)) return null;

      // 收集 oldState 中每个 columnList 内各 column 的空/非空状态
      const oldColumnStates = new Map<number, boolean[]>();
      oldState.doc.forEach((node, offset) => {
        if (node.type.name === 'columnList') {
          const states: boolean[] = [];
          for (let c = 0; c < node.childCount; c++) {
            states.push(isEmptyColumn(node.child(c)));
          }
          oldColumnStates.set(offset, states);
        }
      });

      const { doc } = newState;
      let tr = newState.tr;
      let changed = false;

      const topNodes: { node: PMNode; pos: number }[] = [];
      doc.forEach((node, offset) => {
        if (node.type.name === 'columnList') {
          topNodes.push({ node, pos: offset });
        }
      });

      // 从后往前遍历,避免位置偏移
      for (let i = topNodes.length - 1; i >= 0; i--) {
        const { node: columnList, pos: clPos } = topNodes[i];
        const oldStates = oldColumnStates.get(clPos);

        const newlyEmptyIndices: number[] = [];
        for (let c = 0; c < columnList.childCount; c++) {
          if (!isEmptyColumn(columnList.child(c))) continue;
          const wasEmpty = oldStates && c < oldStates.length ? oldStates[c] : true;
          if (!wasEmpty) newlyEmptyIndices.push(c);
        }

        if (newlyEmptyIndices.length === 0) continue;

        const nonEmptyColumns: { col: PMNode; index: number }[] = [];
        for (let c = 0; c < columnList.childCount; c++) {
          if (!isEmptyColumn(columnList.child(c))) {
            nonEmptyColumns.push({ col: columnList.child(c), index: c });
          }
        }

        const mappedPos = tr.mapping.map(clPos);
        const mappedNode = tr.doc.nodeAt(mappedPos);
        if (!mappedNode) continue;

        if (nonEmptyColumns.length === 0) {
          // 全空 → 替换为一个空 paragraph
          const newBlock = newState.schema.nodes.paragraph.create();
          tr = tr.replaceWith(mappedPos, mappedPos + mappedNode.nodeSize, newBlock);
          changed = true;
        } else if (nonEmptyColumns.length === 1) {
          // 只剩 1 非空 column → 解散 columnList,内容铺到顶层
          tr = tr.replaceWith(mappedPos, mappedPos + mappedNode.nodeSize, nonEmptyColumns[0].col.content);
          changed = true;
        } else {
          // 剩 ≥2 非空 column → 移除空 column,重置宽度
          const kept = nonEmptyColumns.map(({ col }) =>
            col.type.create({ ...col.attrs, width: null }, col.content),
          );
          const newColumnList = mappedNode.type.create(
            { ...mappedNode.attrs, columns: kept.length },
            Fragment.from(kept),
          );
          tr = tr.replaceWith(mappedPos, mappedPos + mappedNode.nodeSize, newColumnList);
          changed = true;
        }
      }

      if (!changed) return null;
      tr.setMeta('addToHistory', false);
      return tr;
    },
  });
}
