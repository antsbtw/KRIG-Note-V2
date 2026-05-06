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
export const HANDLE_DRAG_MIME = 'application/krig-block-source';

// 模块级 drag 状态:dragstart 时存,drop/dragend 时读 + 清
// 浏览器 drag-and-drop "protected mode" 会清空自定义 MIME 在 drop 阶段的 dataTransfer
// 所以不能依赖 dataTransfer.getData(MIME) 跨 dragstart→drop 传递业务数据 — 用模块级变量
let activeDrag: { instanceId: string; fromPos: number } | null = null;

export function buildBlockHandlePlugin(viewId: string, instanceId: string): Plugin {
  return new Plugin({
    // 截获 drop:plugin.props.handleDrop 在 PM 默认 drop 处理之前调用,
    // 返回 true 即告诉 PM "这条 drop 我处理了,你别管"
    // 这是修"拖动变复制"bug 的关键(之前用 view.dom.addEventListener('drop')
    // 是冒泡阶段,PM 默认 handler 已先把 dataTransfer.text/plain 当文字插入了)
    props: {
      handleDrop(view, event) {
        // 用模块级 activeDrag(dataTransfer.getData 在 drop 阶段被浏览器清空)
        if (!activeDrag) return false; // 不是我们的 block 拖拽
        if (activeDrag.instanceId !== instanceId) return false;
        const fromPos = activeDrag.fromPos;
        try {
          const result = view.posAtCoords({ left: event.clientX, top: event.clientY });
          if (!result) return true;
          const $pos = view.state.doc.resolve(result.pos);
          if ($pos.depth === 0) return true;
          const blockStart = $pos.before(1);
          const block = view.state.doc.nodeAt(blockStart);
          if (!block) return true;
          let dropPos = blockStart;
          try {
            const nodeDom = view.nodeDOM(blockStart);
            const el = nodeDom instanceof HTMLElement ? nodeDom : null;
            if (el) {
              const r = el.getBoundingClientRect();
              if (event.clientY > r.top + r.height / 2) {
                dropPos = blockStart + block.nodeSize;
              }
            }
          } catch { /* fallback */ }
          if (fromPos === dropPos) return true;
          const sourceNode = view.state.doc.nodeAt(fromPos);
          if (!sourceNode) return true;
          const tr = view.state.tr;
          let actualDrop = dropPos;
          if (dropPos > fromPos) actualDrop = dropPos - sourceNode.nodeSize;
          tr.delete(fromPos, fromPos + sourceNode.nodeSize);
          tr.insert(actualDrop, sourceNode.copy(sourceNode.content));
          view.dispatch(tr);
          dnd.emit('dnd.completed', { source: null });
          return true;
        } catch (err) {
          console.warn('[block-handle] drop exception', err);
          return false;
        }
      },
    },
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
      // position: absolute 锚 .krig-pm-host(view.dom 父容器) — V1 同款模式
      // **关键**:用 opacity 控显隐而非 visibility — opacity:0 元素仍接事件,
      // visibility:hidden 元素不接事件 → 不接事件就无法触发 handle mouseenter →
      // 鼠标过渡到 handle 时无法 cancel hide,handle 永久消失。
      dom.style.cssText = `
        position: absolute;
        opacity: 0;
        pointer-events: auto;
        z-index: 10;
        transition: opacity 0.15s;
      `;
      const hostContainer = editorView.dom.parentElement;
      if (hostContainer) {
        // 确保父容器是 stacking 锚点
        const cs = window.getComputedStyle(hostContainer);
        if (cs.position === 'static') {
          hostContainer.style.position = 'relative';
        }
        hostContainer.appendChild(dom);
      } else {
        document.body.appendChild(dom);
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
        // 模块级 activeDrag 存业务数据(dataTransfer 在 drop 阶段被清,不可靠)
        activeDrag = { instanceId, fromPos: currentPos };
        // dataTransfer 仍设一个 MIME 让浏览器认为是有效拖拽(否则 effectAllowed 不生效);
        // 内容空字符串不重要,业务读 activeDrag
        e.dataTransfer.setData(HANDLE_DRAG_MIME, '1');
        dnd.emit('dnd.started', {
          source: { type: 'block', data: { fromPos: currentPos, instanceId } },
        });
        handleMenuController.hide();
      });

      dom.addEventListener('dragend', () => {
        isDragging = false;
        activeDrag = null;
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
          dom.style.opacity = '0';
          currentPos = -1;
          return;
        }

        // probeX:在 gutter 区域时夹紧到文字区内一点(避免 posAtCoords 跳到容器层级)
        const textLeft = editorRect.left + 24; // .ProseMirror padding-left 大约 24
        const probeX = e.clientX >= textLeft ? e.clientX : textLeft + 20;

        const result = view.posAtCoords({ left: probeX, top: e.clientY });
        if (!result) {
          dom.style.opacity = '0';
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
          return;
        }

        currentPos = blockStart;
        currentBlockType = blockNode.type.name;

        // 定位 handle:position: absolute 锚 .krig-pm-host(view.dom 父)
        // top/left 是相对 hostContainer 的偏移,所以减去 hostContainer 起点
        const blockComputed = window.getComputedStyle(blockDom);
        const blockRect = blockDom.getBoundingClientRect();
        const lineHeight = parseFloat(blockComputed.lineHeight) || parseFloat(blockComputed.fontSize) * 1.7;
        const paddingTop = parseFloat(blockComputed.paddingTop);
        const hostRect = hostContainer?.getBoundingClientRect() ?? { top: 0, left: 0 };

        const HANDLE_HEIGHT = 22;
        const HANDLE_WIDTH = 22;
        const PM_PADDING_LEFT = 48;
        // 垂直对齐:第一行文字基线中心
        const topAbs = blockRect.top + paddingTop + lineHeight / 2 - HANDLE_HEIGHT / 2;
        const leftAbs = editorRect.left + PM_PADDING_LEFT - HANDLE_WIDTH - 4;
        // 相对 hostContainer 的偏移
        const top = topAbs - hostRect.top;
        const left = leftAbs - hostRect.left;

        dom.style.top = `${top}px`;
        dom.style.left = `${left}px`;
        dom.style.opacity = '1';

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

      // V1 模式:isHovered 标志 + 100ms 延迟 hide
      // - handle.mouseenter 时 isHovered=true,清 timer
      // - handle.mouseleave 时 isHovered=false,300ms 后 hide
      // - view.dom.mouseleave(hideHandle)只在 !isHovered 时才 schedule 100ms hide
      // 关键:opacity:0 期间 handle 仍接事件(visibility:hidden 不接),
      //   鼠标过渡到 handle 时 mouseenter 触发 → 取消 hide
      let isHovered = false;
      let hideTimer: ReturnType<typeof setTimeout> | null = null;

      dom.addEventListener('mouseenter', () => {
        isHovered = true;
        if (hideTimer) {
          clearTimeout(hideTimer);
          hideTimer = null;
        }
        dom.style.opacity = '1';
      });
      dom.addEventListener('mouseleave', () => {
        isHovered = false;
        if (hideTimer) clearTimeout(hideTimer);
        hideTimer = setTimeout(() => {
          if (!isHovered) {
            dom.style.opacity = '0';
            currentPos = -1;
          }
          hideTimer = null;
        }, 300);
      });

      const onMouseLeave = () => {
        if (isDragging) return;
        if (isHovered) return; // 鼠标在 handle 上,不 hide
        if (hideTimer) clearTimeout(hideTimer);
        hideTimer = setTimeout(() => {
          if (!isHovered) {
            dom.style.opacity = '0';
            currentPos = -1;
          }
          hideTimer = null;
        }, 100);
      };

      editorView.dom.addEventListener('mousemove', onMouseMove);
      editorView.dom.addEventListener('mouseleave', onMouseLeave);

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
