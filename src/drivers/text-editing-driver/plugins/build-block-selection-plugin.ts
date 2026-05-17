/**
 * block-selection plugin — Notion-like 整块多选
 *
 * 设计:
 *  - 独立 PluginState `selectedIndices: number[] | null`(top-level block 索引升序);
 *    null = 无块选择;非空 = 选中的 top-level block 序号集合。
 *  - 视觉:每选中 block 包 Decoration.node + CSS class `krig-block-selected`(整块圆角蓝底);
 *    同时给 deco 设 draggable="true" 让浏览器允许拖动起点。
 *  - 行为:Esc 选当前块 / 再按解除;Shift+Arrow 扩缩选区;
 *         Copy/Cut 序列化选中 blocks 为 PM Slice + HTML + plain text;
 *         Backspace/Delete 删除全部选中 blocks;
 *         **选中区按住拖动**:整组用 dropPoint 找合法位 → delete+insert(参考 block-handle);
 *         **选中区右键**:弹出独立 context menu(复制/剪切/粘贴)。
 *  - 自动解除:任何文档/选区变化(非本插件 meta)→ 清空 selectedIndices;
 *    mousedown 落在选中区**外**才解除(落在选中区内保留,让拖动/右键能识别选中态)。
 *
 * 多块复制粘贴:走 PM 标准三格式(application/x-prosemirror-slice + text/html via
 *   DOMSerializer + text/plain via textContent),内部粘贴自动还原结构,外部粘贴降级文本/HTML。
 *
 * 粒度:**仅 top-level block**(list 整组算 1 块、callout/table 整体算 1 块)。
 *   list-item 单条多选 / 嵌套块多选不支持(避免序列化跨边界 fragment 失败)。
 */

import { Plugin, PluginKey, TextSelection, type Command } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { Decoration, DecorationSet } from 'prosemirror-view';
import { keymap } from 'prosemirror-keymap';
import { Fragment, Slice, DOMSerializer } from 'prosemirror-model';
import { dropPoint } from 'prosemirror-transform';

export const blockSelectionKey = new PluginKey<BlockSelectionState>(
  'text-editing-driver:block-selection',
);

interface BlockSelectionState {
  /** 升序的 top-level block 索引;null = 无块选择 */
  indices: number[] | null;
  /** 扩选锚点(第一次选中的 index);Shift+Arrow 以此为基准计算端点 */
  anchorIndex: number | null;
}

const EMPTY: BlockSelectionState = { indices: null, anchorIndex: null };

interface BlockSelectionMeta {
  indices: number[] | null;
  anchorIndex: number | null;
}

// ─────────────────────────────────────────────────────────────────────
// 纯读 helper(导出给 selection-source 用)
// ─────────────────────────────────────────────────────────────────────

export function getBlockSelectionIndices(state: import('prosemirror-state').EditorState): number[] | null {
  const pluginState = blockSelectionKey.getState(state);
  return pluginState?.indices ?? null;
}

// ─────────────────────────────────────────────────────────────────────
// 工具:top-level index ↔ pos / node 转换
// ─────────────────────────────────────────────────────────────────────

interface TopLevelBlockInfo {
  index: number;
  start: number;    // node 起点(before 位置)
  end: number;      // node 终点(after 位置)
  node: import('prosemirror-model').Node;
}

function listTopLevelBlocks(doc: import('prosemirror-model').Node): TopLevelBlockInfo[] {
  const out: TopLevelBlockInfo[] = [];
  let offset = 0;
  for (let i = 0; i < doc.childCount; i++) {
    const node = doc.child(i);
    out.push({ index: i, start: offset, end: offset + node.nodeSize, node });
    offset += node.nodeSize;
  }
  return out;
}

function getTopLevelIndexAtPos(doc: import('prosemirror-model').Node, pos: number): number | null {
  const $pos = doc.resolve(Math.max(0, Math.min(pos, doc.content.size)));
  if ($pos.depth < 1) return null;
  return $pos.index(0);
}

