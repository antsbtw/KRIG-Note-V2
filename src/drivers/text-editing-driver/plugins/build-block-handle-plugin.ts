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
import { Slice, Fragment } from 'prosemirror-model';
import { dropPoint } from 'prosemirror-transform';
import { handleMenuController } from '@slot/triggers/handle-menu-controller';
import { dnd } from '@capabilities/drag-and-drop';
import { MultipleNodeSelection } from './_shared/multiple-node-selection';

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
//
// 单块 (fromPos): block-handle ⋮⋮ 拖单个 node 时用
// 多块 (multiSlice + multiFrom + multiTo): MultipleNodeSelection 激活时拖整组
let activeDrag: {
  instanceId: string;
  fromPos: number;
  multi?: { slice: Slice; from: number; to: number };
} | null = null;

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

        // 多块拖动:用 MNS 的 slice + dropPoint,一次性 delete + insert
        if (activeDrag.multi) {
          const { slice, from, to } = activeDrag.multi;
          try {
            const result = view.posAtCoords({ left: event.clientX, top: event.clientY });
            if (!result) return true;
            const dropPos = dropPoint(view.state.doc, result.pos, slice);
            if (dropPos == null) return true;
            // drop 到选区内部 → no-op
            if (dropPos >= from && dropPos <= to) return true;

            const tr = view.state.tr.delete(from, to);
            const mappedDrop = tr.mapping.map(dropPos);
            tr.insert(mappedDrop, slice.content);
            view.dispatch(tr);
            dnd.emit('dnd.completed', { source: null });
            return true;
          } catch (err) {
            console.warn('[block-handle] multi-drop exception', err);
            return false;
          }
        }

        // 单块拖动(原逻辑)
        const fromPos = activeDrag.fromPos;
        try {
          const result = view.posAtCoords({ left: event.clientX, top: event.clientY });
          if (!result) return true;

          const sourceNode = view.state.doc.nodeAt(fromPos);
          if (!sourceNode) return true;

          // 用 PM 标准 dropPoint 找最近合法插入点 —
          // 跟 prosemirror-dropcursor 蓝线指示一致(同一套算法),
          // 自动处理 callout/blockquote/toggle/list 等嵌套容器的边界情况。
          const sliceToDrop = new Slice(Fragment.from(sourceNode.copy(sourceNode.content)), 0, 0);
          const dropPos = dropPoint(view.state.doc, result.pos, sliceToDrop);
          if (dropPos == null) return true;
          if (dropPos === fromPos) return true;

          const tr = view.state.tr;
          // delete + insert 的顺序敏感:先 delete 再 insert 时,
          // dropPos > fromPos 要减去 sourceSize(因为 doc 已变短)。
          // 用 tr.mapping 自动处理 pos 映射更稳。
          tr.delete(fromPos, fromPos + sourceNode.nodeSize);
          const mappedDrop = tr.mapping.map(dropPos);
          tr.insert(mappedDrop, sourceNode.copy(sourceNode.content));
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
      // isHovered:鼠标在 handle DOM 上(防止 mousemove 误重算 currentPos
      // 让 handle 跳走 — callout/blockquote/toggle 内子 block 的 handle
      // 在 view.dom 边缘外,鼠标移近时 probeX 夹紧会解析到容器层)
      let isHovered = false;

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
        e.dataTransfer.setData(HANDLE_DRAG_MIME, '1');

        // 检测当前是否有 MultipleNodeSelection 且 currentPos 在选区范围内 →
        // 走多块拖动(整组移动)
        const sel = editorView.state.selection;
        const inMultiSelection =
          sel instanceof MultipleNodeSelection &&
          currentPos >= sel.from && currentPos < sel.to;
        if (inMultiSelection) {
          const mns = sel as MultipleNodeSelection;
          activeDrag = {
            instanceId,
            fromPos: currentPos,
            multi: { slice: mns.content(), from: mns.from, to: mns.to },
          };
        } else {
          activeDrag = { instanceId, fromPos: currentPos };
        }

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
        // handle hover 中 → 冻结当前 block,不再 probeX/posAtCoords 重算
        // (callout/blockquote/toggle 内子 block 的 handle 在 view.dom 边缘附近,
        //  鼠标移近 handle 时 probeX 被夹紧到容器 padding 区,会误解析到外层容器
        //  让 handle 瞬移走 — 见 user 反馈:"鼠标移到 handle, handle 自动关闭")
        if (isHovered) return;
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

        // 解析"最具体可拖动 block"(callout/blockquote/toggle 内子 block 也要显示 handle):
        // - 鼠标在 list 内 → 取 listItem / taskItem 层(list 独立语义,Tab 嵌套)
        // - 否则 → 取**最深**的 group='block' 节点
        //   (callout > paragraph 命中 paragraph;顶层 paragraph 命中自身)
        let blockStart = -1;
        let blockNode = null;
        let blockDom: HTMLElement | null = null;
        try {
          const $pos = view.state.doc.resolve(result.pos);
          if ($pos.depth >= 1) {
            // 先看是否在 list 内 — listItem/taskItem 优先(对齐 V1 list 拖拽语义)
            let targetDepth = -1;
            for (let d = $pos.depth; d >= 1; d--) {
              const nodeAt = $pos.node(d);
              if (nodeAt.type.name === 'listItem' || nodeAt.type.name === 'taskItem') {
                targetDepth = d;
                break;
              }
            }
            // 不在 list 内 → 取最深的 group='block' 节点
            if (targetDepth < 0) {
              for (let d = $pos.depth; d >= 1; d--) {
                if ($pos.node(d).type.spec.group === 'block') {
                  targetDepth = d;
                  break;
                }
              }
              if (targetDepth < 0) targetDepth = 1; // 兜底
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

        // callout / toggleList 第一个子 block:handle 与 emoji 💡 或 ▼ 三角视觉撞挤,
        // 隐藏 handle。后续子 block (第 2 行及以后) 仍有 handle 可拖。
        // 用户可通过容器顶 padding 区(emoji / 三角旁)拿到容器自身的 handle 拖动整个 callout/toggle。
        try {
          const $start = view.state.doc.resolve(blockStart);
          const parentName = $start.parent.type.name;
          if ((parentName === 'callout' || parentName === 'toggleList') && $start.index() === 0) {
            dom.style.opacity = '0';
            currentPos = -1;
            return;
          }
        } catch {
          /* ignore */
        }

        // 祖先保留(对齐 Notion 行为):鼠标从 callout 内 child 横向移到左侧 handle 时,
        // 会先经过 callout padding 区(probeX 命中 callout 容器自身,新候选是当前
        // block 的祖先);**鼠标 y 仍落在当前 child 的垂直范围内**时不切换 currentPos —
        // "block + 它的 handle 视为整体"。若鼠标 y 离开 child 范围(移到 callout 顶/底
        // padding),允许正常切换到祖先(此时显示 callout 自身的 handle)。
        if (currentPos >= 0 && blockStart !== currentPos) {
          const newRangeEnd = blockStart + blockNode.nodeSize;
          const isAncestor = blockStart <= currentPos && currentPos < newRangeEnd;
          if (isAncestor) {
            // 检查鼠标 y 是否还在当前 currentPos block 的垂直范围内
            const curNode = view.state.doc.nodeAt(currentPos);
            const curDom = curNode ? view.nodeDOM(currentPos) : null;
            const curEl =
              curDom instanceof HTMLElement
                ? curDom
                : (curDom as Node)?.parentElement as HTMLElement | null;
            if (curEl) {
              const r = curEl.getBoundingClientRect();
              if (e.clientY >= r.top && e.clientY <= r.bottom) {
                // 还在 child 行内 → 保留
                return;
              }
            }
          }
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
      // (isHovered 已在 view() 开头声明,onMouseMove 也读它做冻结守门)
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

      const onMouseLeave = (e: MouseEvent) => {
        if (isDragging) return;
        if (isHovered) return; // 鼠标在 handle 上,不 hide
        // 鼠标从 view.dom 离开但**正进入 handle DOM**(handle 是 hostContainer 的子,
        //  不是 view.dom 的子,鼠标穿越边界会触发 view.dom.mouseleave —
        //  但语义上 handle 和当前 block 是一个整体,不能 hide)
        const next = e.relatedTarget as Node | null;
        if (next && (next === dom || dom.contains(next))) return;
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
