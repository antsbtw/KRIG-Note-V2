/**
 * block-handle PM Plugin — driver 内部渲染 ⋮⋮ 手柄
 *
 * 模式:**单个浮动 handle DOM**(对齐 V1)— 不是每 block 一个 widget。
 *
 * 实现:
 * 1. plugin view mount 时往 view.dom 父容器加 1 个 handle DOM(absolute 定位)
 * 2. 监听 view.dom mousemove → posAtCoords 解析当前悬停 block → 定位 handle
 * 3. handle click → handleMenuController.show
 * 4. handle dragstart → dnd capability emit('dnd.started')
 *
 * 见 docs/RefactorV2/stages/L5B3.1-interactions-design.md § 3.2 + § 3.4。
 */

import { Plugin, PluginKey } from 'prosemirror-state';
import { handleMenuController } from '@slot/triggers/handle-menu-controller';
import { dnd } from '@capabilities/drag-and-drop';

const handleKey = new PluginKey('text-editing-driver:block-handle');

const HANDLE_CLASS = 'krig-block-handle';
const HANDLE_DRAG_MIME = 'application/krig-block-source';

export function buildBlockHandlePlugin(viewId: string, instanceId: string): Plugin {
  return new Plugin({
    key: handleKey,
    view(editorView) {
      let currentPos = -1;
      let currentBlockType = '';
      let isDragging = false;

      const dom = document.createElement('div');
      dom.className = HANDLE_CLASS;
      dom.contentEditable = 'false';
      dom.draggable = true;
      dom.textContent = '⋮⋮';
      dom.title = '拖动以重排,点击打开菜单';
      dom.style.cssText = `
        position: absolute;
        opacity: 0;
        pointer-events: none;
        z-index: 10;
        transition: opacity 0.15s;
      `;

      // 把 handle 插到 view.dom 的父容器(让它跟编辑区同坐标系)
      const parent = editorView.dom.parentElement;
      if (parent) {
        // 父容器需要 position: relative 才能让 handle absolute 锚定到它
        const computed = window.getComputedStyle(parent);
        if (computed.position === 'static') {
          parent.style.position = 'relative';
        }
        parent.appendChild(dom);
      }

      // ── handle 事件 ──
      dom.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (currentPos < 0) return;
        const rect = dom.getBoundingClientRect();
        handleMenuController.show(rect.right + 4, rect.top, viewId, currentBlockType, currentPos);
      });

      dom.addEventListener('dragstart', (e) => {
        if (!e.dataTransfer || currentPos < 0) return;
        isDragging = true;
        const node = editorView.state.doc.nodeAt(currentPos);
        if (!node) return;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData(HANDLE_DRAG_MIME, JSON.stringify({ instanceId, fromPos: currentPos }));
        e.dataTransfer.setData('text/plain', node.textContent);
        dnd.emit('dnd.started', {
          source: { type: 'block', data: { fromPos: currentPos, instanceId } },
        });
        handleMenuController.hide();
      });

      dom.addEventListener('dragend', () => {
        isDragging = false;
        dnd.emit('dnd.completed', { source: null });
      });

      // ── view.dom 监听 mousemove → 定位 handle ──
      const onMouseMove = (e: MouseEvent) => {
        if (isDragging) return;
        const view = editorView;
        const editorRect = view.dom.getBoundingClientRect();

        // 鼠标超出编辑区(左边 70px gutter / 右边 10px) → 隐
        if (
          e.clientX < editorRect.left - 70 ||
          e.clientX > editorRect.right + 10 ||
          e.clientY < editorRect.top ||
          e.clientY > editorRect.bottom
        ) {
          dom.style.opacity = '0';
          dom.style.pointerEvents = 'none';
          currentPos = -1;
          return;
        }

        // probeX:在 gutter 区域时夹紧到文字区内一点(避免 posAtCoords 跳到容器层级)
        const textLeft = editorRect.left + 24; // .ProseMirror padding-left 大约 24
        const probeX = e.clientX >= textLeft ? e.clientX : textLeft + 20;

        const result = view.posAtCoords({ left: probeX, top: e.clientY });
        if (!result) {
          dom.style.opacity = '0';
          dom.style.pointerEvents = 'none';
          return;
        }

        // 解析顶层 block
        let blockStart = -1;
        let blockNode = null;
        let blockDom: HTMLElement | null = null;
        try {
          const $pos = view.state.doc.resolve(result.pos);
          if ($pos.depth >= 1) {
            blockStart = $pos.before(1);
            blockNode = $pos.node(1);
            const nd = view.nodeDOM(blockStart);
            blockDom = nd instanceof HTMLElement ? nd : (nd as Node)?.parentElement as HTMLElement | null;
          }
        } catch {
          /* ignore */
        }

        if (blockStart < 0 || !blockNode || !blockDom) {
          dom.style.opacity = '0';
          dom.style.pointerEvents = 'none';
          return;
        }

        currentPos = blockStart;
        currentBlockType = blockNode.type.name;

        // 定位 handle:相对于 view.dom 父容器
        const parentRect = parent?.getBoundingClientRect();
        if (!parentRect) return;
        const blockRect = blockDom.getBoundingClientRect();
        // handle 顶部跟 block 顶部对齐(微调:对齐第一行 baseline)
        const top = blockRect.top - parentRect.top + 4;
        // handle 在编辑区左侧 gutter 内(view.dom 左边 - handle 自身宽度 - 2px)
        const left = editorRect.left - parentRect.left - 26;
        dom.style.top = `${top}px`;
        dom.style.left = `${left}px`;
        dom.style.opacity = '1';
        dom.style.pointerEvents = 'auto';
      };

      const onMouseLeave = () => {
        if (isDragging) return;
        dom.style.opacity = '0';
        dom.style.pointerEvents = 'none';
        currentPos = -1;
      };

      editorView.dom.addEventListener('mousemove', onMouseMove);
      editorView.dom.addEventListener('mouseleave', onMouseLeave);

      return {
        destroy() {
          editorView.dom.removeEventListener('mousemove', onMouseMove);
          editorView.dom.removeEventListener('mouseleave', onMouseLeave);
          dom.remove();
        },
      };
    },
  });
}
