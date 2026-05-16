/**
 * TableMenuPanel — table hover handle 弹出的菜单(L5-B3.7.1, M2)
 *
 * 三种作用域,内容由 [[menu-context]] 决定:
 * - 'column' — 列 handle 触发:增/删/复制此列 + 对齐 + 删表
 * - 'row'    — 行 handle 触发:增/删/复制此行 + 删表
 * - 'cellSelection' — CellSelection handle 触发:合并/拆分/复制选区/对齐/删除内容 + 删表
 *
 * Panel 自己管 menu items 内容 + onClick → PM 命令分发,
 * 视觉风格沿用 V2 [[ContextMenuPopover]] 的 dark popover 样式(同源式样)。
 *
 * 调用链:node-view handle click
 *   → setTableMenuContext({ instanceId, tablePos, scope, rowIdx?/colIdx? })
 *   → popupController.show('text-editing.popup.table-menu', anchorBtn)
 *   → PopupBinding 渲染 TableMenuPanel
 *   → item click → 调命令 → onClose() → clearTableMenuContext()
 */

import { useEffect, type CSSProperties } from 'react';
import { TextSelection, type Command } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { CellSelection } from 'prosemirror-tables';
import type { PopupCloseProps } from '@slot/interaction-registries/popup-registry/popup-types';
import { instanceRegistry } from '../../instance-registry';
import {
  addColumnBefore,
  addColumnAfter,
  deleteColumn,
  addRowBefore,
  addRowAfter,
  deleteRow,
  deleteTable,
  mergeCells,
  splitCell,
  duplicateRow,
  duplicateColumn,
  duplicateSelectedCells,
  setCellAlign,
} from './commands';
import type { CellAlign } from './spec';
import { getTableMenuContext, clearTableMenuContext, type TableMenuContext } from './menu-context';

// ── 样式(对齐 V2 ContextMenuPopover dark theme,但本 panel 是 PopupBinding 子内容,
//      不需要 fixed 定位 — PopupBinding 已包了一层 .krig-popup)──

const styles: Record<string, CSSProperties> = {
  panel: {
    background: 'rgba(30,30,30,0.98)',
    border: '1px solid #444',
    borderRadius: 4,
    boxShadow: '0 4px 14px rgba(0,0,0,0.5)',
    padding: '4px 0',
    minWidth: 180,
    fontSize: 12,
    color: '#ccc',
  },
  item: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '6px 12px',
    cursor: 'pointer',
    userSelect: 'none',
  },
  itemDanger: {
    color: '#e57373',
  },
  separator: {
    height: 1,
    background: '#444',
    margin: '4px 0',
  },
  submenuLabel: {
    padding: '6px 12px 2px 12px',
    fontSize: 10,
    color: '#666',
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
  },
};

interface MenuItem {
  id: string;
  label: string;
  icon?: string;
  danger?: boolean;
  onClick: () => void;
}

interface SeparatorItem {
  id: string;
  separator: true;
}

interface SubmenuLabelItem {
  id: string;
  submenuLabel: string;
}

type Entry = MenuItem | SeparatorItem | SubmenuLabelItem;

function isSeparator(e: Entry): e is SeparatorItem {
  return 'separator' in e;
}
function isSubmenuLabel(e: Entry): e is SubmenuLabelItem {
  return 'submenuLabel' in e;
}

// ── 工具:把光标定位到目标 row/col 的某个 cell 内,然后调 command ──

/**
 * 把 PM 光标移到 (rowIdx, colIdx) cell 内,再 dispatch command。
 *
 * 原因:PM tables 内置 deleteRow/deleteColumn/addRowAfter/... 都基于
 * 当前 selection 决定操作哪一行/列(rect = selectedRect(state))。
 * 我们的 handle 知道用户点的是哪行/列,所以先 setSelection 再调命令。
 */
