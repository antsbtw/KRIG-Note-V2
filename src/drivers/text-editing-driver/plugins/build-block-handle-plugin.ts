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

import { Plugin, PluginKey, TextSelection } from 'prosemirror-state';
import { handleMenuController } from '@slot/triggers/handle-menu-controller';
import { dnd } from '@capabilities/drag-and-drop';

const handleKey = new PluginKey('text-editing-driver:block-handle');

const HANDLE_CLASS = 'krig-block-handle';
export const HANDLE_DRAG_MIME = 'application/krig-block-source';

// ─────────────────────────────────────────────────────────────────────
// 配置区(可调) — block handle 视觉 / 行为参数
// 改完任一项需完全重启 Electron(plugin view 一次性吃配置)
// ─────────────────────────────────────────────────────────────────────
const CONFIG = {
  // 按钮(+ / ⋮⋮ 共享尺寸字号)
  BTN_SIZE: 24,           // px 按钮宽高
  BTN_FONT_SIZE: 24,      // px 字号(影响 + 字符大小)
  BTN_BORDER_RADIUS: 3,   // px 圆角
  BTN_COLOR: '#555',      // 静态字符色
  BTN_HOVER_BG: '#333',   // hover 背景
  BTN_HOVER_COLOR: '#f3f6fa', // hover 字符色

  // wrapper(两按钮容器)
  HANDLE_GAP: 1,          // px + 与 ⋮⋮ 间距
  HANDLE_Z_INDEX: 10,
  HANDLE_OPACITY_TRANSITION: '0.15s',

  // 定位(handle 相对当前 block 文字左缘)
  HANDLE_TEXT_GAP: 8,     // px handle 右缘距 block 文字左缘的间距(对齐 Notion 紧贴风格)

  // hover 检测范围(鼠标超出 view.dom 边界多少 px 才隐藏 handle)
  HOVER_GUTTER_LEFT: 70,  // 鼠标在 view.dom 左外侧 70px 内仍探测
  HOVER_GUTTER_RIGHT: 10, // 右外侧 10px 内仍探测
  PROBE_TEXT_LEFT: 60,    // 必须 = pm-host.css .ProseMirror padding-left(探测位移用)
  PROBE_OFFSET: 20,       // 鼠标在 gutter 时夹紧到文字区内 20px(让 posAtCoords 命中行)

  // hide 延迟
  HIDE_DELAY_FROM_HANDLE: 300, // ms 鼠标离开 handle 后多久隐
  HIDE_DELAY_FROM_VIEW: 100,   // ms 鼠标离开 view.dom 后多久隐

  // ⋮⋮ menu 弹出 offset
  MENU_OFFSET_RIGHT: 4,        // menu 距 ⋮⋮ 右缘多少 px
} as const;

// 推导值(基于上面配置算出来)
const HANDLE_WIDTH = CONFIG.BTN_SIZE * 2 + CONFIG.HANDLE_GAP;  // wrapper 总宽
const HANDLE_HEIGHT = CONFIG.BTN_SIZE;