/** 根据鼠标坐标算出 top-level block index;界外返回 null */
function getTopLevelIndexAtCoords(
  view: EditorView,
  clientX: number,
  clientY: number,
): number | null {
  const result = view.posAtCoords({ left: clientX, top: clientY });
  if (!result) return null;
  return getTopLevelIndexAtPos(view.state.doc, result.pos);
}

/** 模块级:跨实例 drag 状态(浏览器 dataTransfer 在 drop 阶段会被清,只能用模块变量传) */
let activeMultiDrag: {
  instanceId: string;
  indices: number[];
} | null = null;

// ─────────────────────────────────────────────────────────────────────
// 跨 plugin 协作 API — 给 block-handle plugin 使用
// ─────────────────────────────────────────────────────────────────────

/**
 * block-handle dragstart 时调用:如果指定的 fromPos(单块起拖点) 在当前 block 选区内,
 * 标记为多块拖动并返回 true(block-handle 不需要再写自己的单块 activeDrag)。
 *
 * 返回 false 表示当前不需要多块拖动,block-handle 走原单块路径。
 */
export function tryStartMultiBlockDrag(
  state: import('prosemirror-state').EditorState,
  fromPos: number,
  instanceId: string,
): boolean {
  const indices = blockSelectionKey.getState(state)?.indices ?? null;
  if (!indices || indices.length < 2) return false;
  const hitIdx = getTopLevelIndexAtPos(state.doc, fromPos);
  if (hitIdx === null || !indices.includes(hitIdx)) return false;
  activeMultiDrag = { instanceId, indices: [...indices] };
  return true;
}

/** 查询当前是否有多块 drag 激活(给 block-handle handleDrop 用)*/
export function getActiveMultiBlockDrag(instanceId: string): number[] | null {
  if (!activeMultiDrag || activeMultiDrag.instanceId !== instanceId) return null;
  return activeMultiDrag.indices;
}

/** block-handle dragend 时调用清空 */
export function clearMultiBlockDrag(): void {
  activeMultiDrag = null;
}

/**
 * 多块拖动落 drop 时调用:把选中 blocks 整组移到鼠标坐标对应的合法插入点。
 *
 * 算法对齐**单块拖动**(build-block-handle-plugin.ts handleDrop):
 *  - posAtCoords → 鼠标位置
 *  - dropPoint(doc, pos, slice) → PM 标准算法找最近合法插入点(与 dropcursor 蓝线同源)
 *  - schema 允许多块进 list/callout/cell 就允许;不允许 dropPoint 自动退到外层
 *  - tr.delete 源区间 → tr.mapping.map(dropPos) → tr.insert
 *
 * @returns true 表示成功处理(block-handle handleDrop 应返回 true 阻断 PM 默认);
 *          false 表示无效(如 drop 在自身区间或界外)
 */
export function performMultiBlockDrop(
  view: EditorView,
  indices: number[],
  clientX: number,
  clientY: number,
): boolean {
  const doc = view.state.doc;
  const blocks = listTopLevelBlocks(doc);
  const first = blocks[indices[0]];
  const last = blocks[indices[indices.length - 1]];
  if (!first || !last) return false;

  const result = view.posAtCoords({ left: clientX, top: clientY });
  if (!result) return false;

  // 构造 slice:含选中的所有 top-level node,openStart=openEnd=0 表示"完整块整组"
  const nodes = indices.map((i) => blocks[i].node);
  const slice = new Slice(Fragment.fromArray(nodes), 0, 0);

  // PM 标准 dropPoint:跟 dropcursor 蓝线同源
  const dropPos = dropPoint(doc, result.pos, slice);
  if (dropPos == null) return false;

  // drop 到选区内部 → no-op
  if (dropPos >= first.start && dropPos <= last.end) return false;

  let tr = view.state.tr.delete(first.start, last.end);
  const mappedDrop = tr.mapping.map(dropPos);
  tr.insert(mappedDrop, Fragment.fromArray(nodes));

  // 维持视觉连续:把 block-selection 更新成新位置(仅在仍是 top-level 时)
  try {
    const newDoc = tr.doc;
    const $newPos = newDoc.resolve(mappedDrop);
    if ($newPos.depth >= 1) {
      // 取插入位置在新 doc 中的 top-level index
      const newFirstIdx = $newPos.index(0);
      // 校验:确认新位置确实是 top-level(深度为 1,即直接 doc.child)
      if ($newPos.depth === 1 || (mappedDrop === newDoc.content.size)) {
        const newIndices: number[] = [];
        // 处理边界:dropPos == content.size 时 index 取 childCount
        const baseIdx = mappedDrop === newDoc.content.size
          ? newDoc.childCount - indices.length
          : newFirstIdx;
        for (let i = 0; i < indices.length; i++) newIndices.push(baseIdx + i);
        tr = tr.setMeta(blockSelectionKey, {
          indices: newIndices,
          anchorIndex: baseIdx,
        } as BlockSelectionMeta);
      } else {
        // 嵌进 list/callout/cell 内部 — 解除多块选择(PluginState 无法描述嵌套多选)
        tr = tr.setMeta(blockSelectionKey, {
          indices: null,
          anchorIndex: null,
        } as BlockSelectionMeta);
      }
    }
  } catch {
    /* 选区维护失败不阻断主流程 */
  }

  view.dispatch(tr.scrollIntoView());
  return true;
}

