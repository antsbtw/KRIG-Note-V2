/**
 * table NodeView — 简版(L5-B3.7,B+ 路线)
 *
 * V1 → V2 直迁的简化版本:
 * - ✅ contentDOM = <table><tbody>(PM 接管,prosemirror-tables 自动管理 cell)
 * - ✅ 外层 .krig-table-block__scroll wrapper(防超宽溢出)
 * - ✅ +col / +row 按钮(右侧 / 底部,简单按钮 — 调 prosemirror-tables addColumnAfter / addRowAfter)
 * - ✅ colwidth resize:走库的 columnResizing() 插件(已在 spec.ts plugin 注册)
 *
 * **砍**(留 sub-stage L5-B3.7.1):
 * - hover 列/行指示器条 + 自建 DOM 菜单(~250 行 V1 代码)
 * - 用户操作列/行通过:右键菜单(后续接 V2 context-menu registry)+ Tab 导航(自带)
 *
 * 关键参考:V1 view.ts 提供完整版,B+ 这里只取核心
 */

import type { NodeViewConstructor } from 'prosemirror-view';
import { TextSelection } from 'prosemirror-state';
import { addColumnAfter, addRowAfter } from 'prosemirror-tables';

export const tableNodeView: NodeViewConstructor = (initialNode, view, getPos) => {
  // 外层 wrapper(给 +col/+row 按钮做绝对定位 anchor)
  const dom = document.createElement('div');
  dom.classList.add('krig-table-block');

  const scroll = document.createElement('div');
  scroll.classList.add('krig-table-block__scroll');
  dom.appendChild(scroll);

  // table > tbody = contentDOM(PM 接管)
  const table = document.createElement('table');
  table.classList.add('krig-pm-table');
  // colgroup 由 prosemirror-tables columnResizing 插件管理(updateColumnsOnResize)
  const colgroup = document.createElement('colgroup');
  table.appendChild(colgroup);
  const tbody = document.createElement('tbody');
  table.appendChild(tbody);
  scroll.appendChild(table);

  // ── +col 按钮(右侧)──
  const addColBtn = document.createElement('button');
  addColBtn.type = 'button';
  addColBtn.classList.add('krig-table-block__add-col-btn');
  addColBtn.setAttribute('contenteditable', 'false');
  addColBtn.title = '添加列';
  addColBtn.textContent = '+';
  addColBtn.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    // 把光标移到表格最后一列任意 cell,然后调 addColumnAfter
    // 简化:直接调 addColumnAfter 库命令,它会基于当前 selection 加列
    // 如果 selection 不在 table 内,先把光标放进末 cell
    const pos = typeof getPos === 'function' ? getPos() : undefined;
    if (pos == null) return;
    const tableNode = view.state.doc.nodeAt(pos);
    if (!tableNode || tableNode.type.name !== 'table') return;

    // 找最后一行最后一个 cell 的位置作为光标落点
    const lastRow = tableNode.lastChild;
    if (!lastRow) return;
    const lastCell = lastRow.lastChild;
    if (!lastCell) return;

    // 计算 cell 内任意位置:tablePos+1 进 table,逐行 nodeSize 累加到最后一行,+1 进 row,逐 cell 累加到最后一 cell,+1 进 cell
    let p = pos + 1; // 进 table
    for (let r = 0; r < tableNode.childCount - 1; r++) {
      p += tableNode.child(r).nodeSize;
    }
    p += 1; // 进最后一行
    for (let c = 0; c < lastRow.childCount - 1; c++) {
      p += lastRow.child(c).nodeSize;
    }
    p += 1; // 进最后一 cell

    try {
      const tr = view.state.tr.setSelection(TextSelection.create(view.state.doc, p));
      view.dispatch(tr);
      addColumnAfter(view.state, view.dispatch);
      view.focus();
    } catch {
      /* ignore */
    }
  });
  dom.appendChild(addColBtn);

  // ── +row 按钮(底部)──
  const addRowBtn = document.createElement('button');
  addRowBtn.type = 'button';
  addRowBtn.classList.add('krig-table-block__add-row-btn');
  addRowBtn.setAttribute('contenteditable', 'false');
  addRowBtn.title = '添加行';
  addRowBtn.textContent = '+';
  addRowBtn.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    // 同上:光标移到末行任意 cell,调 addRowAfter
    const pos = typeof getPos === 'function' ? getPos() : undefined;
    if (pos == null) return;
    const tableNode = view.state.doc.nodeAt(pos);
    if (!tableNode || tableNode.type.name !== 'table') return;

    const lastRow = tableNode.lastChild;
    if (!lastRow) return;
    const lastCell = lastRow.lastChild;
    if (!lastCell) return;

    let p = pos + 1;
    for (let r = 0; r < tableNode.childCount - 1; r++) {
      p += tableNode.child(r).nodeSize;
    }
    p += 1;
    for (let c = 0; c < lastRow.childCount - 1; c++) {
      p += lastRow.child(c).nodeSize;
    }
    p += 1;

    try {
      const tr = view.state.tr.setSelection(TextSelection.create(view.state.doc, p));
      view.dispatch(tr);
      addRowAfter(view.state, view.dispatch);
      view.focus();
    } catch {
      /* ignore */
    }
  });
  dom.appendChild(addRowBtn);

  return {
    dom,
    contentDOM: tbody,
    ignoreMutation(mutation) {
      // 只允许 contentDOM(tbody)的 mutation 通过到 PM
      // colgroup / 按钮 / wrapper 的 DOM 变化(库的 columnResizing 在 colgroup 上写
      // attribute / size 等)PM 不该 react
      const target = mutation.target as Node;
      if (!tbody.contains(target)) return true;
      return false;
    },
  };
};
