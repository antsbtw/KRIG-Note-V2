/**
 * table NodeView — Notion-style hover handle 版(L5-B3.7.1, M2)
 *
 * M1 → M2 变更:
 * - **移除** +col / +row 按钮(M1 末尾插入快捷)
 * - **新增** 列 handle bar(table 上沿,按列宽分段;hover 列冒出 dot;点击弹菜单)
 * - **新增** 行 handle bar(table 左沿,按行高分段;hover 行冒出 dot;点击弹菜单)
 * - **新增** CellSelection handle(检测到 CellSelection 时浮在选区上方;点击弹菜单)
 *
 * 关键设计:
 * - handle DOM 全在 contentDOM(tbody)外层,ignoreMutation 已只允 tbody 通过
 *   → PM 不 react,prosemirror-tables 内部状态不受干扰
 * - 列 / 行段几何来源:DOM 量(table.rows / cells getBoundingClientRect),
 *   随 colwidth resize / 行数变化 update() 回调时重算
 * - CellSelection handle:订阅 view 状态变化(NodeView 没原生订阅口,
 *   监听 view.dom 的 'mouseup' + 'keyup' + 自己维护 dispatch 跟随)
 *   M2 走"事件后 rAF 检查 selection",M3 plugin 化更稳
 *
 * 菜单点击链:
 *   handle dot mousedown
 *     → setTableMenuContext({ instanceId, tablePos, scope, rowIdx?/colIdx? })
 *     → popupController.show('text-editing.popup.table-menu', dotEl)
 */

import type { NodeViewConstructor } from 'prosemirror-view';
import { CellSelection } from 'prosemirror-tables';
import { popupController } from '@slot/triggers/popup-controller';
import { setTableMenuContext } from './menu-context';

const POPUP_ID = 'text-editing.popup.table-menu';

/** 从 view.dom 反查 driver instanceId(Host.tsx mount 时挂在 data-instance-id) */
function findInstanceId(view: { dom: HTMLElement }): string | null {
  const el = view.dom.closest('[data-instance-id]') as HTMLElement | null;
  return el?.getAttribute('data-instance-id') ?? null;
}

