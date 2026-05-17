/**
 * block-selection plugin — Notion-like 同级 sibling 多块选择
 *
 * 设计规则(对齐用户三条约定):
 *  1. "块" = handle 视觉单元(与 block-handle 一致)
 *     - 共用 _shared/handle-block.ts 的 resolveHandleBlock
 *     - list 内取 listItem/taskItem;其他取最深 group='block' 节点
 *  2. 多选只选**同级 sibling**
 *     - PluginState 记录 parentStart + childIndices,Shift+Arrow 不跨出 parent
 *  3. 拖动可到任意位置
 *     - dropPoint 算法允许的任何插入点(doc 顶层 / 其他容器内 / 容器间)
 *     - drop 后从 mappedDrop 反推新 parent + childIndices,选中态跟随
 *
 * 行为:
 *  - Esc 选光标所在 handle block / 再按解除
 *  - Shift+Arrow 同级扩缩
 *  - Backspace/Delete/Enter/字符 替换或删除整组
 *  - Cmd+C / Cmd+X / Cmd+V 走 PM 三格式 clipboard
 *  - ⋮⋮ handle 拖动整组(block-handle plugin 接管)
 *  - 右键弹独立 context menu(复制/剪切/粘贴)
 *
 * 多块复制粘贴:走 PM 标准三格式(application/x-prosemirror-slice + text/html +
 *   text/plain),内部还原结构,外部降级文本/HTML。
 */

import { Plugin, PluginKey, TextSelection, type Command, type EditorState } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { Decoration, DecorationSet } from 'prosemirror-view';
import { keymap } from 'prosemirror-keymap';
import { Fragment, Slice, DOMSerializer, type Node } from 'prosemirror-model';
import { dropPoint } from 'prosemirror-transform';
import { resolveHandleBlock, listSiblings, type SiblingInfo } from './_shared/handle-block';

export const blockSelectionKey = new PluginKey<BlockSelectionState>(
  'text-editing-driver:block-selection',
);

interface BlockSelectionState {
  /** 父节点在 doc 内的 before pos;-1 表示 parent = doc 自身 */
  parentStart: number;
  /** parent 内被选中的连续 child 索引(升序);空 = 无选择 */
  childIndices: number[];
  /** 扩选锚点(parent 内 child index)*/
  anchorChildIdx: number;
}

const EMPTY: BlockSelectionState = { parentStart: -1, childIndices: [], anchorChildIdx: -1 };

interface BlockSelectionMeta {
  parentStart: number;
  childIndices: number[];
  anchorChildIdx: number;
}

// ─────────────────────────────────────────────────────────────────────
// 内部 helpers
// ─────────────────────────────────────────────────────────────────────

/** parentStart=-1 → doc 自身;否则 doc.nodeAt(parentStart) */
function resolveParent(state: EditorState, parentStart: number): Node | null {
  if (parentStart === -1) return state.doc;
  if (parentStart < 0 || parentStart >= state.doc.content.size) return null;
  return state.doc.nodeAt(parentStart);
}

/** 从 PluginState 拿到选中 sibling 的 SiblingInfo[] (按 parent 内 index 升序)*/
function getSelectedSiblings(state: EditorState): SiblingInfo[] | null {
  const s = blockSelectionKey.getState(state);
  if (!s || s.childIndices.length === 0) return null;
  const parent = resolveParent(state, s.parentStart);
  if (!parent) return null;
  const sibs = listSiblings(parent, s.parentStart);
  return s.childIndices
    .map((i) => sibs[i])
    .filter((info): info is SiblingInfo => info !== undefined);
}

function clearMeta(): BlockSelectionMeta {
  return { parentStart: -1, childIndices: [], anchorChildIdx: -1 };
}

// ─────────────────────────────────────────────────────────────────────
// 纯读 API(给 selection-source / 其他 plugin)
// ─────────────────────────────────────────────────────────────────────

/** 选中块在 doc 内的 before pos 数组;null = 无选择 */
export function getBlockSelectionPositions(state: EditorState): number[] | null {
  const sibs = getSelectedSiblings(state);
  if (!sibs || sibs.length === 0) return null;
  return sibs.map((s) => s.start);
}

/** 选中块数量(给 selection-source 判 kind 用)*/
export function getBlockSelectionCount(state: EditorState): number {
  const s = blockSelectionKey.getState(state);
  return s?.childIndices.length ?? 0;
}

