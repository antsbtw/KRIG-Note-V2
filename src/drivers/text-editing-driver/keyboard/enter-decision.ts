/**
 * enter-decision — Enter 决策链(keyboard-system.md §4.1)
 *
 * 向后展开,按块类型 + 位置依次判定。忠实复刻现状各 keymap 行为并统一(顺带修
 * audio/video/tweet caption 回车删块 bug —— 它们走 isCaption 分支即得正确行为)。
 *
 * 装载在旧 Enter keymap 之前接管;命中 return true(吃掉),否则 false 放行兜底。
 */

import { TextSelection, type Command, type EditorState } from 'prosemirror-state';
import { liftEmptyBlock } from 'prosemirror-commands';
import { splitListItem, liftListItem } from 'prosemirror-schema-list';
import type { KeyboardMetaLookup } from './resolve-context';
import {
  splitBlockInheritFormat,
  exitToParagraphAfter,
  insertSiblingToggleAfter,
  insertNewline,
  codeBlockExitOnDoubleEnter,
} from './semantic-actions';

const DEFAULT_FORMAT_ATTRS = ['indent', 'textIndent', 'align'] as const;

/** 找光标最近的指定 type 祖先 depth;无则 -1。 */
function ancestorDepthOfType(state: EditorState, typeName: string): number {
  const { $from } = state.selection;
  for (let d = $from.depth; d >= 1; d--) {
    if ($from.node(d).type.name === typeName) return d;
  }
  return -1;
}

