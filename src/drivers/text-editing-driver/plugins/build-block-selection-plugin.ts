/**
 * block-selection plugin — MultipleNodeSelection 路线骨架(Step 1)
 *
 * 设计:
 *  - 选区类型走 MultipleNodeSelection(Selection 子类),tr.setSelection 携带,
 *    clipboard / drag / history 自动走 PM 默认 pipeline。
 *  - 本 plugin 做两件视觉增强:
 *    1. decoration: 给每个选中节点画 `krig-block-selected`(整块圆角蓝底)
 *    2. root class: view.dom 加 `is-block-selecting`,让 CSS 全局抑制
 *       原生 ::selection 文字底色,避免"双层选区"叠加(参见 pm-host.css)
 *  - 选区算法(Esc / Shift+Arrow / 拖动后保留 / ...)由后续 Step 2-4 加入。
 *
 * **不**持有 PluginState — 一切选区都在 view.state.selection 中。
 */

import { Plugin } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import { MultipleNodeSelection } from './_shared/multiple-node-selection';

const ROOT_CLASS = 'is-block-selecting';

function syncRootClass(view: import('prosemirror-view').EditorView): void {
  const active = view.state.selection instanceof MultipleNodeSelection;
  view.dom.classList.toggle(ROOT_CLASS, active);
}

export function buildBlockSelectionPlugin(): Plugin {
  return new Plugin({
    props: {
      decorations(state) {
        const sel = state.selection;
        if (!(sel instanceof MultipleNodeSelection)) return null;
        // 选中节点 = sel.nodes;每个对应 doc 内一个连续 child block
        const parent = sel.$anchorPos.node(sel.$anchorPos.depth - 1);
        const anchorIdx = sel.$anchorPos.index(sel.$anchorPos.depth - 1);
        const headIdx = sel.$headPos.index(sel.$headPos.depth - 1);
        const minIdx = Math.min(anchorIdx, headIdx);
        const maxIdx = Math.max(anchorIdx, headIdx);
        const parentStart =
          sel.$anchorPos.depth - 1 === 0 ? -1 : sel.$anchorPos.before(sel.$anchorPos.depth - 1);

        const decos: Decoration[] = [];
        let offset = parentStart === -1 ? 0 : parentStart + 1;
        for (let i = 0; i < parent.childCount; i++) {
          const childSize = parent.child(i).nodeSize;
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
