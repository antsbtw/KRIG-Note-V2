/**
 * block-selection plugin — Notion-like 整块多选
 *
 * 设计:
 *  - 独立 PluginState `selectedIndices: number[] | null`(top-level block 索引升序);
 *    null = 无块选择;非空 = 选中的 top-level block 序号集合。
 *  - 视觉:每选中 block 包 Decoration.node + CSS class `krig-block-selected`(整块圆角蓝底)。
 *  - 行为:Esc 选当前块 / 再按解除;Shift+Arrow 扩缩选区;
 *         Copy/Cut 序列化选中 blocks 为 PM Slice + HTML + plain text;
 *         Backspace/Delete 删除全部选中 blocks。
 *  - 自动解除:任何文档/选区变化(非本插件 meta)→ 清空 selectedIndices。
 *
 * 多块复制粘贴:走 PM 标准三格式(application/json:PM Slice + text/html:DOMSerializer +
 *   text/plain:textContent),内部粘贴自动还原结构,外部粘贴降级文本/HTML。
 *
 * 粒度:**仅 top-level block**(list 整组算 1 块、callout/table 整体算 1 块)。
 *   list-item 单条多选 / 嵌套块多选不支持(避免序列化跨边界 fragment 失败)。
 */

import { Plugin, PluginKey, TextSelection, type Command } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { Decoration, DecorationSet } from 'prosemirror-view';
import { keymap } from 'prosemirror-keymap';
import { Fragment, Slice, DOMSerializer } from 'prosemirror-model';

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
// Plugin
// ─────────────────────────────────────────────────────────────────────

export function buildBlockSelectionPlugin(): Plugin<BlockSelectionState> {
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
        // 单击/拖选 → 清空块选择(PM 默认会处理 selection,我们只清 meta)
        mousedown(view) {
          const cur = blockSelectionKey.getState(view.state)?.indices ?? null;
          if (cur && cur.length > 0) {
            view.dispatch(
              view.state.tr.setMeta(blockSelectionKey, {
                indices: null,
                anchorIndex: null,
              } as BlockSelectionMeta),
            );
          }
          return false;
        },
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
