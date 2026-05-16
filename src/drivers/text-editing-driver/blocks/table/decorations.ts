/**
 * table decorations — 列 dot widget(L5-B3.7.1, M2 v4)
 *
 * 之前 M2 列 dot 走 NodeView append(`cell.appendChild(dot)`)被 PM reconcile
 * 清掉(PM 重渲 td 时 wipe innerHTML);改走 PM 官方 Decoration.widget,PM
 * 自己负责 dot DOM 生命周期 — reconcile 时自动重挂。
 *
 * 设计:
 * - 遍历 doc 找 table 节点,对每个 table 的第一行(table.firstChild)
 *   每个 cell 在 cell 内容起点(cellPos+1)挂一个 widget decoration
 * - widget DOM = <button.krig-table-block__col-dot data-...>
 *   CSS:cell position:relative,dot position:absolute top:-3 left:50% → 锐 cell
 * - click handler 走模块级 menu-context + popupController;instanceId 通过
 *   dot.closest('[data-instance-id]') 反查(Host.tsx mount 时在 view.dom 父
 *   wrapper 挂 data-instance-id 属性)
 *
 * 行 dot 与 cellSelection ⋯ 不在本 plugin 范围(M2 后续阶段)。
 */

import { Plugin, PluginKey } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import type { EditorState } from 'prosemirror-state';
import type { Node as PMNode } from 'prosemirror-model';
import { popupController } from '@slot/triggers/popup-controller';
import { setTableMenuContext } from './menu-context';

const POPUP_ID = 'text-editing.popup.table-menu';

export const tableDecorationsPluginKey = new PluginKey<DecorationSet>('table-decorations');

/** 创建列 dot DOM(widget render 用) */
function createColDot(tablePos: number, colIdx: number): HTMLButtonElement {
  const dot = document.createElement('button');
  dot.type = 'button';
  dot.classList.add('krig-table-block__col-dot');
  dot.setAttribute('contenteditable', 'false');
  dot.setAttribute('data-krig-decoration', 'true');
  dot.title = '操作该列';
  dot.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    // instanceId 反查:dot 在 cell 在 table 在 view.dom 在 host wrapper(挂 data-instance-id)
    const hostEl = dot.closest('[data-instance-id]') as HTMLElement | null;
    const instanceId = hostEl?.getAttribute('data-instance-id') ?? null;
    if (!instanceId) return;
    setTableMenuContext({
      instanceId,
      tablePos,
      scope: 'column',
      colIdx,
    });
    popupController.show(POPUP_ID, dot);
  });
  return dot;
}

/** 遍历 doc 给每个 table 第一行每个 cell 生成 widget decoration */
function buildDecorations(state: EditorState): DecorationSet {
  const decos: Decoration[] = [];

  state.doc.descendants((node: PMNode, pos: number) => {
    if (node.type.name !== 'table') return true;
    const tablePos = pos;
    const firstRow = node.firstChild;
    if (!firstRow) return false;
    // firstRow 起点 = tablePos + 1(进 table 后第一个 child)
    // cell 起点 = firstRow 起点 + 1(进 row)= tablePos + 2;之后逐 cell.nodeSize 累加
    let cellPos = tablePos + 2;
    firstRow.forEach((cell, _offset, colIdx) => {
      // cell 内容起点 = cellPos + 1(进 cell)
      const contentStart = cellPos + 1;
      decos.push(
        Decoration.widget(
          contentStart,
          () => createColDot(tablePos, colIdx),
          {
            side: -1,
            ignoreSelection: true,
            key: `col-dot-${tablePos}-${colIdx}`,
          },
        ),
      );
      cellPos += cell.nodeSize;
    });
    return false; // table 内不递归(嵌套 table 各自有自己的 col dots)
  });

  return DecorationSet.create(state.doc, decos);
}

/**
 * table-decorations plugin
 *
 * 提供列 dot widget decoration。每次 doc 变化重算 DecorationSet。
 * 粒度足够:一个文档 table 数有限,decoration 数 = 列数 × table 数,远低于
 * inline mark decorations(后者按字数算)。
 */
export function buildTableDecorationsPlugin(): Plugin<DecorationSet> {
  return new Plugin<DecorationSet>({
    key: tableDecorationsPluginKey,

    state: {
      init(_config, instance) {
        return buildDecorations(instance);
      },
      apply(tr, oldSet, _oldState, newState) {
        if (!tr.docChanged) {
          return oldSet.map(tr.mapping, tr.doc);
        }
        return buildDecorations(newState);
      },
    },

    props: {
      decorations(state) {
        return tableDecorationsPluginKey.getState(state);
      },
    },
  });
}
