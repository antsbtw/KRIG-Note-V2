/**
 * block-indent plugin — 顶层 block 视觉缩进装饰
 *
 * 读 node attrs.indent (0-8) 给顶层 block 加 margin-left。
 *
 * 与列表嵌套的区别:
 * - 列表嵌套走 listItem.sinkListItem(prosemirror-schema-list,改 doc 结构)
 * - 本 plugin 走 indent attr 装饰(不改 doc 结构,纯视觉)
 *
 * MAX_INDENT 限 8 级,单级 24px,与 V1 一致。
 */

import { Plugin } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';

const INDENT_STEP_PX = 24;

// listItem / taskItem 自己在 spec.toDOM / nodeView 出 margin-left(不靠本 decoration,
// 避免 li 上叠两层 margin)。本 plugin 只对「非列表项」的块出缩进装饰。
const SELF_RENDERED_INDENT = new Set(['listItem', 'taskItem']);

export function buildBlockIndentPlugin(): Plugin {
  return new Plugin({
    props: {
      decorations(state) {
        const decos: Decoration[] = [];
        // descendants 全树遍历 —— 容器(callout/blockquote/toggle/column)内部块的 indent
        // 也要渲染(2026-06-07:容器内 Tab 缩进内部块,不再只缩进顶层容器)。
        state.doc.descendants((node, pos) => {
          if (SELF_RENDERED_INDENT.has(node.type.name)) return true; // 列表项自渲染,继续下降
          const indent = (node.attrs.indent as number | undefined) ?? 0;
          if (indent > 0) {
            decos.push(
              Decoration.node(pos, pos + node.nodeSize, {
                style: `margin-left: ${indent * INDENT_STEP_PX}px`,
              }),
            );
          }
          return true;
        });
        return decos.length > 0 ? DecorationSet.create(state.doc, decos) : DecorationSet.empty;
      },
    },
  });
}