function dispatchAtCell(
  view: EditorView,
  tablePos: number,
  rowIdx: number,
  colIdx: number,
  command: Command,
): void {
  const tableNode = view.state.doc.nodeAt(tablePos);
  if (!tableNode || tableNode.type.name !== 'table') return;
  if (rowIdx >= tableNode.childCount) return;
  const row = tableNode.child(rowIdx);
  if (colIdx >= row.childCount) return;

  // tablePos+1 进 table,逐行 nodeSize 累加到 rowIdx,+1 进 row,逐 cell 累加到 colIdx,+1 进 cell
  let p = tablePos + 1;
  for (let r = 0; r < rowIdx; r++) p += tableNode.child(r).nodeSize;
  p += 1;
  for (let c = 0; c < colIdx; c++) p += row.child(c).nodeSize;
  p += 1;

  try {
    const tr = view.state.tr.setSelection(TextSelection.create(view.state.doc, p));
    view.dispatch(tr);
  } catch {
    return;
  }
  command(view.state, view.dispatch);
  view.focus();
}

// ── 工具:对 CellSelection 直接 dispatch command(保留选区上下文)──

function dispatchAtCellSelection(view: EditorView, command: Command): void {
  if (!(view.state.selection instanceof CellSelection)) return;
  command(view.state, view.dispatch);
  view.focus();
}

// ── 按 scope 构造菜单项 ──

function buildColumnEntries(view: EditorView, ctx: TableMenuContext, close: () => void): Entry[] {
  const { tablePos, colIdx = 0 } = ctx;
  const at = (cmd: Command) => () => {
    dispatchAtCell(view, tablePos, 0, colIdx, cmd);
    close();
  };
  const align = (a: CellAlign | null) => () => {
    // 选中整列 → setCellAlign 走 CellSelection 路径才能作用整列;否则只改单 cell
    // 简化:先 setSelection 到 colIdx 第一个 cell,然后调 setCellAlign(a)(单 cell)
    // 整列对齐留 cellSelection scope 处理,column scope 内只改顶部 cell 的对齐
    // (用户期望:从列 handle 改"这一列"对齐 → 需要 CellSelection 整列)
    // 走 CellSelection 方案:构造 anchor=col 顶,head=col 底
    const tableNode = view.state.doc.nodeAt(tablePos);
    if (!tableNode || tableNode.type.name !== 'table') {
      close();
      return;
    }
    // 计算 col 顶 cell 和 col 底 cell 的 pos
    const findCellPos = (rowIdx: number): number | null => {
      if (rowIdx >= tableNode.childCount) return null;
      const row = tableNode.child(rowIdx);
      if (colIdx >= row.childCount) return null;
      let p = tablePos + 1;
      for (let r = 0; r < rowIdx; r++) p += tableNode.child(r).nodeSize;
      p += 1; // 进 row
      for (let c = 0; c < colIdx; c++) p += row.child(c).nodeSize;
      return p; // cell start pos
    };
    const anchorPos = findCellPos(0);
    const headPos = findCellPos(tableNode.childCount - 1);
    if (anchorPos == null || headPos == null) {
      close();
      return;
    }
    try {
      const $anchor = view.state.doc.resolve(anchorPos);
      const $head = view.state.doc.resolve(headPos);
      const cellSel = new CellSelection($anchor, $head);
      const tr = view.state.tr.setSelection(cellSel);
      view.dispatch(tr);
    } catch {
      close();
      return;
    }
    setCellAlign(a)(view.state, view.dispatch);
    view.focus();
    close();
  };

  return [
    { id: 'col-add-before', icon: '←', label: '在左侧插入列', onClick: at(addColumnBefore) },
    { id: 'col-add-after',  icon: '→', label: '在右侧插入列', onClick: at(addColumnAfter) },
    { id: 'col-duplicate',  icon: '⧉', label: '复制此列',     onClick: at(duplicateColumn) },
    { id: 'sep1', separator: true },
    { id: 'col-align-label', submenuLabel: '对齐' },
    { id: 'col-align-left',   icon: '⬅', label: '左对齐', onClick: align('left') },
    { id: 'col-align-center', icon: '↔', label: '居中',   onClick: align('center') },
    { id: 'col-align-right',  icon: '➡', label: '右对齐', onClick: align('right') },
    { id: 'sep2', separator: true },
    { id: 'col-delete',   icon: '🗑', label: '删除此列',     danger: true, onClick: at(deleteColumn) },
    { id: 'table-delete', icon: '✖',  label: '删除整张表', danger: true, onClick: at(deleteTable) },
  ];
}