// ─────────────────────────────────────────────────────────────────────
// 多块拖动 module-level state(block-handle 接管 dragstart/dragend)
// ─────────────────────────────────────────────────────────────────────

let activeMultiDrag: {
  instanceId: string;
  parentStart: number;
  childIndices: number[];
} | null = null;

/**
 * block-handle dragstart 时调用:fromPos 是 ⋮⋮ 所属块的 before pos。
 * 检查该块在不在当前 plugin 选区内;在 → 标记多块拖动并返回 true。
 *
 * 注:< 2 块时退回单块(单块走 block-handle 原路径,避免无谓走多块逻辑)。
 */
export function tryStartMultiBlockDrag(
  state: EditorState,
  fromPos: number,
  instanceId: string,
): boolean {
  const s = blockSelectionKey.getState(state);
  if (!s || s.childIndices.length < 2) return false;
  // fromPos 是 block 的 before pos,+1 进入 block 内部以走 resolveHandleBlock
  const block = resolveHandleBlock(state.doc, fromPos + 1);
  if (!block) return false;
  if (block.parentStart !== s.parentStart) return false;
  if (!s.childIndices.includes(block.indexInParent)) return false;
  activeMultiDrag = {
    instanceId,
    parentStart: s.parentStart,
    childIndices: [...s.childIndices],
  };
  return true;
}

/** block-handle handleDrop 调:查多块状态(返回 indices 表存在 / null 表无)*/
export function getActiveMultiBlockDrag(instanceId: string): number[] | null {
  if (!activeMultiDrag || activeMultiDrag.instanceId !== instanceId) return null;
  return activeMultiDrag.childIndices;
}

/** block-handle dragend 调清空 */
export function clearMultiBlockDrag(): void {
  activeMultiDrag = null;
}

/**
 * 多块拖动 drop:用 PM dropPoint 找合法位 → delete + insert → 反推新 parent 维护选区。
 *
 * 算法与单块拖动同源(都走 dropPoint),所以蓝线指示位置 = 实际 drop 位置。
 */
export function performMultiBlockDrop(
  view: EditorView,
  clientX: number,
  clientY: number,
): boolean {
  if (!activeMultiDrag) return false;
  const doc = view.state.doc;
  const parent = resolveParent(view.state, activeMultiDrag.parentStart);
  if (!parent) return false;
  const sibs = listSiblings(parent, activeMultiDrag.parentStart);
  const selected = activeMultiDrag.childIndices
    .map((i) => sibs[i])
    .filter((info): info is SiblingInfo => info !== undefined);
  if (selected.length === 0) return false;
  const first = selected[0];
  const last = selected[selected.length - 1];

  const result = view.posAtCoords({ left: clientX, top: clientY });
  if (!result) return false;

  const nodes = selected.map((s) => s.node);
  const slice = new Slice(Fragment.fromArray(nodes), 0, 0);

  const dropPos = dropPoint(doc, result.pos, slice);
  if (dropPos == null) return false;

  // drop 到选区自身 → no-op
  if (dropPos >= first.start && dropPos <= last.end) return false;

  let tr = view.state.tr.delete(first.start, last.end);
  const mappedDrop = tr.mapping.map(dropPos);
  tr.insert(mappedDrop, Fragment.fromArray(nodes));

  // 反推新 parent + childIndices 维护选区(用户要求拖动后选中态保留)
  try {
    const newDoc = tr.doc;
    const $newPos = newDoc.resolve(mappedDrop);
    const newParentDepth = $newPos.depth;
    const newParentStart = newParentDepth === 0 ? -1 : $newPos.before(newParentDepth);
    const newAnchorChildIdx = $newPos.index(newParentDepth);
    const newChildIndices: number[] = [];
    for (let i = 0; i < nodes.length; i++) newChildIndices.push(newAnchorChildIdx + i);
    tr = tr.setMeta(blockSelectionKey, {
      parentStart: newParentStart,
      childIndices: newChildIndices,
      anchorChildIdx: newAnchorChildIdx,
    } as BlockSelectionMeta);
  } catch {
    tr = tr.setMeta(blockSelectionKey, clearMeta());
  }

  view.dispatch(tr.scrollIntoView());
  return true;
}

// ─────────────────────────────────────────────────────────────────────
// Clipboard 三格式序列化
// ─────────────────────────────────────────────────────────────────────

interface ClipboardBundle {
  html: string;
  text: string;
  pmJson: string;
}