export function buildEnterCommand(metaLookup: KeyboardMetaLookup): Command {
  return (state, dispatch, view) => {
    const sel = state.selection;
    if (!sel.empty) return false; // 非折叠选区 → 让默认链处理(replaceSelection 等)

    const { $from } = sel;
    const blockType = $from.parent.type.name;
    const meta = metaLookup(blockType);

    // —— 1. 代码区(codeBlock / math-block):Enter=插\n;末尾末字符\n→双回车跳出 ——
    const codeDepth = $from.depth;
    const codeNode = $from.node(codeDepth);
    if (meta?.isCodeArea && codeNode.type.spec.code) {
      const text = codeNode.textContent;
      const offset = $from.parentOffset;
      if (offset === text.length && text.endsWith('\n')) {
        return codeBlockExitOnDoubleEnter(codeNode, codeDepth)(state, dispatch);
      }
      return insertNewline()(state, dispatch);
    }

    // —— 2. caption(单段,image/html/math-visual/audio/video/tweet):跳出,块下方新段 ——
    // caption 结构:<mediaBlock> > <paragraph(caption)> > inline。父节点是 isCaption 块。
    if ($from.depth >= 2) {
      const parent = $from.node(-1);
      const parentMeta = metaLookup(parent.type.name);
      if (parentMeta?.isCaption) {
        const afterPos = $from.after(-1);
        return exitToParagraphAfter(() => ({ afterPos }))(state, dispatch);
      }
    }

    // —— 3. 收起 toggle 标题行:在 toggle 后插新 toggle(继承缩进)——
    const toggleDepth = ancestorDepthOfType(state, 'toggleList');
    if (toggleDepth >= 0) {
      const toggleList = $from.node(toggleDepth);
      if (toggleList.attrs.open === false) {
        return insertSiblingToggleAfter(toggleDepth)(state, dispatch);
      }
      // open=true → 落到下方通用 split(容器内小 note 正常拆段)
    }

    // —— 4. 列表项:非空拆项(splitListItem);空项跳出列表 ——
    // 注:prosemirror-schema-list 的 splitListItem 对**空的顶层列表项故意返回 false**
    // (设计上「让下一个命令做 lift」)。旧链靠 baseKeymap 的 liftEmptyBlock 兜底跳出;
    // 本集中链接管 Enter 后,必须自己显式调 liftListItem/liftEmptyBlock 跳出空项,
    // 否则会漏到 step 6 splitBlock → 空项不跳出、只是又分裂一个空项(2026-06-08 修)。
    const listItem = state.schema.nodes.listItem;
    const taskItem = state.schema.nodes.taskItem;
    const inListItem = listItem && ancestorDepthOfType(state, 'listItem') >= 0;
    const inTaskItem = taskItem && ancestorDepthOfType(state, 'taskItem') >= 0;
    if (inListItem || inTaskItem) {
      const itemType = inListItem ? listItem : taskItem;
      // 非空项:splitListItem 分裂出新项(返回 true);空项:它返回 false → 走 lift 跳出
      if (itemType && splitListItem(itemType)(state, dispatch, view)) return true;
      // 空项跳出:优先 liftListItem(嵌套列表上提一级 / 顶层项出列表),再退到 liftEmptyBlock
      if (itemType && liftListItem(itemType)(state, dispatch)) return true;
      if (liftEmptyBlock(state, dispatch)) return true;
    }

    // —— 5. column 末段空 → 退出 columnList(在 columnList 后插段)——
    const columnDepth = ancestorDepthOfType(state, 'column');
    if (columnDepth >= 0) {
      const column = $from.node(columnDepth);
      const isLast = $from.indexAfter(columnDepth) === column.childCount;
      if ($from.parent.content.size === 0 && isLast && column.childCount > 1) {
        const columnListDepth = ancestorDepthOfType(state, 'columnList');
        if (columnListDepth >= 0) {
          const columnList = $from.node(columnListDepth);
          const columnListEnd = $from.before(columnListDepth) + columnList.nodeSize;
          const para = state.schema.nodes.paragraph;
          if (para && dispatch) {
            const blockStart = $from.before($from.depth);
            const tr = state.tr.delete(blockStart, blockStart + $from.parent.nodeSize);
            const insertPos = tr.mapping.map(columnListEnd);
            tr.insert(insertPos, para.create());
            tr.setSelection(TextSelection.create(tr.doc, insertPos + 1));
            dispatch(tr);
          }
          return true;
        }
      }
      // column 只剩 1 空段 → 让 column-collapse 处理,这里不接管,放行
      if ($from.parent.content.size === 0 && column.childCount <= 1) return false;
    }

    // —— 5.5 通用容器(blockquote/callout/toggle 展开)空段末段回车 → 跳出容器 ——
    // enter-system §2.3「容器内空段回车 = 退出容器,在容器下方新建正文段」。
    // 仅当:当前段空 + 是该容器最末子块 + 该容器是 isContainer(非 column,column 已上面处理)。
    if ($from.parent.content.size === 0) {
      for (let d = $from.depth - 1; d >= 1; d--) {
        const node = $from.node(d);
        const name = node.type.name;
        if (name === 'column' || name === 'columnList') break; // column 专属,已处理
        const nodeMeta = metaLookup(name);
        if (nodeMeta?.isContainer) {
          const isLast = $from.indexAfter(d) === node.childCount;
          if (isLast) {
            const para = state.schema.nodes.paragraph;
            if (para && dispatch) {
              const containerEnd = $from.after(d);
              const blockStart = $from.before($from.depth);
              // 删空段 + 在容器后插正文段
              const tr = state.tr.delete(blockStart, blockStart + $from.parent.nodeSize);
              const insertPos = tr.mapping.map(containerEnd);
              tr.insert(insertPos, para.create());
              tr.setSelection(TextSelection.create(tr.doc, insertPos + 1)).scrollIntoView();
              dispatch(tr);
            }
            return true;
          }
          break; // 非末段 → 不跳出,落到通用 split(容器内拆段)
        }
      }
    }

    // —— 6. 普通 textblock:splitBlock + 继承格式(标题块尾→正文段由 PM defaultBlockAt 自然产出)——
    const formatAttrs = meta?.formatAttrs ?? DEFAULT_FORMAT_ATTRS;
    return splitBlockInheritFormat(formatAttrs)(state, dispatch);
  };
}