// ─────────────────────────────────────────────────────────────────────
// 序列化:选中 blocks → 3 格式 clipboard 数据
// ─────────────────────────────────────────────────────────────────────

interface ClipboardBundle {
  html: string;
  text: string;
  pmJson: string;  // PM Slice toJSON 字符串(内部粘贴用)
}

function buildClipboardFromSelection(
  view: EditorView,
  indices: number[],
): ClipboardBundle | null {
  if (indices.length === 0) return null;
  const doc = view.state.doc;
  const blocks = listTopLevelBlocks(doc);

  const nodes: import('prosemirror-model').Node[] = [];
  for (const idx of indices) {
    if (idx < 0 || idx >= blocks.length) continue;
    nodes.push(blocks[idx].node);
  }
  if (nodes.length === 0) return null;

  const fragment = Fragment.fromArray(nodes);
  // openStart=0 openEnd=0:顶层完整 block 切片
  const slice = new Slice(fragment, 0, 0);

  // text/html via DOMSerializer
  const serializer = DOMSerializer.fromSchema(view.state.schema);
  const dom = serializer.serializeFragment(fragment);
  const container = document.createElement('div');
  container.appendChild(dom);

  // text/plain:每块 textContent 用 \n\n 连接(与 PM clipboardTextSerializer 兼容)
  const textParts = nodes.map((n) => n.textContent).filter((t) => t.length > 0);

  return {
    html: container.innerHTML,
    text: textParts.join('\n\n'),
    pmJson: JSON.stringify(slice.toJSON()),
  };
}

// ─────────────────────────────────────────────────────────────────────
// 命令:Esc 选块 / 再按解除
// ─────────────────────────────────────────────────────────────────────

const escapeBlockSelection: Command = (state, dispatch) => {
  const cur = blockSelectionKey.getState(state)?.indices ?? null;

  // 已有块选择 → 清空(再按 Esc 解除)
  if (cur && cur.length > 0) {
    if (dispatch) {
      const meta: BlockSelectionMeta = { indices: null, anchorIndex: null };
      dispatch(state.tr.setMeta(blockSelectionKey, meta));
    }
    return true;
  }

  // 否则:把光标所在 top-level block 选中
  const head = state.selection.head;
  const idx = getTopLevelIndexAtPos(state.doc, head);
  if (idx === null) return false;

  if (dispatch) {
    const meta: BlockSelectionMeta = { indices: [idx], anchorIndex: idx };
    // 同步把 PM TextSelection 收成 collapsed,落在该 block 起点 +1(避免文本选区底色叠加)
    const blocks = listTopLevelBlocks(state.doc);
    const block = blocks[idx];
    const tr = state.tr.setMeta(blockSelectionKey, meta);
    // 把 TextSelection 设到 block 内首位置(尽量靠近原 head 但避免跨块)
    try {
      const inside = state.doc.resolve(block.start + 1);
      tr.setSelection(TextSelection.near(inside, 1));
    } catch {
      /* ignore */
    }
    dispatch(tr.scrollIntoView());
  }
  return true;
};