function buildClipboardFromSelection(view: EditorView): ClipboardBundle | null {
  const sibs = getSelectedSiblings(view.state);
  if (!sibs || sibs.length === 0) return null;

  const nodes = sibs.map((s) => s.node);
  const fragment = Fragment.fromArray(nodes);
  const slice = new Slice(fragment, 0, 0);

  const serializer = DOMSerializer.fromSchema(view.state.schema);
  const dom = serializer.serializeFragment(fragment);
  const container = document.createElement('div');
  container.appendChild(dom);

  const textParts = nodes.map((n) => n.textContent).filter((t) => t.length > 0);

  return {
    html: container.innerHTML,
    text: textParts.join('\n\n'),
    pmJson: JSON.stringify(slice.toJSON()),
  };
}

// ─────────────────────────────────────────────────────────────────────
// 命令:Esc 选当前 handle block / 再按解除
// ─────────────────────────────────────────────────────────────────────

const escapeBlockSelection: Command = (state, dispatch) => {
  const s = blockSelectionKey.getState(state);

  if (s && s.childIndices.length > 0) {
    if (dispatch) dispatch(state.tr.setMeta(blockSelectionKey, clearMeta()));
    return true;
  }

  const head = state.selection.head;
  const block = resolveHandleBlock(state.doc, head);
  if (!block) return false;

  if (dispatch) {
    const meta: BlockSelectionMeta = {
      parentStart: block.parentStart,
      childIndices: [block.indexInParent],
      anchorChildIdx: block.indexInParent,
    };
    let tr = state.tr.setMeta(blockSelectionKey, meta);
    try {
      const inside = state.doc.resolve(block.start + 1);
      tr = tr.setSelection(TextSelection.near(inside, 1));
    } catch {
      /* ignore */
    }
    dispatch(tr.scrollIntoView());
  }
  return true;
};

// ─────────────────────────────────────────────────────────────────────
// 命令:Shift+Arrow 同级扩缩(不跨出 parent)
// ─────────────────────────────────────────────────────────────────────

function extendBlockSelection(direction: -1 | 1): Command {
  return (state, dispatch) => {
    let s = blockSelectionKey.getState(state);

    if (!s || s.childIndices.length === 0) {
      const head = state.selection.head;
      const block = resolveHandleBlock(state.doc, head);
      if (!block) return false;
      s = {
        parentStart: block.parentStart,
        childIndices: [block.indexInParent],
        anchorChildIdx: block.indexInParent,
      };
    }

    const parent = resolveParent(state, s.parentStart);
    if (!parent) return false;
    const total = parent.childCount;

    const minIdx = s.childIndices[0];
    const maxIdx = s.childIndices[s.childIndices.length - 1];
    const headIdx = s.anchorChildIdx === minIdx ? maxIdx : minIdx;
    const newHead = headIdx + direction;

    // 同级边界:不跨出 parent
    if (newHead < 0 || newHead >= total) return false;

    const lo = Math.min(s.anchorChildIdx, newHead);
    const hi = Math.max(s.anchorChildIdx, newHead);
    const newIndices: number[] = [];
    for (let i = lo; i <= hi; i++) newIndices.push(i);

    if (dispatch) {
      const meta: BlockSelectionMeta = {
        parentStart: s.parentStart,
        childIndices: newIndices,
        anchorChildIdx: s.anchorChildIdx,
      };
      dispatch(state.tr.setMeta(blockSelectionKey, meta).scrollIntoView());
    }
    return true;
  };
}

// ─────────────────────────────────────────────────────────────────────
// 命令:删除选中整组
// ─────────────────────────────────────────────────────────────────────

const deleteSelectedBlocks: Command = (state, dispatch) => {
  const sibs = getSelectedSiblings(state);
  if (!sibs || sibs.length === 0) return false;
  const first = sibs[0];
  const last = sibs[sibs.length - 1];

  if (dispatch) {
    let tr = state.tr.delete(first.start, last.end);
    tr = tr.setMeta(blockSelectionKey, clearMeta());
    try {
      const $pos = tr.doc.resolve(Math.min(first.start, tr.doc.content.size));
      tr = tr.setSelection(TextSelection.near($pos, 1));
    } catch {
      /* ignore */
    }
    dispatch(tr.scrollIntoView());
  }
  return true;
};

// ─────────────────────────────────────────────────────────────────────
// 右键菜单(DOM)
// ─────────────────────────────────────────────────────────────────────

let activeContextMenu: HTMLElement | null = null;

