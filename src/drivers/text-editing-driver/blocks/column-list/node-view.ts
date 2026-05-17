/**
 * columnList + column NodeView — 直迁 V1 src/plugins/note/blocks/column-list.ts
 *
 * V2 适配:
 * - 类名加 krig- 前缀(与 callout/table 一致)
 * - V1 schema.nodes.textBlock → V2 schema.nodes.paragraph
 * - NodeViewFactory 类型从 V2 types(prosemirror-view NodeViewConstructor)
 *
 * 功能(与 V1 字面对齐):
 * - hover toolbar: + / − / 垂直对齐三按钮(2-3 列切换 + verticalAlign 循环)
 * - 列间 resize handle: 拖动调宽,最小 MIN_COL_PCT=20%
 * - column.attrs.width 默认 null(等宽 flex:1),拖过后写比例(round 0.1)
 * - 加/减列时所有 width 重置为 null(等宽)
 *
 * 守门:
 * - ignoreMutation + stopEvent 双守 toolbar / handleContainer(避 PM 接管 DOM)
 * - destroy 清 mousemove/mouseup 全局监听 + body cursor/userSelect 还原
 */

import type { NodeViewConstructor, ViewMutationRecord } from 'prosemirror-view';
import type { Node as PMNode } from 'prosemirror-model';

const MIN_COL_PCT = 20;
const GAP = 16;

interface DragState {
  handleIndex: number;
  startX: number;
  leftColDom: HTMLElement;
  rightColDom: HTMLElement;
  usableWidth: number;
  leftStartPct: number;
  rightStartPct: number;
}

// ── columnList NodeView ──────────────────────────────────