// ─────────────────────────────────────────────────────────────────────
// 命令:Shift+Arrow 扩缩
// ─────────────────────────────────────────────────────────────────────

function extendBlockSelection(direction: -1 | 1): Command {
  return (state, dispatch) => {
    const cur = blockSelectionKey.getState(state);
    const doc = state.doc;
    const total = doc.childCount;
    if (total === 0) return false;

    let indices = cur?.indices ?? null;
    let anchor = cur?.anchorIndex ?? null;

    // 当前没有块选择:用光标所在 block 作起点
    if (!indices || indices.length === 0) {
      const head = state.selection.head;
      const start = getTopLevelIndexAtPos(doc, head);
      if (start === null) return false;
      anchor = start;
      indices = [start];
    }

    // 找当前 head 端(非锚点的端点)
    const minIdx = indices[0];
    const maxIdx = indices[indices.length - 1];
    const headIdx = anchor === minIdx ? maxIdx : minIdx;
    const newHead = headIdx + direction;

    if (newHead < 0 || newHead >= total) return false;

    // 重算区间
    const lo = Math.min(anchor!, newHead);
    const hi = Math.max(anchor!, newHead);
    const newIndices: number[] = [];
    for (let i = lo; i <= hi; i++) newIndices.push(i);

    if (dispatch) {
      const meta: BlockSelectionMeta = { indices: newIndices, anchorIndex: anchor! };
      dispatch(state.tr.setMeta(blockSelectionKey, meta).scrollIntoView());
    }
    return true;
  };
}

// ─────────────────────────────────────────────────────────────────────
// 命令:删除选中 blocks
// ─────────────────────────────────────────────────────────────────────

const deleteSelectedBlocks: Command = (state, dispatch) => {
  const indices = blockSelectionKey.getState(state)?.indices ?? null;
  if (!indices || indices.length === 0) return false;

  const blocks = listTopLevelBlocks(state.doc);
  // 找连续区间的整体范围(top-level 连续 — 我们的 indices 总是连续的)
  const first = blocks[indices[0]];
  const last = blocks[indices[indices.length - 1]];
  if (!first || !last) return false;

  if (dispatch) {
    let tr = state.tr.delete(first.start, last.end);
    // 清块选择 meta
    tr = tr.setMeta(blockSelectionKey, { indices: null, anchorIndex: null } as BlockSelectionMeta);
    // 把 TextSelection 落到删除位置
    try {
      const $pos = tr.doc.resolve(Math.min(first.start, tr.doc.content.size));
      tr.setSelection(TextSelection.near($pos, 1));
    } catch {
      /* ignore */
    }
    dispatch(tr.scrollIntoView());
  }
  return true;
};

// ─────────────────────────────────────────────────────────────────────
// 右键菜单
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
  // 临时定位;append 后再纠偏防溢出视口
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

  addItem('复制', `${mod}C`, () => {
    runClipboardCommand(view, 'copy');
  });
  addItem('剪切', `${mod}X`, () => {
    runClipboardCommand(view, 'cut');
  });
  addItem('粘贴', `${mod}V`, () => {
    runClipboardCommand(view, 'paste');
  });

  document.body.appendChild(menu);
  activeContextMenu = menu;

  // 防溢出:挂载后量真实尺寸再调整位置
  const r = menu.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  if (r.right > vw) menu.style.left = `${Math.max(0, vw - r.width - 8)}px`;
  if (r.bottom > vh) menu.style.top = `${Math.max(0, vh - r.height - 8)}px`;

  // 外部点击 / Esc / 滚动 → 关闭
  const dismiss = (): void => {
    dismissContextMenu();
    document.removeEventListener('mousedown', onOutside, true);
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('scroll', dismiss, true);
  };
  const onOutside = (e: MouseEvent): void => {
    if (activeContextMenu && !activeContextMenu.contains(e.target as Node)) {
      dismiss();
    }
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') dismiss();
  };
  // 异步注册避免立即被自身 contextmenu 触发的事件序列误关
  setTimeout(() => {
    document.addEventListener('mousedown', onOutside, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', dismiss, true);
  }, 0);
}

