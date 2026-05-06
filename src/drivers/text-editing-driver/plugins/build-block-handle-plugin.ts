/**
 * block-handle PM Plugin — driver 内部渲染 ⋮⋮ 手柄
 *
 * Q3=A、Q5=A、Q7=B:driver 自治 widget decoration + drag source +
 *   handle-controller 弹菜单 + dnd capability 协议消费。
 *
 * 见 docs/RefactorV2/stages/L5B3.1-interactions-design.md § 3.2 + § 3.4。
 *
 * 实现:
 * 1. decorations:遍历 doc 顶层 block,每个 block 加 widget(锚行左侧)
 * 2. handle DOM:position-absolute,⋮⋮ 字符,draggable=true
 * 3. handle click → handleMenuController.show(coords, viewId, blockType, pos)
 * 4. handle dragstart → dnd capability emit('dnd.started')
 *
 * 拖拽完成 onDrop 由 dnd-targets 处理(从 capability 协议路由)。
 */

import { Plugin, PluginKey, type EditorState } from 'prosemirror-state';
import { Decoration, DecorationSet, type EditorView } from 'prosemirror-view';
import type { Node as PMNode } from 'prosemirror-model';
import { handleMenuController } from '@slot/triggers/handle-menu-controller';
import { dnd } from '@capabilities/drag-and-drop';

const handleKey = new PluginKey('text-editing-driver:block-handle');

const HANDLE_CLASS = 'krig-block-handle';
const HANDLE_DRAG_MIME = 'application/krig-block-source';

/** 给 widget 用的工厂 — 每个 block 一个 handle DOM */
function createHandleDom(view: EditorView, viewId: string, instanceId: string, getPos: () => number): HTMLElement {
  const dom = document.createElement('span');
  dom.className = HANDLE_CLASS;
  dom.contentEditable = 'false';
  dom.draggable = true;
  dom.textContent = '⋮⋮';
  dom.title = '拖动以重排,点击打开菜单';

  // 点击 → 弹菜单
  dom.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const pos = getPos();
    if (pos < 0) return;
    const node = view.state.doc.nodeAt(pos);
    if (!node) return;
    const rect = dom.getBoundingClientRect();
    handleMenuController.show(rect.right + 4, rect.top, viewId, node.type.name, pos);
  });

  // dragstart → dnd 协议 emit
  dom.addEventListener('dragstart', (e) => {
    if (!e.dataTransfer) return;
    const pos = getPos();
    if (pos < 0) return;
    const node = view.state.doc.nodeAt(pos);
    if (!node) return;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData(HANDLE_DRAG_MIME, JSON.stringify({ instanceId, fromPos: pos }));
    // 也设 plain text 兼容外部接收
    e.dataTransfer.setData('text/plain', node.textContent);
    dnd.emit('dnd.started', {
      source: { type: 'block', data: { fromPos: pos, instanceId } },
    });
    // 拖拽时关 handle 菜单
    handleMenuController.hide();
  });

  dom.addEventListener('dragend', () => {
    dnd.emit('dnd.completed', { source: null });
  });

  return dom;
}

function buildDecorations(state: EditorState, view: EditorView | null, viewId: string, instanceId: string): DecorationSet {
  if (!view) return DecorationSet.empty;
  const decos: Decoration[] = [];
  const doc = state.doc;
  // 遍历顶层 block
  doc.forEach((node: PMNode, offset: number) => {
    const pos = offset; // 顶层 block 起点
    const widget = Decoration.widget(
      pos,
      () => createHandleDom(view, viewId, instanceId, () => pos),
      { side: -1, key: `handle-${pos}` },
    );
    decos.push(widget);
  });
  return DecorationSet.create(doc, decos);
}

export function buildBlockHandlePlugin(viewId: string, instanceId: string): Plugin {
  let viewRef: EditorView | null = null;

  return new Plugin<DecorationSet>({
    key: handleKey,
    state: {
      init: (_, state) => buildDecorations(state, viewRef, viewId, instanceId),
      apply(_tr, prev, _old, newState) {
        // doc 没变 → 复用旧 decoration(性能)
        if (!viewRef) return prev;
        return buildDecorations(newState, viewRef, viewId, instanceId);
      },
    },
    props: {
      decorations(state) {
        return handleKey.getState(state) ?? null;
      },
    },
    view(editorView) {
      viewRef = editorView;
      // 初始化时 viewRef 为 null,init 时 decoration 是空 — 这里强制重算
      const decos = buildDecorations(editorView.state, viewRef, viewId, instanceId);
      // 用 setTimeout 让 plugin state 更新到位(避免在 view 创建期间 dispatch)
      setTimeout(() => {
        if (editorView.isDestroyed) return;
        // 通过 dispatch 一个 meta tr 让 plugin state 重新计算
        editorView.dispatch(editorView.state.tr.setMeta(handleKey, decos));
      }, 0);
      return {
        destroy() {
          viewRef = null;
        },
      };
    },
  });
}