function buildRowEntries(view: EditorView, ctx: TableMenuContext, close: () => void): Entry[] {
  const { tablePos, rowIdx = 0 } = ctx;
  const at = (cmd: Command) => () => {
    dispatchAtCell(view, tablePos, rowIdx, 0, cmd);
    close();
  };
  return [
    { id: 'row-add-before', icon: '↑', label: '在上方插入行', onClick: at(addRowBefore) },
    { id: 'row-add-after',  icon: '↓', label: '在下方插入行', onClick: at(addRowAfter) },
    { id: 'row-duplicate',  icon: '⧉', label: '复制此行',     onClick: at(duplicateRow) },
    { id: 'sep1', separator: true },
    { id: 'row-delete',   icon: '🗑', label: '删除此行',     danger: true, onClick: at(deleteRow) },
    { id: 'table-delete', icon: '✖',  label: '删除整张表', danger: true, onClick: at(deleteTable) },
  ];
}

function buildCellSelectionEntries(view: EditorView, close: () => void): Entry[] {
  const run = (cmd: Command) => () => {
    dispatchAtCellSelection(view, cmd);
    close();
  };
  const align = (a: CellAlign | null) => () => {
    dispatchAtCellSelection(view, setCellAlign(a));
    close();
  };
  return [
    { id: 'cs-merge', icon: '⊞', label: '合并单元格', onClick: run(mergeCells) },
    { id: 'cs-split', icon: '⊟', label: '拆分单元格', onClick: run(splitCell) },
    { id: 'cs-dup',   icon: '⧉', label: '复制选区为新行', onClick: run(duplicateSelectedCells) },
    { id: 'sep1', separator: true },
    { id: 'cs-align-label', submenuLabel: '对齐' },
    { id: 'cs-align-left',   icon: '⬅', label: '左对齐', onClick: align('left') },
    { id: 'cs-align-center', icon: '↔', label: '居中',   onClick: align('center') },
    { id: 'cs-align-right',  icon: '➡', label: '右对齐', onClick: align('right') },
    { id: 'sep2', separator: true },
    { id: 'table-delete', icon: '✖', label: '删除整张表', danger: true, onClick: run(deleteTable) },
  ];
}

// ── 渲染 ─────────────────────────────────────────────────────

export function TableMenuPanel({ onClose }: PopupCloseProps) {
  // panel unmount 时清 context,防止下次 popup 残留上下文
  useEffect(() => {
    return () => clearTableMenuContext();
  }, []);

  const ctx = getTableMenuContext();
  if (!ctx) return null;

  const inst = instanceRegistry.get(ctx.instanceId);
  if (!inst) return null;
  const view = inst.view;

  const entries: Entry[] = (() => {
    switch (ctx.scope) {
      case 'column':        return buildColumnEntries(view, ctx, onClose);
      case 'row':           return buildRowEntries(view, ctx, onClose);
      case 'cellSelection': return buildCellSelectionEntries(view, onClose);
      default:              return [];
    }
  })();

  return (
    <div style={styles.panel} onClick={(e) => e.stopPropagation()}>
      {entries.map((e) => {
        if (isSeparator(e)) {
          return <div key={e.id} style={styles.separator} />;
        }
        if (isSubmenuLabel(e)) {
          return (
            <div key={e.id} style={styles.submenuLabel}>
              {e.submenuLabel}
            </div>
          );
        }
        const itemStyle = {
          ...styles.item,
          ...(e.danger ? styles.itemDanger : {}),
        };
        return (
          <div
            key={e.id}
            style={itemStyle}
            onClick={e.onClick}
            onMouseEnter={(ev) => {
              (ev.currentTarget as HTMLDivElement).style.background = '#3a3a3a';
            }}
            onMouseLeave={(ev) => {
              (ev.currentTarget as HTMLDivElement).style.background = 'transparent';
            }}
          >
            {e.icon && <span style={{ width: 16, display: 'inline-block' }}>{e.icon}</span>}
            <span>{e.label}</span>
          </div>
        );
      })}
    </div>
  );
}