/**
 * 触发浏览器 copy/cut/paste 命令 — execCommand 会触发 PM 的 props.copy/cut/paste 流水线,
 * 自动走我们已实现的 handleDOMEvents.copy/cut 路径(写三格式)。paste 则用 PM 默认。
 */
function runClipboardCommand(view: EditorView, kind: 'copy' | 'cut' | 'paste'): void {
  view.focus();
  try {
    document.execCommand(kind);
  } catch {
    console.warn(`[block-selection] execCommand(${kind}) failed`);
  }
}

// ─────────────────────────────────────────────────────────────────────
// Plugin
// ─────────────────────────────────────────────────────────────────────

export function buildBlockSelectionPlugin(_instanceId: string): Plugin<BlockSelectionState> {
  return new Plugin<BlockSelectionState>({
    key: blockSelectionKey,
    state: {
      init: () => EMPTY,
      apply(tr, prev) {
        const meta = tr.getMeta(blockSelectionKey) as BlockSelectionMeta | undefined;
        if (meta !== undefined) {
          return { indices: meta.indices, anchorIndex: meta.anchorIndex };
        }
        // 文档变化或选区变化(非本插件触发)→ 清空块选择
        if (prev.indices !== null && (tr.docChanged || tr.selectionSet)) {
          return EMPTY;
        }
        return prev;
      },
    },
    props: {
      decorations(state) {
        const s = blockSelectionKey.getState(state);
        if (!s || !s.indices || s.indices.length === 0) return null;
        const decos: Decoration[] = [];
        const blocks = listTopLevelBlocks(state.doc);
        for (const idx of s.indices) {
          if (idx < 0 || idx >= blocks.length) continue;
          const b = blocks[idx];
          decos.push(
            Decoration.node(b.start, b.end, { class: 'krig-block-selected' }),
          );
        }
        return DecorationSet.create(state.doc, decos);
      },
      // 注:多块拖动 drop 不在本 plugin 处理 — 由 block-handle plugin 在 handleDrop
      //   里读 activeBlockSelectionForDrag (导出 helper) 后调 moveSelectedBlocks 完成。
      //   原因:从段落 DOM 起拖经 PM 内部 dragstart 路径不稳定;统一让用户从 ⋮⋮ 起拖,
      //   行为模型与单块拖动一致(只是 source 是整组)。
      handleKeyDown(view, event) {
        const indices = blockSelectionKey.getState(view.state)?.indices ?? null;
        if (!indices || indices.length === 0) return false;

        // 块选择激活时:Backspace/Delete 删除整组
        if (event.key === 'Backspace' || event.key === 'Delete') {
          if (deleteSelectedBlocks(view.state, view.dispatch)) {
            event.preventDefault();
            return true;
          }
        }

        // ArrowLeft/Right/Up/Down(无 Shift)→ 解除并把光标落到首/尾块
        if (
          !event.shiftKey &&
          (event.key === 'ArrowLeft' ||
            event.key === 'ArrowRight' ||
            event.key === 'ArrowUp' ||
            event.key === 'ArrowDown')
        ) {
          const blocks = listTopLevelBlocks(view.state.doc);
          const toFirst = event.key === 'ArrowLeft' || event.key === 'ArrowUp';
          const targetIdx = toFirst ? indices[0] : indices[indices.length - 1];
          const target = blocks[targetIdx];
          if (target) {
            try {
              const inside = view.state.doc.resolve(
                toFirst ? target.start + 1 : target.end - 1,
              );
              const tr = view.state.tr
                .setMeta(blockSelectionKey, { indices: null, anchorIndex: null } as BlockSelectionMeta)
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

        // Enter:删除选中块,落到原位置(下游 baseKeymap 不再触发 splitBlock,因为光标已在新位置)
        if (event.key === 'Enter' && !event.shiftKey && !event.metaKey && !event.ctrlKey) {
          if (deleteSelectedBlocks(view.state, view.dispatch)) {
            event.preventDefault();
            return true;
          }
        }

        // 字符输入(printable key 且无 modifier)→ 替换选中块为输入字符
        if (
          event.key.length === 1 &&
          !event.ctrlKey &&
          !event.metaKey &&
          !event.altKey
        ) {
          const blocks = listTopLevelBlocks(view.state.doc);
          const first = blocks[indices[0]];
          const last = blocks[indices[indices.length - 1]];
          if (first && last) {
            try {
              let tr = view.state.tr.delete(first.start, last.end);
              const $pos = tr.doc.resolve(Math.min(first.start, tr.doc.content.size));
              tr = tr
                .setSelection(TextSelection.near($pos, 1))
                .setMeta(blockSelectionKey, { indices: null, anchorIndex: null } as BlockSelectionMeta)
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
        // mousedown:右键(button=2)保留选区(让 contextmenu 看见选中态);其他按键清空。
        // 拖动统一从 block-handle (⋮⋮) 起手,所以 mousedown 在编辑区内不需要"落选区内保留"。
        mousedown(view, event) {
          const cur = blockSelectionKey.getState(view.state)?.indices ?? null;
          if (!cur || cur.length === 0) return false;
          if (event.button === 2) return false;
          view.dispatch(
            view.state.tr.setMeta(blockSelectionKey, {
              indices: null,
              anchorIndex: null,
            } as BlockSelectionMeta),
          );
          return false;
        },
        // 右键:落选中区内弹独立菜单;落区外 / 无选择走浏览器默认
        contextmenu(view, event) {
          const cur = blockSelectionKey.getState(view.state)?.indices ?? null;
          if (!cur || cur.length === 0) return false;
          const hitIdx = getTopLevelIndexAtCoords(view, event.clientX, event.clientY);
          if (hitIdx === null || !cur.includes(hitIdx)) return false;
          event.preventDefault();
          showBlockSelectionContextMenu(view, event.clientX, event.clientY);
          return true;
        },
        // 注:dragstart 不走 handleDOMEvents.dragstart — PM 内部对 dragstart 是
        //   "直接 DOM addEventListener" 而不是走 props.handleDOMEvents 分发链,
        //   所以这里挂的回调不会被触发(见 block-handle plugin 也是在 dragBtn 上
        //   addEventListener 直接挂)。我们的多块拖动从段落 DOM 起手,
        //   所以在下面的 view() lifecycle 里挂 view.dom 'dragstart' 监听。
        copy(view, event) {
          const indices = blockSelectionKey.getState(view.state)?.indices ?? null;
          if (!indices || indices.length === 0) return false;
          const bundle = buildClipboardFromSelection(view, indices);
          if (!bundle || !event.clipboardData) return false;
          event.clipboardData.setData('text/html', bundle.html);
          event.clipboardData.setData('text/plain', bundle.text);
          // PM 内部识别字段(与 PM clipboardSerializer 兼容)
          event.clipboardData.setData('application/x-prosemirror-slice', bundle.pmJson);
          event.preventDefault();
          return true;
        },
        cut(view, event) {
          const indices = blockSelectionKey.getState(view.state)?.indices ?? null;
          if (!indices || indices.length === 0) return false;
          const bundle = buildClipboardFromSelection(view, indices);
          if (!bundle || !event.clipboardData) return false;
          event.clipboardData.setData('text/html', bundle.html);
          event.clipboardData.setData('text/plain', bundle.text);
          event.clipboardData.setData('application/x-prosemirror-slice', bundle.pmJson);
          event.preventDefault();
          // 删除选中 blocks
          deleteSelectedBlocks(view.state, view.dispatch);
          return true;
        },
      },
    },
  });
}

// ─────────────────────────────────────────────────────────────────────
// keymap(独立 Plugin,装配时与主 plugin 一起 enable)
// ─────────────────────────────────────────────────────────────────────

export function buildBlockSelectionKeymap(): Plugin {
  return keymap({
    Escape: escapeBlockSelection,
    'Shift-ArrowUp': extendBlockSelection(-1),
    'Shift-ArrowDown': extendBlockSelection(1),
  });
}
