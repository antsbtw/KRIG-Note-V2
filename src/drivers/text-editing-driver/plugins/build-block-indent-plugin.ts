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

export function buildBlockIndentPlugin(): Plugin {
  return new Plugin({
    props: {
      decorations(state) {
        const decos: Decoration[] = [];
        state.doc.forEach((node, pos) => {
          const indent = (node.attrs.indent as number | undefined) ?? 0;
          if (indent > 0) {
            decos.push(
              Decoration.node(pos, pos + node.nodeSize, {
                style: `margin-left: ${indent * INDENT_STEP_PX}px`,
              }),
            );
          }
        });
        return decos.length > 0 ? DecorationSet.create(state.doc, decos) : DecorationSet.empty;
      },
    },
  });
}