// 按钮共享样式(BTN_CSS) — 仅 cursor 在两按钮间不同
const BTN_CSS =
  `width: ${CONFIG.BTN_SIZE}px; height: ${CONFIG.BTN_SIZE}px;` +
  `display: flex; align-items: center; justify-content: center;` +
  `color: ${CONFIG.BTN_COLOR}; font-size: ${CONFIG.BTN_FONT_SIZE}px;` +
  `border-radius: ${CONFIG.BTN_BORDER_RADIUS}px; user-select: none;`;

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
        if (!activeDrag) return false;
        if (activeDrag.instanceId !== instanceId) return false;
        const fromPos = activeDrag.fromPos;
        try {
          const result = view.posAtCoords({ left: event.clientX, top: event.clientY });
          if (!result) return true;

          // 拖拽源类型决定目标深度:
          // - source 是 listItem/taskItem → 找目标位置同款层级
          // - 否则 → 顶层 block 边界
          const sourceNode = view.state.doc.nodeAt(fromPos);
          if (!sourceNode) return true;
          const sourceIsListItem =
            sourceNode.type.name === 'listItem' || sourceNode.type.name === 'taskItem';

          let dropPos: number;
          const $pos = view.state.doc.resolve(result.pos);
          if ($pos.depth >= 1) {
            // 找跟 source 同类型的目标层级
            let targetDepth = 1;
            if (sourceIsListItem) {
              for (let d = $pos.depth; d >= 1; d--) {
                const nodeAt = $pos.node(d);
                if (nodeAt.type.name === sourceNode.type.name) {
                  targetDepth = d;
                  break;
                }
              }
            }
            const blockStart = $pos.before(targetDepth);
            const block = view.state.doc.nodeAt(blockStart);
            if (block) {
              dropPos = blockStart;
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
            } else {
              dropPos = result.pos;
            }
          } else {
            dropPos = result.pos;
          }

          if (fromPos === dropPos) return true;

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

      // L5-B3.9:外层 wrapper 包两个按钮 + ⋮⋮(对齐 V1 +/⠿ 双按钮)
      // - + 按钮在下方插入空 paragraph 节点
      // - ⋮⋮ 按钮拖拽 / 点击弹 handle menu
      const dom = document.createElement('div');
      dom.className = HANDLE_CLASS;
      dom.contentEditable = 'false';
      dom.style.cssText =
        `position: absolute; opacity: 0; pointer-events: auto;` +
        `z-index: ${CONFIG.HANDLE_Z_INDEX};` +
        `transition: opacity ${CONFIG.HANDLE_OPACITY_TRANSITION};` +
        `display: flex; align-items: center; gap: ${CONFIG.HANDLE_GAP}px;`;

      // + 按钮(下方插入空 paragraph)
      const addBtn = document.createElement('div');
      addBtn.className = `${HANDLE_CLASS}__add`;
      addBtn.contentEditable = 'false';
      addBtn.textContent = '+';
      addBtn.title = '在下方插入新段落';
      addBtn.style.cssText = BTN_CSS + 'cursor: pointer;';
      dom.appendChild(addBtn);

      // ⋮⋮ 按钮(拖拽 + 点菜单)
      const dragBtn = document.createElement('div');
      dragBtn.className = `${HANDLE_CLASS}__drag`;
      dragBtn.contentEditable = 'false';
      dragBtn.draggable = true;
      dragBtn.textContent = '⋮⋮';
      dragBtn.title = '拖动以重排,点击打开菜单';
      dragBtn.style.cssText = BTN_CSS + 'cursor: grab;';
      dom.appendChild(dragBtn);

      // hover 高亮
      const onBtnEnter = (btn: HTMLElement) => () => {
        btn.style.background = CONFIG.BTN_HOVER_BG;
        btn.style.color = CONFIG.BTN_HOVER_COLOR;
      };
      const onBtnLeave = (btn: HTMLElement) => () => {
        btn.style.background = 'transparent';
        btn.style.color = CONFIG.BTN_COLOR;
      };
      addBtn.addEventListener('mouseenter', onBtnEnter(addBtn));
      addBtn.addEventListener('mouseleave', onBtnLeave(addBtn));
      dragBtn.addEventListener('mouseenter', onBtnEnter(dragBtn));
      dragBtn.addEventListener('mouseleave', onBtnLeave(dragBtn));

      // + 按钮:在当前 block 之后插入新 block
      // - 当前是 listItem/taskItem → 插同类型新 item(包一个空 paragraph)
      // - 其他 → 插空 paragraph
      addBtn.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (currentPos < 0) return;
        const { schema, doc } = editorView.state;
        const node = doc.nodeAt(currentPos);
        if (!node) return;
        const insertPos = currentPos + node.nodeSize;
        const paragraphType = schema.nodes.paragraph;
        if (!paragraphType) return;

        let newBlock;
        let cursorOffset;
        if (node.type.name === 'listItem' || node.type.name === 'taskItem') {
          // list 容器 content: '<item>+' → 必须插同类型 item;item content: 'block+' → 内嵌 paragraph
          const itemType = schema.nodes[node.type.name];
          if (!itemType) return;
          newBlock = itemType.create(null, paragraphType.create());
          cursorOffset = 2; // 跳过 itemStart + paragraphStart
        } else {
          newBlock = paragraphType.create();
          cursorOffset = 1; // 跳过 paragraphStart
        }

        const tr = editorView.state.tr.insert(insertPos, newBlock);
        try {
          tr.setSelection(TextSelection.create(tr.doc, insertPos + cursorOffset));
        } catch {
          /* ignore — pos 计算可能边界 */
        }
        editorView.dispatch(tr);
        editorView.focus();
      });
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

      // ── ⋮⋮ 按钮事件(L5-B3.9 — 从 dom 移到 dragBtn,因为 + 按钮也在 dom 内)──
      dragBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (currentPos < 0) return;
        const rect = dragBtn.getBoundingClientRect();
        // L5-B3.11:把 block.attrs 一起传,给 HandleItem.visibleWhen 判断(isTitle/level/indent 等)
        const node = editorView.state.doc.nodeAt(currentPos);
        const blockAttrs = node ? { ...node.attrs } : undefined;
        handleMenuController.show(
          rect.right + CONFIG.MENU_OFFSET_RIGHT,
          rect.top,
          viewId,
          currentBlockType,
          currentPos,
          blockAttrs,
        );
      });

      dragBtn.addEventListener('dragstart', (e) => {
        if (!e.dataTransfer || currentPos < 0) return;
        isDragging = true;
        const node = editorView.state.doc.nodeAt(currentPos);
        if (!node) return;
        e.dataTransfer.effectAllowed = 'move';
        activeDrag = { instanceId, fromPos: currentPos };
        e.dataTransfer.setData(HANDLE_DRAG_MIME, '1');
        dnd.emit('dnd.started', {
          source: { type: 'block', data: { fromPos: currentPos, instanceId } },
        });
        handleMenuController.hide();
      });

      dragBtn.addEventListener('dragend', () => {
        isDragging = false;
        activeDrag = null;
        dnd.emit('dnd.completed', { source: null });
      });

      // ── view.dom 监听 mousemove → 定位 handle ──
      const onMouseMove = (e: MouseEvent) => {
        if (isDragging) return;
        const view = editorView;
        const editorRect = view.dom.getBoundingClientRect();

        // 鼠标超出编辑区(左边 / 右边 gutter)→ 隐
        if (
          e.clientX < editorRect.left - CONFIG.HOVER_GUTTER_LEFT ||
          e.clientX > editorRect.right + CONFIG.HOVER_GUTTER_RIGHT ||
          e.clientY < editorRect.top ||
          e.clientY > editorRect.bottom
        ) {
          dom.style.opacity = '0';
          currentPos = -1;
          return;
        }

        // probeX:在 gutter 区域时夹紧到文字区内一点(避免 posAtCoords 跳到容器层级)
        const textLeft = editorRect.left + CONFIG.PROBE_TEXT_LEFT;
        const probeX = e.clientX >= textLeft ? e.clientX : textLeft + CONFIG.PROBE_OFFSET;

        const result = view.posAtCoords({ left: probeX, top: e.clientY });
        if (!result) {
          dom.style.opacity = '0';
          return;
        }

        // 解析"最具体可拖动 block":
        // - 鼠标在 list 内 → 取 listItem / taskItem 层(每项独立 handle)
        // - 否则 → 取顶层 block(paragraph / heading / blockquote / codeBlock 等)
        let blockStart = -1;
        let blockNode = null;
        let blockDom: HTMLElement | null = null;
        try {
          const $pos = view.state.doc.resolve(result.pos);
          if ($pos.depth >= 1) {
            // 从最深向外找:第一个 listItem/taskItem 优先;没有则用 depth=1
            let targetDepth = 1;
            for (let d = $pos.depth; d >= 1; d--) {
              const nodeAt = $pos.node(d);
              if (nodeAt.type.name === 'listItem' || nodeAt.type.name === 'taskItem') {
                targetDepth = d;
                break;
              }
            }
            blockStart = $pos.before(targetDepth);
            blockNode = $pos.node(targetDepth);
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

        // L5-B3.11:title 块上不显示 handle(title 不能 turnInto / 删除 / 拖拽 /
        // + 按钮在 title 上插段落语义不准 — title 应该是独立顶部条)
        if (blockNode.type.name === 'paragraph' && blockNode.attrs.isTitle) {
          dom.style.opacity = '0';
          currentPos = -1;
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

        // 对齐 Notion:handle 跟随当前 block 文字左缘(blockRect.left 含 list 嵌套缩进)
        // 垂直对齐第一行基线中心
        const topAbs = blockRect.top + paddingTop + lineHeight / 2 - HANDLE_HEIGHT / 2;
        const leftAbs = blockRect.left - HANDLE_WIDTH - CONFIG.HANDLE_TEXT_GAP;
        // 相对 hostContainer 的偏移
        const top = topAbs - hostRect.top;
        const left = leftAbs - hostRect.left;

        dom.style.top = `${top}px`;
        dom.style.left = `${left}px`;
        dom.style.opacity = '1';
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
        }, CONFIG.HIDE_DELAY_FROM_HANDLE);
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
        }, CONFIG.HIDE_DELAY_FROM_VIEW);
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