function dismissContextMenu(): void {
  if (activeContextMenu) {
    activeContextMenu.remove();
    activeContextMenu = null;
  }
}

function showBlockSelectionContextMenu(view: EditorView, clientX: number, clientY: number): void {
  dismissContextMenu();

  const menu = document.createElement('div');
  menu.className = 'krig-block-selection-menu';
  menu.contentEditable = 'false';
  menu.style.cssText =
    `position: fixed; left: ${clientX}px; top: ${clientY}px; z-index: 1000;` +
    `min-width: 160px; padding: 4px 0;` +
    `background: #2a2a2a; color: #f3f6fa; border: 1px solid #444;` +
    `border-radius: 6px; box-shadow: 0 6px 24px rgba(0, 0, 0, 0.4);` +
    `font-size: 13px; user-select: none;`;

  const addItem = (label: string, shortcut: string, run: () => void): void => {
    const item = document.createElement('div');
    item.className = 'krig-block-selection-menu__item';
    item.style.cssText =
      `display: flex; align-items: center; justify-content: space-between;` +
      `padding: 6px 12px; cursor: pointer;`;
    const labelEl = document.createElement('span');
    labelEl.textContent = label;
    const shortcutEl = document.createElement('span');
    shortcutEl.textContent = shortcut;
    shortcutEl.style.cssText = 'color: #888; margin-left: 16px; font-size: 11px;';
    item.appendChild(labelEl);
    item.appendChild(shortcutEl);
    item.addEventListener('mouseenter', () => {
      item.style.background = '#3a3a3a';
    });
    item.addEventListener('mouseleave', () => {
      item.style.background = 'transparent';
    });
    item.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      run();
      dismissContextMenu();
    });
    menu.appendChild(item);
  };

  const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform);
  const mod = isMac ? '⌘' : 'Ctrl+';

  addItem('复制', `${mod}C`, () => runClipboardCommand(view, 'copy'));
  addItem('剪切', `${mod}X`, () => runClipboardCommand(view, 'cut'));
  addItem('粘贴', `${mod}V`, () => runClipboardCommand(view, 'paste'));

  document.body.appendChild(menu);
  activeContextMenu = menu;

  const r = menu.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  if (r.right > vw) menu.style.left = `${Math.max(0, vw - r.width - 8)}px`;
  if (r.bottom > vh) menu.style.top = `${Math.max(0, vh - r.height - 8)}px`;

  const dismiss = (): void => {
    dismissContextMenu();
    document.removeEventListener('mousedown', onOutside, true);
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('scroll', dismiss, true);
  };
  const onOutside = (e: MouseEvent): void => {
    if (activeContextMenu && !activeContextMenu.contains(e.target as globalThis.Node)) dismiss();
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') dismiss();
  };
  setTimeout(() => {
    document.addEventListener('mousedown', onOutside, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', dismiss, true);
  }, 0);
}

function runClipboardCommand(view: EditorView, kind: 'copy' | 'cut' | 'paste'): void {
  view.focus();
  try {
    document.execCommand(kind);
  } catch {
    console.warn(`[block-selection] execCommand(${kind}) failed`);
  }
}

// ─────────────────────────────────────────────────────────────────────
// Plugin 工厂
// ─────────────────────────────────────────────────────────────────────

