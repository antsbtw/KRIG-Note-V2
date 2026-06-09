/**
 * table NodeView — Notion-style hover handle 版(L5-B3.7.1, M2)
 *
 * M2 职责拆分:
 * - **列 dot**:由 [[decorations.ts]] PM Decoration.widget 注入,锐 cell 内部,
 *   scroll 时自动跟随;NodeView 不管列 dot
 * - **行 dot**:仍由 NodeView wrapper absolute 渲染(待后续阶段一并迁 Decoration)
 * - **CellSelection ⋯ handle**:NodeView wrapper absolute,监听 view dispatch
 *   动态显隐(待后续阶段迁 Decoration)
 *
 * 关键设计:
 * - 非装饰 DOM 全在 contentDOM(tbody)外层,ignoreMutation 守门只允 tbody 通过
 *   → PM 不 react,prosemirror-tables 内部状态不受干扰
 * - 行 dot 几何来源:DOM 量(每行 tr getBoundingClientRect),随行数变化 update()
 *   回调重算
 * - CellSelection handle 监听 view.dom 的 mouseup/keyup/mousedown + rAF 防抖
 *
 * 菜单点击链(行 / cellSelection):
 *   handle dot mousedown
 *     → setTableMenuContext({ instanceId, tablePos, scope, rowIdx?/colIdx? })
 *     → popupController.show('text-editing.popup.table-menu', dotEl)
 *
 * 列 dot 点击链:同上(decorations.ts createColDot 内)
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

  // ── 列 handle bar(挂外层 dom — 不被 scroll overflow 裁掉)─────
  // 视图(cell)与操作(bar)解耦:bar 不是 cell 子元素,也不在 scroll 容器内
  // (scroll overflow-x:auto 强制纵向也裁,会切掉凸出 table 顶那一半 bar)。
  // 横向滚动同步走 transform translateX(-scrollLeft)+ overflow:hidden 让 bar
  // 超出 scroll 边界时也被裁(跟 table 视觉一致)

  const colBar = document.createElement('div');
  colBar.classList.add('krig-table-block__col-bar');
  colBar.setAttribute('contenteditable', 'false');
  dom.appendChild(colBar);

  // ── 行 handle bar(行不滚动,挂外层 dom 即可)─────────────

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

  // ── 重建列 dots(挂外层 dom,独立于 cell + scroll)─────
  //
  // 几何:colBar 是外层 dom absolute 子元素(dom position:relative)。
  // dot.left 算 cell 中心相对 scroll content(含 scroll.scrollLeft 偏移)→
  // colBar 自身 transform translateX(-scrollLeft) 跟随横向 scroll 同步。
  // 这样 bar 视觉上跟 cell 完全锐定,且不被 scroll overflow 裁掉凸出部分。

  function rebuildColumnDots(): void {
    colBar.innerHTML = '';
    const firstRow = tbody.querySelector(':scope > tr');
    if (!firstRow) return;
    const cells = Array.from(firstRow.children) as HTMLElement[];
    if (cells.length === 0) return;

    const blockRect = dom.getBoundingClientRect();
    const tableRect = table.getBoundingClientRect();
    // table 顶 border 相对 dom 顶的偏移(scroll 容器在 dom 内,table 在 scroll 内)
    const tableTopOffset = tableRect.top - blockRect.top;
    const BAR_THICKNESS = 6;
    const DOT_LEN = 32;

    cells.forEach((cell, colIdx) => {
      const cellRect = cell.getBoundingClientRect();
      // cell 中心 X 在 scroll content 坐标系(scrollLeft 抵消由 colBar transform 处理)
      const cellCenterX = cellRect.left + cellRect.width / 2 - blockRect.left + scroll.scrollLeft;

      const dot = document.createElement('button');
      dot.type = 'button';
      dot.classList.add('krig-table-block__col-dot');
      dot.setAttribute('contenteditable', 'false');
      dot.title = '操作该列';
      dot.style.left = `${cellCenterX - DOT_LEN / 2}px`;
      dot.style.width = `${DOT_LEN}px`;
      dot.style.top = `${tableTopOffset + 0.5 - BAR_THICKNESS / 2}px`;
      dot.style.height = `${BAR_THICKNESS}px`;
      dot.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        openMenu(dot, 'column', { colIdx });
      });
      colBar.appendChild(dot);
    });

    syncBarsToScroll();
  }

  // colBar / rowBar 整体 translateX 抵消 scrollLeft,dot 视觉跟随 cell 移动
  function syncBarsToScroll(): void {
    const transform = `translateX(${-scroll.scrollLeft}px)`;
    colBar.style.transform = transform;
    rowBar.style.transform = transform;
  }

  // scroll 监听:rAF 节流避免高频抖动
  let scrollRafId: number | null = null;
  const onScroll = () => {
    if (scrollRafId != null) return;
    scrollRafId = requestAnimationFrame(() => {
      scrollRafId = null;
      syncBarsToScroll();
    });
  };
  scroll.addEventListener('scroll', onScroll, { passive: true });

  // ── 重建行 dots(放 table 左沿 border,挂外层 dom — 跟 colBar 同源)─────────────

  function rebuildRowDots(): void {
    rowBar.innerHTML = '';
    const rows = Array.from(tbody.querySelectorAll(':scope > tr')) as HTMLElement[];
    if (rows.length === 0) return;

    const tableRect = table.getBoundingClientRect();
    const blockRect = dom.getBoundingClientRect();
    // 行 bar 放 table 左沿 border 中线上(用户拍板:M2 行 dot 在左)
    // 跟左侧 block-handle (+/⠿) 共占同一 gutter,但 hover 时机不同,实际不冲突
    // table 左沿在 scroll content 坐标系 = tableRect.left - blockRect.left + scrollLeft
    // (跟 colBar dot.left 同源算法,scroll 时 transform 抵消)
    const tableLeftOffset = tableRect.left - blockRect.left + scroll.scrollLeft;
    const BAR_THICKNESS = 6;
    const DOT_LEN = 32;

    rows.forEach((row, rowIdx) => {
      const rowRect = row.getBoundingClientRect();
      const top = rowRect.top - blockRect.top;
      const height = rowRect.height;

      const dot = document.createElement('button');
      dot.type = 'button';
      dot.classList.add('krig-table-block__row-dot');
      dot.setAttribute('contenteditable', 'false');
      dot.title = '操作该行';
      // dot 中线落在 table 左 border 中线(左 border 在 tableLeftOffset ~ tableLeftOffset + 1)
      dot.style.left = `${tableLeftOffset + 0.5 - BAR_THICKNESS / 2}px`;
      dot.style.width = `${BAR_THICKNESS}px`;
      dot.style.top = `${top + height / 2 - DOT_LEN / 2}px`;
      dot.style.height = `${DOT_LEN}px`;
      dot.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        openMenu(dot, 'row', { rowIdx });
      });
      rowBar.appendChild(dot);
    });

    syncBarsToScroll();
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

  // ── 导入 table 首次挂载:无 colwidth → 按 view 可用宽均分各列 ──────
  //
  // 需求(2026-06-09):导入的 table 默认总宽对齐编辑区宽度,而非按内容收缩留白
  // (本地新建 table 走 commands 补 colwidth=[120];导入的 cell 无 colwidth →
  // table-layout:fixed 下塌到 min-width:80px/列 → 窄表 + 右侧大片留白)。
  // 列宽依赖真实 view 宽度,故放在编辑器挂载时算(此刻 scroll.clientWidth 已知),
  // 均分写回各 cell.colwidth。用户随后拖动列宽即覆盖,本逻辑只跑一次(写后即有 colwidth)。
  //
  // 仅当**所有 cell 都无 colwidth**(纯导入态)才动 —— 避免覆盖用户调整 / round-trip 宽度。
  // ── colgroup 同步 ───────────────────────────────────────
  //
  // 根因(2026-06-09 定位):本 table 用自定义 NodeView,覆盖了 prosemirror-tables 自带
  // TableView,于是库内置的「colwidth attr → <colgroup><col width> 同步」没生效 —— 手动建的
  // colgroup 一直是空的。table-layout:fixed + 空 colgroup → 列宽只认 cell toDOM 里的
  // inline width,而 setNodeMarkup 改 colwidth attr 后 PM 不重渲已有 cell DOM → 改了不显示。
  // 故 node-view 自己按 cell.colwidth 重建 <col>(对齐 prosemirror-tables updateColumns 语义)。
  const syncColgroup = (): void => {
    const pos = typeof getPos === 'function' ? getPos() : undefined;
    if (pos == null) return;
    const tableNode = view.state.doc.nodeAt(pos);
    if (!tableNode || tableNode.type.name !== 'table') return;
    const firstRow = tableNode.firstChild;
    if (!firstRow) return;

    // 按首行各 cell 的 colspan + colwidth 展开成「每列一个宽度」
    const widths: (number | null)[] = [];
    firstRow.forEach((cell) => {
      const span = (cell.attrs.colspan as number) || 1;
      const cw = cell.attrs.colwidth as number[] | null;
      for (let i = 0; i < span; i++) {
        widths.push(cw && cw[i] != null ? cw[i] : null);
      }
    });

    // 重建 <col>(数量/宽度变了才动 — 避免每帧 churn)
    const existing = colgroup.children;
    const sameCount = existing.length === widths.length;
    let same = sameCount;
    if (sameCount) {
      for (let i = 0; i < widths.length; i++) {
        const want = widths[i] != null ? `${widths[i]}px` : '';
        if ((existing[i] as HTMLElement).style.width !== want) { same = false; break; }
      }
    }
    if (same) return;

    colgroup.replaceChildren();
    for (const w of widths) {
      const col = document.createElement('col');
      if (w != null) col.style.width = `${w}px`;
      colgroup.appendChild(col);
    }
  };

  let fillWidthDone = false;
  const fillWidthIfImported = (): void => {
    if (fillWidthDone) return;
    const pos = typeof getPos === 'function' ? getPos() : undefined;
    if (pos == null) return;
    const tableNode = view.state.doc.nodeAt(pos);
    if (!tableNode || tableNode.type.name !== 'table') return;

    // 扫全表:任一 cell 已有 colwidth → 非纯导入态,跳过(不覆盖)
    let anyColwidth = false;
    let colCount = 0;
    tableNode.forEach((row) => {
      let rowCols = 0;
      row.forEach((cell) => {
        rowCols += (cell.attrs.colspan as number) || 1;
        if (Array.isArray(cell.attrs.colwidth) && cell.attrs.colwidth.some((w) => w != null)) {
          anyColwidth = true;
        }
      });
      colCount = Math.max(colCount, rowCols);
    });
    if (anyColwidth || colCount === 0) {
      fillWidthDone = true;
      return;
    }

    // 可用宽 = scroll 容器内宽(= 编辑区正文宽);量不到则跳过等下一帧
    const availWidth = scroll.clientWidth;
    if (availWidth <= 0) return;

    const MIN_COL = 48;
    const per = Math.max(MIN_COL, Math.floor(availWidth / colCount));

    // 逐 cell 写 colwidth=[per]*colspan(colspan>1 的合并单元格按比例占多列宽)
    let tr = view.state.tr;
    const base = pos + 1; // table 内偏移
    let changed = false;
    tableNode.forEach((row, rowOffset) => {
      row.forEach((cell, cellOffset) => {
        const span = (cell.attrs.colspan as number) || 1;
        const cellPos = base + rowOffset + 1 + cellOffset;
        tr = tr.setNodeMarkup(cellPos, undefined, {
          ...cell.attrs,
          colwidth: new Array(span).fill(per),
        });
        changed = true;
      });
    });
    if (!changed) {
      fillWidthDone = true;
      return;
    }

    // 与 auto-block-id-plugin 同款防御(decision 026 §12.2):
    // colwidth 注入是结构性 noise — 不进 undo 栈,且 Host onChange 见 skipOnChange 不发 IPC。
    tr = tr.setMeta('addToHistory', false);
    tr = tr.setMeta('skipOnChange', true);
    view.dispatch(tr);
    syncColgroup(); // 立刻把新 colwidth 同步到 <colgroup>(不等 update RAF)
    fillWidthDone = true;
  };

  // ── 初始 / update / destroy ─────────────────────────────

  // 首次 build(NodeViewConstructor 返回后 tbody 才被 PM 填充,延后一帧)
  requestAnimationFrame(() => {
    fillWidthIfImported();
    syncColgroup();
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
        // 挂载时若编辑区宽度为 0(隐藏 tab 等)fillWidth 会跳过且不置 done,
        // 此处再试一次(已 done / 已有 colwidth 都会内部短路,幂等无害)
        fillWidthIfImported();
        // colwidth 变化(fillWidth 写入 / 用户拖拽 columnResizing)同步到 colgroup
        syncColgroup();
        rebuildColumnDots();
        rebuildRowDots();
        updateCellSelectionHandle();
      });
      return true;
    },
    ignoreMutation(mutation) {
      const target = mutation.target as Node;
      // tbody 外的 mutation(colgroup / handle bar 等)不通过
      if (!tbody.contains(target)) return true;
      // tbody 内但落在我们自己加的装饰 dot(data-krig-decoration)上的 mutation 不通过
      // — 我们 append col-dot 到 cell 内,PM 不该把 dot 当 cell 子内容
      if (target instanceof Element) {
        if (target.closest('[data-krig-decoration]')) return true;
      } else if (target.parentElement?.closest('[data-krig-decoration]')) {
        return true;
      }
      return false;
    },
    destroy() {
      if (csRafId != null) cancelAnimationFrame(csRafId);
      if (scrollRafId != null) cancelAnimationFrame(scrollRafId);
      scroll.removeEventListener('scroll', onScroll);
      view.dom.removeEventListener('mouseup', onUserAction);
      view.dom.removeEventListener('keyup', onUserAction);
      view.dom.removeEventListener('mousedown', onUserAction);
    },
  };
};
