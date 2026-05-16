/**
 * table NodeView — Notion-style hover handle 版(L5-B3.7.1, M2)
 *
 * M1 → M2 变更:
 * - **移除** +col / +row 按钮(M1 末尾插入快捷)
 * - **新增** 列 handle bar(table 上沿):每列对应一个 ⋮⋮ dot,默认透明,
 *   鼠标进入某 cell → 该 cell 所在列的 dot 浮现(is-active)
 * - **新增** 行 handle bar(table 左沿):同上,纵向 ⋮⋮ dot,跟随当前 hover 的行
 * - **新增** CellSelection handle(检测到 CellSelection 时浮在选区上方;点击弹菜单)
 *
 * UX 对标 Notion:
 * - 不在 table 内时,**所有 handle 不可见**
 * - 鼠标进入某 cell → 仅该 cell 所在列 / 行的 handle 浮现(高亮 .is-active)
 * - 鼠标离开 table → 所有 handle 隐藏
 * - 点击 handle → 弹菜单
 *
 * 关键设计:
 * - handle DOM 全在 contentDOM(tbody)外层,ignoreMutation 已只允 tbody 通过
 *   → PM 不 react,prosemirror-tables 内部状态不受干扰
 * - 列 / 行 dot 几何来源:DOM 量(table 的第一行 cell / tbody 的 tr getBoundingClientRect),
 *   随 colwidth resize / 行数变化 update() 回调时重算
 * - "当前列 / 行"高亮:监听 dom 的 mousemove(target.closest('td,th'))→ index
 * - CellSelection handle:订阅 view 状态变化(NodeView 无原生订阅口,
 *   监听 view.dom 的 mouseup/keyup/mousedown + rAF 防抖)
 */

import type { NodeViewConstructor } from 'prosemirror-view';
import { CellSelection } from 'prosemirror-tables';
import { popupController } from '@slot/triggers/popup-controller';
import { setTableMenuContext } from './menu-context';

const POPUP_ID = 'text-editing.popup.table-menu';
const HANDLE_ICON = '⋮⋮';

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

  // ── 工具:开 popup(共用所有 handle)─────────────

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

  // ── dot 容器(按 idx 索引,setActive 用)─────────────

  let colDots: HTMLButtonElement[] = [];
  let rowDots: HTMLButtonElement[] = [];

  function setActiveCol(idx: number | null): void {
    colDots.forEach((dot, i) => {
      dot.classList.toggle('is-active', i === idx);
    });
  }

  function setActiveRow(idx: number | null): void {
    rowDots.forEach((dot, i) => {
      dot.classList.toggle('is-active', i === idx);
    });
  }

  // ── 重建列 dots ─────────────────────────────────────────

  function rebuildColumnDots(): void {
    colBar.innerHTML = '';
    colDots = [];
    const firstRow = tbody.querySelector('tr');
    if (!firstRow) return;
    const cells = Array.from(firstRow.children) as HTMLElement[];
    if (cells.length === 0) return;

    const tableRect = table.getBoundingClientRect();
    cells.forEach((cell, visualColIdx) => {
      const cellRect = cell.getBoundingClientRect();
      const left = cellRect.left - tableRect.left;
      const width = cellRect.width;

      const dot = document.createElement('button');
      dot.type = 'button';
      dot.classList.add('krig-table-block__col-dot');
      dot.setAttribute('contenteditable', 'false');
      dot.title = '操作该列';
      dot.textContent = HANDLE_ICON;
      // 横条覆盖单列宽 80%,居中
      const dotWidth = Math.max(28, width * 0.5);
      dot.style.left = `${left + width / 2 - dotWidth / 2}px`;
      dot.style.width = `${dotWidth}px`;
      const colIdx = visualColIdx;
      dot.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        openMenu(dot, 'column', { colIdx });
      });
      colBar.appendChild(dot);
      colDots.push(dot);
    });
  }

  // ── 重建行 dots ─────────────────────────────────────────

  function rebuildRowDots(): void {
    rowBar.innerHTML = '';
    rowDots = [];
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
      dot.textContent = HANDLE_ICON;
      // 纵条覆盖行高 50%,居中
      const dotHeight = Math.max(28, height * 0.5);
      dot.style.top = `${top + height / 2 - dotHeight / 2}px`;
      dot.style.height = `${dotHeight}px`;
      dot.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        openMenu(dot, 'row', { rowIdx });
      });
      rowBar.appendChild(dot);
      rowDots.push(dot);
    });
  }

  // ── Notion-style 当前 cell hover 高亮 ─────────────

  function updateActiveByCell(target: EventTarget | null): void {
    if (!(target instanceof Element)) {
      setActiveCol(null);
      setActiveRow(null);
      return;
    }
    const cell = target.closest('td, th') as HTMLElement | null;
    if (!cell || !tbody.contains(cell)) {
      setActiveCol(null);
      setActiveRow(null);
      return;
    }
    const row = cell.parentElement as HTMLElement | null;
    if (!row) {
      setActiveCol(null);
      setActiveRow(null);
      return;
    }
    const colIdx = Array.from(row.children).indexOf(cell);
    const rowIdx = Array.from(tbody.children).indexOf(row);
    setActiveCol(colIdx >= 0 ? colIdx : null);
    setActiveRow(rowIdx >= 0 ? rowIdx : null);
  }

  const onMouseMove = (e: MouseEvent) => {
    updateActiveByCell(e.target);
  };
  const onMouseLeave = () => {
    setActiveCol(null);
    setActiveRow(null);
  };

  // 在 wrapper (dom) 上监听 — dot 自身在 wrapper 内,hover dot 时也会 mouseleave tbody
  // 走 wrapper 而非 tbody 让 dot 浮起后鼠标移到 dot 上不会丢 active
  dom.addEventListener('mousemove', onMouseMove);
  dom.addEventListener('mouseleave', onMouseLeave);

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

  // ── view 状态监听(CellSelection handle 用)─────

  const onUserAction = () => updateCellSelectionHandle();
  view.dom.addEventListener('mouseup', onUserAction);
  view.dom.addEventListener('keyup', onUserAction);
  view.dom.addEventListener('mousedown', onUserAction);

  // ── 初始 / update / destroy ─────────────────────────────

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
      requestAnimationFrame(() => {
        rebuildColumnDots();
        rebuildRowDots();
        updateCellSelectionHandle();
      });
      return true;
    },
    ignoreMutation(mutation) {
      const target = mutation.target as Node;
      if (!tbody.contains(target)) return true;
      return false;
    },
    destroy() {
      if (csRafId != null) cancelAnimationFrame(csRafId);
      dom.removeEventListener('mousemove', onMouseMove);
      dom.removeEventListener('mouseleave', onMouseLeave);
      view.dom.removeEventListener('mouseup', onUserAction);
      view.dom.removeEventListener('keyup', onUserAction);
      view.dom.removeEventListener('mousedown', onUserAction);
    },
  };
};
