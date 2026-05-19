/**
 * block-selection plugin — block 选中视觉统一(MultipleNodeSelection + NodeSelection-on-atom)
 *
 * 设计:
 *  - 多块/常规块走 MultipleNodeSelection(Selection 子类),tr.setSelection 携带,
 *    clipboard / drag / history 自动走 PM 默认 pipeline。
 *  - atom block(horizontalRule 等无内容叶子)点击触发 PM 默认 NodeSelection,
 *    本 plugin 给它同款 `krig-block-selected` 蓝底 deco + is-block-selecting 类,
 *    视觉与 MultipleNodeSelection 完全一致(用户无需感知两套机制)。
 *  - 选区算法(Esc / Shift+Arrow / 拖动后保留 / ...)在 build-block-selection-keymap。
 *
 * **不**持有 PluginState — 一切选区都在 view.state.selection 中。
 */

import { NodeSelection, Plugin } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import { MultipleNodeSelection } from './_shared/multiple-node-selection';

const ROOT_CLASS = 'is-block-selecting';

/** atom block 上的 NodeSelection 是"块选择"语义的另一种形态(PM 内置) */
function isAtomBlockNodeSelection(sel: import('prosemirror-state').Selection): sel is NodeSelection {
  return sel instanceof NodeSelection && sel.node.isBlock && sel.node.isAtom;
}

function isBlockSelectionLike(sel: import('prosemirror-state').Selection): boolean {
  return sel instanceof MultipleNodeSelection || isAtomBlockNodeSelection(sel);
}

function syncRootClass(view: import('prosemirror-view').EditorView): void {
  view.dom.classList.toggle(ROOT_CLASS, isBlockSelectionLike(view.state.selection));
}

export function buildBlockSelectionPlugin(): Plugin {
  return new Plugin({
    props: {
      decorations(state) {
        const sel = state.selection;

        // 分支 1:atom block 的 NodeSelection(hr 等)— 单节点 deco
        if (isAtomBlockNodeSelection(sel)) {
          return DecorationSet.create(state.doc, [
            Decoration.node(sel.from, sel.to, { class: 'krig-block-selected' }),
          ]);
        }

        // 分支 2:MultipleNodeSelection — 同级多块 deco(直接读 sel 暴露的归一化字段)
        if (!(sel instanceof MultipleNodeSelection)) return null;
        const minIdx = Math.min(sel.anchorIdx, sel.headIdx);
        const maxIdx = Math.max(sel.anchorIdx, sel.headIdx);
        // parent before pos:parentDepth=0 时是 doc 顶层(-1);否则用 depth > parentDepth 一端
        const srcPos = sel.$anchorPos.depth > sel.parentDepth ? sel.$anchorPos : sel.$headPos;
        const parentStart =
          sel.parentDepth === 0 ? -1 :
          srcPos.depth > sel.parentDepth ? srcPos.before(sel.parentDepth) : -1;

        const decos: Decoration[] = [];
        let offset = parentStart === -1 ? 0 : parentStart + 1;
        for (let i = 0; i < sel.parent.childCount; i++) {
          const childSize = sel.parent.child(i).nodeSize;
          if (i >= minIdx && i <= maxIdx) {
            decos.push(
              Decoration.node(offset, offset + childSize, { class: 'krig-block-selected' }),
            );
          }
          offset += childSize;
        }
        return DecorationSet.create(state.doc, decos);
      },
    },
    view(view) {
      syncRootClass(view);
      return {
        update(v) {
          syncRootClass(v);
        },
        destroy() {
          view.dom.classList.remove(ROOT_CLASS);
        },
      };
    },
  });
}