export const tableNodeView: NodeViewConstructor = (initialNode, view, getPos) => {
  // ── DOM 骨架 ─────────────────────────────────────────────

  const dom = document.createElement('div');
  dom.classList.add('krig-table-block');

  const scroll = document.createElement('div');
  scroll.classList.add('krig-table-block__scroll');
  dom.appendChild(scroll);

  const table = document.createElement('table');
  table.classList.add('krig-pm-table');
  const colgroup = document.createElement('colgroup');
  table.appendChild(colgroup);
  const tbody = document.createElement('tbody');
  table.appendChild(tbody);
  scroll.appendChild(table);

  // ── handle bars(列上沿 + 行左沿)─────────────────────────

  const colBar = document.createElement('div');
  colBar.classList.add('krig-table-block__col-bar');
  colBar.setAttribute('contenteditable', 'false');
  dom.appendChild(colBar);

  const rowBar = document.createElement('div');
  rowBar.classList.add('krig-table-block__row-bar');
  rowBar.setAttribute('contenteditable', 'false');
  dom.appendChild(rowBar);

  // ── CellSelection handle(浮在选区上方,默认隐藏)─────────────

  const csHandle = document.createElement('button');
  csHandle.type = 'button';
  csHandle.classList.add('krig-table-block__cs-handle');
  csHandle.setAttribute('contenteditable', 'false');
  csHandle.title = '操作选区';
  csHandle.textContent = '⋯';
  csHandle.style.display = 'none';
  dom.appendChild(csHandle);

  // ── 工具:开 popup(共用所有 handle dot)─────────────

  function openMenu(
    anchor: HTMLElement,
    scope: 'row' | 'column' | 'cellSelection',
    indices: { rowIdx?: number; colIdx?: number },
  ): void {
    const instanceId = findInstanceId(view);
    const pos = typeof getPos === 'function' ? getPos() : undefined;
    if (!instanceId || pos == null) return;
    setTableMenuContext({
      instanceId,
      tablePos: pos,
      scope,
      rowIdx: indices.rowIdx,
      colIdx: indices.colIdx,
    });
    popupController.show(POPUP_ID, anchor);
  }

  // ── 重建列 dots(按当前 table 列数,DOM 量取每列 left + width)─────────────

  function rebuildColumnDots(): void {
    colBar.innerHTML = '';
    const firstRow = tbody.querySelector('tr');
    if (!firstRow) return;
    const cells = Array.from(firstRow.children) as HTMLElement[];
    if (cells.length === 0) return;

    const tableRect = table.getBoundingClientRect();
    // 列基于 colspan/colwidth 可能复杂,M2 简化:按第一行 cell 顺序 + getBoundingClientRect
    // colspan>1 时仍以单 cell 为 anchor(用户语义"操作该 cell 所在列")
    let visualColIdx = 0;
    cells.forEach((cell) => {
      const cellRect = cell.getBoundingClientRect();
      const left = cellRect.left - tableRect.left;
      const width = cellRect.width;

      const dot = document.createElement('button');
      dot.type = 'button';
      dot.classList.add('krig-table-block__col-dot');
      dot.setAttribute('contenteditable', 'false');
      dot.title = '操作该列';
      // dot 固定 32px 宽,严格居中 cell 水平中点(所有列 dot 长度一致,视觉整齐)
      const DOT_LEN = 32;
      dot.style.left = `${left + width / 2 - DOT_LEN / 2}px`;
      dot.style.width = `${DOT_LEN}px`;
      // 闭包捕获当前 visualColIdx
      const colIdx = visualColIdx;
      dot.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        openMenu(dot, 'column', { colIdx });
      });
      colBar.appendChild(dot);
      visualColIdx += 1;
    });
  }

  // ── 重建行 dots(按当前 tbody.rows,DOM 量取每行 top + height)─────────────

  function rebuildRowDots(): void {
    rowBar.innerHTML = '';
    const rows = Array.from(tbody.querySelectorAll(':scope > tr')) as HTMLElement[];
    if (rows.length === 0) return;

    const tableRect = table.getBoundingClientRect();
    rows.forEach((row, rowIdx) => {
      const rowRect = row.getBoundingClientRect();
      const top = rowRect.top - tableRect.top;
      const height = rowRect.height;

      const dot = document.createElement('button');
      dot.type = 'button';
      dot.classList.add('krig-table-block__row-dot');
      dot.setAttribute('contenteditable', 'false');
      dot.title = '操作该行';
      // dot 固定 32px 高,严格居中 row 垂直中点(所有行 dot 长度一致)
      const DOT_LEN = 32;
      dot.style.top = `${top + height / 2 - DOT_LEN / 2}px`;
      dot.style.height = `${DOT_LEN}px`;
      dot.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        openMenu(dot, 'row', { rowIdx });
      });
      rowBar.appendChild(dot);
    });
  }

  // ── CellSelection handle:监听 view 状态(rAF 防抖)─────────

  let csRafId: number | null = null;
  function updateCellSelectionHandle(): void {
    if (csRafId != null) return;
    csRafId = requestAnimationFrame(() => {
      csRafId = null;
      const sel = view.state.selection;
      if (!(sel instanceof CellSelection)) {
        csHandle.style.display = 'none';
        return;
      }
      // 确认 CellSelection 是本 table 的(检查 anchorCell 在本 table 范围内)
      const tablePos = typeof getPos === 'function' ? getPos() : undefined;
      if (tablePos == null) return;
      const tableNode = view.state.doc.nodeAt(tablePos);
      if (!tableNode) return;
      const inThisTable =
        sel.$anchorCell.pos > tablePos && sel.$anchorCell.pos < tablePos + tableNode.nodeSize;
      if (!inThisTable) {
        csHandle.style.display = 'none';
        return;
      }
      // 算选区 DOM bounding rect(取所有 selectedCell 的并集)
      const cells = Array.from(
        tbody.querySelectorAll('.selectedCell'),
      ) as HTMLElement[];
      if (cells.length === 0) {
        csHandle.style.display = 'none';
        return;
      }
      const tableRect = table.getBoundingClientRect();
      let minLeft = Infinity;
      let minTop = Infinity;
      let maxRight = -Infinity;
      cells.forEach((c) => {
        const r = c.getBoundingClientRect();
        minLeft = Math.min(minLeft, r.left);
        minTop = Math.min(minTop, r.top);
        maxRight = Math.max(maxRight, r.right);
      });
      const centerX = (minLeft + maxRight) / 2 - tableRect.left;
      const topY = minTop - tableRect.top;
      csHandle.style.display = 'flex';
      csHandle.style.left = `${centerX - 12}px`;
      csHandle.style.top = `${topY - 28}px`;
    });
  }

  csHandle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    openMenu(csHandle, 'cellSelection', {});
  });

  // ── 监听 view 状态变化触发器(M2 简易方案:event-driven + rAF)─────
  //
  // 真正的方案是 PluginView dispatch,但 NodeView 没原生订阅 view state 的口子。
  // 用户行为入口:鼠标点 / 拖、键盘按、focus 切换 — 都监听一遍。

  const onUserAction = () => updateCellSelectionHandle();
  view.dom.addEventListener('mouseup', onUserAction);
  view.dom.addEventListener('keyup', onUserAction);
  view.dom.addEventListener('mousedown', onUserAction);

  // ── 初始 / update / destroy ─────────────────────────────

  // 首次 build(NodeViewConstructor 返回后 tbody 才被 PM 填充,延后一帧)
  requestAnimationFrame(() => {
    rebuildColumnDots();
    rebuildRowDots();
    updateCellSelectionHandle();
  });

  return {
    dom,
    contentDOM: tbody,
    update(node) {
      if (node.type.name !== 'table') return false;
      // 行数 / 列数 / colwidth 变化都进这里(PM 会在节点变更时调 update)
      // 延后一帧避免 colgroup 还没 sync,DOM rect 计算误差
      requestAnimationFrame(() => {
        rebuildColumnDots();
        rebuildRowDots();
        updateCellSelectionHandle();
      });
      return true;
    },
    ignoreMutation(mutation) {
      const target = mutation.target as Node;
      // 只允许 tbody 的 mutation 通过到 PM
      if (!tbody.contains(target)) return true;
      return false;
    },
    destroy() {
      if (csRafId != null) cancelAnimationFrame(csRafId);
      view.dom.removeEventListener('mouseup', onUserAction);
      view.dom.removeEventListener('keyup', onUserAction);
      view.dom.removeEventListener('mousedown', onUserAction);
    },
  };
};
