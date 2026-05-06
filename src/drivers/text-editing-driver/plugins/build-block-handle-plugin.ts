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
      // position: fixed + 高 z-index;visibility 控制显隐(不用 opacity transition,避免
      // 半透明阶段 pointer-events 行为不一致)
      dom.style.cssText = `
        position: fixed;
        visibility: hidden;
        pointer-events: auto;
        z-index: 10000;
      `;
      // 挂到 view.dom 父级链上的最早 stacking-friendly 父元素(html.body)
      // body 是最干净的容器,不会有 transform/opacity 创建的 stacking context 困住
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

      let handlePositionLogCount = 0;
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
          dom.style.visibility = 'hidden';
          currentPos = -1;
          return;
        }

        // probeX:在 gutter 区域时夹紧到文字区内一点(避免 posAtCoords 跳到容器层级)
        const textLeft = editorRect.left + 24; // .ProseMirror padding-left 大约 24
        const probeX = e.clientX >= textLeft ? e.clientX : textLeft + 20;

        const result = view.posAtCoords({ left: probeX, top: e.clientY });
        if (!result) {
          dom.style.visibility = 'hidden';
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
          dom.style.visibility = 'hidden';
          return;
        }

        currentPos = blockStart;
        currentBlockType = blockNode.type.name;

        // 定位 handle:position: fixed 用 viewport 坐标
        // 用 block DOM 计算 line-height(从 computed style 真实读)
        const blockComputed = window.getComputedStyle(blockDom);
        const blockRect = blockDom.getBoundingClientRect();
        const lineHeight = parseFloat(blockComputed.lineHeight) || parseFloat(blockComputed.fontSize) * 1.7;
        const paddingTop = parseFloat(blockComputed.paddingTop);

        const HANDLE_HEIGHT = 22;
        const HANDLE_WIDTH = 22;
        const PM_PADDING_LEFT = 48;
        // 垂直对齐:让 handle 中心 = 第一行文字基线中心
        // 第一行起点 = blockRect.top + paddingTop
        // 第一行文字垂直中心 ≈ paddingTop + lineHeight/2
        // handle top = block top + 第一行文字中心 - HANDLE_HEIGHT/2
        const top = blockRect.top + paddingTop + lineHeight / 2 - HANDLE_HEIGHT / 2;
        const left = editorRect.left + PM_PADDING_LEFT - HANDLE_WIDTH - 4;

        dom.style.top = `${top}px`;
        dom.style.left = `${left}px`;
        dom.style.visibility = 'visible';

        // 诊断(前 5 次)
        if (handlePositionLogCount < 5) {
          // 等下一帧让 visibility 生效再测
          requestAnimationFrame(() => {
            const r2 = dom.getBoundingClientRect();
            const stack = document.elementsFromPoint(
              r2.left + r2.width / 2,
              r2.top + r2.height / 2,
            );
            console.log('[block-handle][fix v4] positioned', {
              handleVisible: window.getComputedStyle(dom).visibility,
              handleZ: window.getComputedStyle(dom).zIndex,
              stack: stack.slice(0, 5).map((e) => `${e.tagName}.${e.className?.toString().slice(0, 30) || ''}`),
              handleAtTop: stack[0] === dom,
            });
          });
          handlePositionLogCount++;
        }
      };

      let hideTimer: ReturnType<typeof setTimeout> | null = null;
      const scheduleHide = (source: string) => {
        console.log('[block-handle] scheduleHide from', source);
        if (hideTimer) clearTimeout(hideTimer);
        hideTimer = setTimeout(() => {
          console.log('[block-handle] hide fired (no cancel within 200ms)');
          dom.style.visibility = 'hidden';
          currentPos = -1;
          hideTimer = null;
        }, 200); // 增加到 200ms,鼠标过渡更充裕
      };
      const cancelHide = (source: string) => {
        if (hideTimer) {
          console.log('[block-handle] cancelHide from', source);
          clearTimeout(hideTimer);
          hideTimer = null;
        }
      };

      const onMouseLeave = (e: MouseEvent) => {
        if (isDragging) return;
        // 诊断:看 relatedTarget 是什么(鼠标接下来去哪)
        const related = e.relatedTarget as Element | null;
        console.log('[block-handle] view.dom mouseleave', {
          relatedTag: related?.tagName,
          relatedClass: related?.className,
          isHandle: related === dom || (related && dom.contains(related)),
          mouseAt: { x: e.clientX, y: e.clientY },
        });
        scheduleHide('view.dom mouseleave');
      };

      // handle 自己:mouseenter 取消 hide / mouseleave 重新调度 hide
      dom.addEventListener('mouseenter', () => cancelHide('handle mouseenter'));
      dom.addEventListener('mouseleave', () => scheduleHide('handle mouseleave'));

      editorView.dom.addEventListener('mousemove', onMouseMove);
      editorView.dom.addEventListener('mouseleave', onMouseLeave);
      editorView.dom.addEventListener('mouseenter', () => cancelHide('view.dom mouseenter'));

      return {
        destroy() {
          editorView.dom.removeEventListener('mousemove', onMouseMove);
          editorView.dom.removeEventListener('mouseleave', onMouseLeave);
          if (hideTimer) clearTimeout(hideTimer);
          dom.remove();
        },
      };
    },
  });
}