export const columnListNodeView: NodeViewConstructor = (node, view, getPos) => {
  const dom = document.createElement('div');
  dom.classList.add('krig-column-list');
  dom.setAttribute('data-columns', String(node.attrs.columns || 2));

  // ─── Toolbar ───────────────────────────────────────

  const toolbar = document.createElement('div');
  toolbar.classList.add('krig-column-list__toolbar');
  toolbar.setAttribute('contenteditable', 'false');

  const addBtn = document.createElement('button');
  addBtn.classList.add('krig-column-list__toolbar-btn');
  addBtn.textContent = '+';
  addBtn.title = 'Add column';
  addBtn.type = 'button';

  const removeBtn = document.createElement('button');
  removeBtn.classList.add('krig-column-list__toolbar-btn');
  removeBtn.textContent = '−';
  removeBtn.title = 'Remove last column';
  removeBtn.type = 'button';

  const alignBtn = document.createElement('button');
  alignBtn.classList.add('krig-column-list__toolbar-btn');
  alignBtn.title = 'Cycle vertical alignment';
  alignBtn.type = 'button';

  const alignIcons: Record<string, string> = { top: '⬆', center: '⬍', bottom: '⬇' };
  const alignCycle = ['top', 'center', 'bottom'];

  function getCurrentAlign(): string {
    const pos = typeof getPos === 'function' ? getPos() : null;
    if (pos == null) return 'top';
    const currentNode = view.state.doc.nodeAt(pos);
    if (!currentNode || currentNode.childCount === 0) return 'top';
    return (currentNode.child(0).attrs.verticalAlign as string) || 'top';
  }

  function syncAlignBtn() {
    alignBtn.textContent = alignIcons[getCurrentAlign()] || '⬆';
  }

  alignBtn.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const pos = typeof getPos === 'function' ? getPos() : null;
    if (pos == null) return;
    const currentNode = view.state.doc.nodeAt(pos);
    if (!currentNode) return;

    const nextAlign = alignCycle[(alignCycle.indexOf(getCurrentAlign()) + 1) % alignCycle.length];
    let tr = view.state.tr;
    let offset = pos + 1;
    for (let i = 0; i < currentNode.childCount; i++) {
      const child = currentNode.child(i);
      if (child.type.name === 'column') {
        tr = tr.setNodeMarkup(offset, undefined, { ...child.attrs, verticalAlign: nextAlign });
      }
      offset += child.nodeSize;
    }
    view.dispatch(tr);
  });

  toolbar.append(addBtn, removeBtn, alignBtn);

  // ─── Content wrapper (handles 定位基准) ─────────────

  const wrapper = document.createElement('div');
  wrapper.classList.add('krig-column-list__wrapper');

  const contentDOM = document.createElement('div');
  contentDOM.classList.add('krig-column-list__content');

  wrapper.appendChild(contentDOM);
  dom.append(toolbar, wrapper);

  // ─── Resize handles ────────────────────────────────

  const handleContainer = document.createElement('div');
  handleContainer.classList.add('krig-column-list__handles');
  handleContainer.setAttribute('contenteditable', 'false');
  wrapper.appendChild(handleContainer);

  let dragState: DragState | null = null;
  let rafId: number | null = null;

  function updateHandles() {
    handleContainer.innerHTML = '';
    const cols = contentDOM.querySelectorAll(':scope > .krig-column') as NodeListOf<HTMLElement>;
    if (cols.length < 2) return;

    const wrapperRect = wrapper.getBoundingClientRect();

    for (let i = 0; i < cols.length - 1; i++) {
      const leftRect = cols[i].getBoundingClientRect();

      const handle = document.createElement('div');
      handle.classList.add('krig-column-list__handle');
      handle.style.left = `${leftRect.right - wrapperRect.left}px`;
      handle.style.width = `${GAP}px`;

      handle.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        startDrag(i, e, handle);
      });

      handleContainer.appendChild(handle);
    }
  }

  function scheduleUpdateHandles() {
    if (rafId != null) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(() => {
      updateHandles();
      rafId = null;
    });
  }

  function startDrag(handleIdx: number, e: MouseEvent, handle: HTMLElement) {
    const cols = Array.from(contentDOM.querySelectorAll(':scope > .krig-column')) as HTMLElement[];
    const leftCol = cols[handleIdx];
    const rightCol = cols[handleIdx + 1];
    if (!leftCol || !rightCol) return;

    const containerWidth = contentDOM.getBoundingClientRect().width;
    const totalGaps = (cols.length - 1) * GAP;
    const usableWidth = containerWidth - totalGaps;

    dragState = {
      handleIndex: handleIdx,
      startX: e.clientX,
      leftColDom: leftCol,
      rightColDom: rightCol,
      usableWidth,
      leftStartPct: (leftCol.getBoundingClientRect().width / usableWidth) * 100,
      rightStartPct: (rightCol.getBoundingClientRect().width / usableWidth) * 100,
    };

    handle.classList.add('krig-column-list__handle--dragging');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    document.addEventListener('mousemove', onDragMove);
    document.addEventListener('mouseup', onDragEnd);
  }

  function clamp(leftPct: number, rightPct: number): [number, number] {
    const total = leftPct + rightPct;
    if (leftPct < MIN_COL_PCT) return [MIN_COL_PCT, total - MIN_COL_PCT];
    if (rightPct < MIN_COL_PCT) return [total - MIN_COL_PCT, MIN_COL_PCT];
    return [leftPct, rightPct];
  }

  function onDragMove(e: MouseEvent) {
    if (!dragState) return;
    const deltaPct = ((e.clientX - dragState.startX) / dragState.usableWidth) * 100;
    const [lp, rp] = clamp(dragState.leftStartPct + deltaPct, dragState.rightStartPct - deltaPct);

    dragState.leftColDom.style.flex = `${lp} 0 0`;
    dragState.leftColDom.style.width = '';
    dragState.rightColDom.style.flex = `${rp} 0 0`;
    dragState.rightColDom.style.width = '';

    scheduleUpdateHandles();
  }

  function onDragEnd(e: MouseEvent) {
    if (!dragState) return;
    const deltaPct = ((e.clientX - dragState.startX) / dragState.usableWidth) * 100;
    let [lp, rp] = clamp(dragState.leftStartPct + deltaPct, dragState.rightStartPct - deltaPct);
    lp = Math.round(lp * 10) / 10;
    rp = Math.round(rp * 10) / 10;

    const pos = typeof getPos === 'function' ? getPos() : null;
    if (pos != null) {
      const currentNode = view.state.doc.nodeAt(pos);
      if (currentNode) {
        let tr = view.state.tr;
        let offset = pos + 1;
        for (let i = 0; i < currentNode.childCount; i++) {
          const child = currentNode.child(i);
          if (i === dragState.handleIndex) {
            tr = tr.setNodeMarkup(offset, undefined, { ...child.attrs, width: lp });
          } else if (i === dragState.handleIndex + 1) {
            tr = tr.setNodeMarkup(offset, undefined, { ...child.attrs, width: rp });
          }
          offset += child.nodeSize;
        }
        view.dispatch(tr);
      }
    }

    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    dragState = null;
    document.removeEventListener('mousemove', onDragMove);
    document.removeEventListener('mouseup', onDragEnd);
  }

  // ─── Add / Remove column ───────────────────────────

  addBtn.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const pos = typeof getPos === 'function' ? getPos() : null;
    if (pos == null) return;
    const currentNode = view.state.doc.nodeAt(pos);
    if (!currentNode || currentNode.childCount >= 3) return;

    const schema = view.state.schema;
    const newColumn = schema.nodes.column.create(null, [schema.nodes.paragraph.create()]);
    const insertPos = pos + currentNode.nodeSize - 1;
    let tr = view.state.tr.insert(insertPos, newColumn);

    let offset = pos + 1;
    for (let i = 0; i < currentNode.childCount; i++) {
      const child = currentNode.child(i);
      if (child.attrs.width != null) {
        tr = tr.setNodeMarkup(offset, undefined, { ...child.attrs, width: null });
      }
      offset += child.nodeSize;
    }
    tr.setNodeMarkup(pos, undefined, { ...currentNode.attrs, columns: currentNode.childCount + 1 });
    view.dispatch(tr);
  });

  removeBtn.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const pos = typeof getPos === 'function' ? getPos() : null;
    if (pos == null) return;
    const currentNode = view.state.doc.nodeAt(pos);
    if (!currentNode || currentNode.childCount <= 2) return;

    const lastChild = currentNode.child(currentNode.childCount - 1);
    const lastChildPos = pos + currentNode.nodeSize - 1 - lastChild.nodeSize;
    let tr = view.state.tr.delete(lastChildPos, lastChildPos + lastChild.nodeSize);

    let offset = pos + 1;
    for (let i = 0; i < currentNode.childCount - 1; i++) {
      const child = currentNode.child(i);
      if (child.attrs.width != null) {
        tr = tr.setNodeMarkup(offset, undefined, { ...child.attrs, width: null });
      }
      offset += child.nodeSize;
    }
    tr.setNodeMarkup(pos, undefined, { ...currentNode.attrs, columns: currentNode.childCount - 1 });
    view.dispatch(tr);
  });

  // ─── Sync UI state ─────────────────────────────────

  function syncToolbar(updatedNode: PMNode) {
    addBtn.style.display = updatedNode.childCount >= 3 ? 'none' : '';
    removeBtn.style.display = updatedNode.childCount <= 2 ? 'none' : '';
    dom.setAttribute('data-columns', String(updatedNode.childCount));
    syncAlignBtn();
  }

  syncToolbar(node);
  setTimeout(scheduleUpdateHandles, 50);

  return {
    dom,
    contentDOM,
    update(updatedNode) {
      if (updatedNode.type.name !== 'columnList') return false;
      syncToolbar(updatedNode);
      scheduleUpdateHandles();
      return true;
    },
    ignoreMutation(mutation: ViewMutationRecord) {
      if (toolbar.contains(mutation.target)) return true;
      if (handleContainer.contains(mutation.target)) return true;
      return false;
    },
    stopEvent(event: Event) {
      const t = event.target as HTMLElement;
      if (toolbar.contains(t)) return true;
      if (handleContainer.contains(t)) return true;
      return false;
    },
    destroy() {
      if (rafId != null) cancelAnimationFrame(rafId);
      if (dragState) {
        document.removeEventListener('mousemove', onDragMove);
        document.removeEventListener('mouseup', onDragEnd);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    },
  };
};

// ── column NodeView ──────────────────────────────────────

export const columnNodeView: NodeViewConstructor = (node) => {
  const dom = document.createElement('div');
  dom.classList.add('krig-column');

  function syncAttrs(n: PMNode) {
    dom.setAttribute('data-vertical-align', (n.attrs.verticalAlign as string) || 'top');
    const width = n.attrs.width as number | null;
    if (width != null) {
      dom.style.flex = `${width} 0 0`;
    } else {
      dom.style.flex = '1';
    }
    dom.style.width = '';
  }
  syncAttrs(node);

  const contentDOM = document.createElement('div');
  contentDOM.classList.add('krig-column__content');
  dom.appendChild(contentDOM);

  return {
    dom,
    contentDOM,
    update(updatedNode) {
      if (updatedNode.type.name !== 'column') return false;
      syncAttrs(updatedNode);
      return true;
    },
  };
};