export function buildBlockSelectionPlugin(_instanceId: string): Plugin<BlockSelectionState> {
  return new Plugin<BlockSelectionState>({
    key: blockSelectionKey,
    state: {
      init: () => EMPTY,
      apply(tr, prev) {
        const meta = tr.getMeta(blockSelectionKey) as BlockSelectionMeta | undefined;
        if (meta !== undefined) {
          return {
            parentStart: meta.parentStart,
            childIndices: meta.childIndices,
            anchorChildIdx: meta.anchorChildIdx,
          };
        }
        if (prev.childIndices.length > 0 && (tr.docChanged || tr.selectionSet)) {
          return EMPTY;
        }
        return prev;
      },
    },
    props: {
      decorations(state) {
        const sibs = getSelectedSiblings(state);
        if (!sibs || sibs.length === 0) return null;
        const decos = sibs.map((s) =>
          Decoration.node(s.start, s.end, { class: 'krig-block-selected' }),
        );
        return DecorationSet.create(state.doc, decos);
      },
      handleKeyDown(view, event) {
        const s = blockSelectionKey.getState(view.state);
        if (!s || s.childIndices.length === 0) return false;

        if (event.key === 'Backspace' || event.key === 'Delete') {
          if (deleteSelectedBlocks(view.state, view.dispatch)) {
            event.preventDefault();
            return true;
          }
        }

        if (
          !event.shiftKey &&
          (event.key === 'ArrowLeft' ||
            event.key === 'ArrowRight' ||
            event.key === 'ArrowUp' ||
            event.key === 'ArrowDown')
        ) {
          const sibs = getSelectedSiblings(view.state);
          if (sibs && sibs.length > 0) {
            const toFirst = event.key === 'ArrowLeft' || event.key === 'ArrowUp';
            const target = toFirst ? sibs[0] : sibs[sibs.length - 1];
            try {
              const inside = view.state.doc.resolve(
                toFirst ? target.start + 1 : target.end - 1,
              );
              const tr = view.state.tr
                .setMeta(blockSelectionKey, clearMeta())
                .setSelection(TextSelection.near(inside, toFirst ? 1 : -1))
                .scrollIntoView();
              view.dispatch(tr);
              event.preventDefault();
              return true;
            } catch {
              /* fall through */
            }
          }
        }

        if (event.key === 'Enter' && !event.shiftKey && !event.metaKey && !event.ctrlKey) {
          if (deleteSelectedBlocks(view.state, view.dispatch)) {
            event.preventDefault();
            return true;
          }
        }

        if (
          event.key.length === 1 &&
          !event.ctrlKey &&
          !event.metaKey &&
          !event.altKey
        ) {
          const sibs = getSelectedSiblings(view.state);
          if (sibs && sibs.length > 0) {
            const first = sibs[0];
            const last = sibs[sibs.length - 1];
            try {
              let tr = view.state.tr.delete(first.start, last.end);
              const $pos = tr.doc.resolve(Math.min(first.start, tr.doc.content.size));
              tr = tr
                .setSelection(TextSelection.near($pos, 1))
                .setMeta(blockSelectionKey, clearMeta())
                .insertText(event.key);
              view.dispatch(tr.scrollIntoView());
              event.preventDefault();
              return true;
            } catch {
              /* fall through */
            }
          }
        }

        return false;
      },
      handleDOMEvents: {
        // 右键(button=2)保留选区;其他按键清空。拖动从 ⋮⋮ 起手。
        mousedown(view, event) {
          const s = blockSelectionKey.getState(view.state);
          if (!s || s.childIndices.length === 0) return false;
          if (event.button === 2) return false;
          view.dispatch(view.state.tr.setMeta(blockSelectionKey, clearMeta()));
          return false;
        },
        // 右键落选中块内 → 弹独立菜单
        contextmenu(view, event) {
          const s = blockSelectionKey.getState(view.state);
          if (!s || s.childIndices.length === 0) return false;
          const result = view.posAtCoords({ left: event.clientX, top: event.clientY });
          if (!result) return false;
          const block = resolveHandleBlock(view.state.doc, result.pos);
          if (!block) return false;
          if (
            block.parentStart !== s.parentStart ||
            !s.childIndices.includes(block.indexInParent)
          ) return false;
          event.preventDefault();
          showBlockSelectionContextMenu(view, event.clientX, event.clientY);
          return true;
        },
        copy(view, event) {
          const bundle = buildClipboardFromSelection(view);
          if (!bundle || !event.clipboardData) return false;
          event.clipboardData.setData('text/html', bundle.html);
          event.clipboardData.setData('text/plain', bundle.text);
          event.clipboardData.setData('application/x-prosemirror-slice', bundle.pmJson);
          event.preventDefault();
          return true;
        },
        cut(view, event) {
          const bundle = buildClipboardFromSelection(view);
          if (!bundle || !event.clipboardData) return false;
          event.clipboardData.setData('text/html', bundle.html);
          event.clipboardData.setData('text/plain', bundle.text);
          event.clipboardData.setData('application/x-prosemirror-slice', bundle.pmJson);
          event.preventDefault();
          deleteSelectedBlocks(view.state, view.dispatch);
          return true;
        },
      },
    },
  });
}

// ─────────────────────────────────────────────────────────────────────
// keymap(独立 Plugin)
// ─────────────────────────────────────────────────────────────────────

export function buildBlockSelectionKeymap(): Plugin {
  return keymap({
    Escape: escapeBlockSelection,
    'Shift-ArrowUp': extendBlockSelection(-1),
    'Shift-ArrowDown': extendBlockSelection(1),
  });
}
