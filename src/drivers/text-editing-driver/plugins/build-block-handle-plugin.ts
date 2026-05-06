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
      // position: fixed 用 viewport 坐标 — 不管父容器是 maxWidth/居中/transform 都不影响
      dom.style.cssText = `
        position: fixed;
        opacity: 0;
        pointer-events: none;
        z-index: 10000;
        transition: opacity 0.15s;
      `;
      // 直接挂 body,避免父容器(maxWidth 居中 / transform / overflow:hidden)干扰
      document.body.appendChild(dom);

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

        // 定位 handle:position: fixed 用 viewport 坐标
        const blockRect = blockDom.getBoundingClientRect();
        const HANDLE_HEIGHT = 22;
        const HANDLE_WIDTH = 22;
        const PM_PADDING_LEFT = 48;
        // 垂直居中对齐 block 行(对齐 V1)
        // 多行 block(段落跨多行)时,跟第一行 line-height 中心对齐 — 用 line-height 估算
        // 简化:跟整个 block rect 中心对齐(视觉够好;V1 也是这样)
        const lineHeightApprox = Math.min(blockRect.height, 36); // 估算单行高度
        const top = blockRect.top + (lineHeightApprox - HANDLE_HEIGHT) / 2;
        // handle 紧靠文字左侧 4px
        const left = editorRect.left + PM_PADDING_LEFT - HANDLE_WIDTH - 4;
        dom.style.top = `${top}px`;
        dom.style.left = `${left}px`;
        dom.style.opacity = '1';
        dom.style.pointerEvents = 'auto';
      };

      // 用 setTimeout 延迟 hide,handle 自己 mouseenter 时取消 — 解决 handle 跟 view.dom
      // DOM 上是兄弟、鼠标过渡到 handle 时 mouseleave 先触发的问题
      let hideTimer: ReturnType<typeof setTimeout> | null = null;
      const scheduleHide = () => {
        if (hideTimer) clearTimeout(hideTimer);
        hideTimer = setTimeout(() => {
          dom.style.opacity = '0';
          dom.style.pointerEvents = 'none';
          currentPos = -1;
          hideTimer = null;
        }, 80);
      };
      const cancelHide = () => {
        if (hideTimer) {
          clearTimeout(hideTimer);
          hideTimer = null;
        }
      };

      const onMouseLeave = () => {
        if (isDragging) return;
        scheduleHide();
      };

      // handle 自己:mouseenter 取消 hide / mouseleave 重新调度 hide
      dom.addEventListener('mouseenter', cancelHide);
      dom.addEventListener('mouseleave', scheduleHide);

      editorView.dom.addEventListener('mousemove', onMouseMove);
      editorView.dom.addEventListener('mouseleave', onMouseLeave);
      // mousemove 时也取消 hide(用户回到编辑区)
      editorView.dom.addEventListener('mouseenter', cancelHide);

      return {
        destroy() {
          editorView.dom.removeEventListener('mousemove', onMouseMove);
          editorView.dom.removeEventListener('mouseleave', onMouseLeave);
          editorView.dom.removeEventListener('mouseenter', cancelHide);
          if (hideTimer) clearTimeout(hideTimer);
          dom.remove();
        },
      };
    },
  });
}
