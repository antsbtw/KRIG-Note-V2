/**
 * throttled-dropcursor — rAF 节流版 PM dropcursor 替代
 *
 * 背景:PM 官方 prosemirror-dropcursor 的 dragover handler 不节流,浏览器原生
 * dragover 60-100Hz 触发,每次都跑 posAtCoords (O(doc size)) + dropPoint (跨容器
 * 验证) + setCursor (decoration 触发 PM plugin state 重算 + React NodeView reconcile)。
 * 大 doc (56KB+) + 多 NodeView 场景下,单帧搞不完 → 蓝线视觉滞后于鼠标几百毫秒。
 *
 * 修法:dragover handler 只 stash 最新事件 + rAF 调度,同帧最多跑一次实际计算。
 * 其余路径(dragend/drop/dragleave/update/updateOverlay)字面照搬 PM 官方实现。
 *
 * 接口:dropCursor(options) — 与 prosemirror-dropcursor 完全兼容。
 */

import { Plugin, EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { dropPoint } from 'prosemirror-transform';

interface DropCursorOptions {
  color?: string | false;
  width?: number;
  class?: string;
}

export function buildThrottledDropCursorPlugin(options: DropCursorOptions = {}): Plugin {
  return new Plugin({
    view(editorView) {
      return new ThrottledDropCursorView(editorView, options);
    },
  });
}

class ThrottledDropCursorView {
  private editorView: EditorView;
  private cursorPos: number | null = null;
  private element: HTMLElement | null = null;
  private timeout: ReturnType<typeof setTimeout> | -1 = -1;
  private width: number;
  private color: string | undefined;
  private className: string | undefined;
  private handlers: Array<{ name: string; handler: (e: Event) => void }>;

  // rAF 节流:dragover 高频触发,只 stash 最新事件,rAF 内统一处理
  private pendingDragoverEvent: DragEvent | null = null;
  private rafPending = 0;

  constructor(editorView: EditorView, options: DropCursorOptions) {
    this.editorView = editorView;
    this.width = options.width ?? 1;
    this.color = options.color === false ? undefined : (options.color || 'black');
    this.className = options.class;
    this.handlers = (['dragover', 'dragend', 'drop', 'dragleave'] as const).map((name) => {
      const handler = (e: Event) => {
        // dragover 走节流路径,其他三个直接同步
        if (name === 'dragover') this.onDragoverThrottled(e as DragEvent);
        else if (name === 'dragend') this.onDragend();
        else if (name === 'drop') this.onDrop();
        else this.onDragleave(e as DragEvent);
      };
      editorView.dom.addEventListener(name, handler);
      return { name, handler };
    });
  }

  destroy(): void {
    this.handlers.forEach(({ name, handler }) =>
      this.editorView.dom.removeEventListener(name, handler),
    );
    if (this.rafPending) {
      cancelAnimationFrame(this.rafPending);
      this.rafPending = 0;
    }
    this.pendingDragoverEvent = null;
    if (this.timeout !== -1) clearTimeout(this.timeout);
    if (this.element?.parentNode) this.element.parentNode.removeChild(this.element);
    this.element = null;
  }

  update(_editorView: EditorView, prevState: EditorState): void {
    if (this.cursorPos != null && prevState.doc !== this.editorView.state.doc) {
      if (this.cursorPos > this.editorView.state.doc.content.size) {
        this.setCursor(null);
      } else {
        this.updateOverlay();
      }
    }
  }

  private setCursor(pos: number | null): void {
    if (pos === this.cursorPos) return;
    this.cursorPos = pos;
    if (pos == null) {
      if (this.element?.parentNode) {
        this.element.parentNode.removeChild(this.element);
      }
      this.element = null;
    } else {
      this.updateOverlay();
    }
  }

  // 字面照搬 PM 官方 updateOverlay(只换 TypeScript 显式类型 + null 守护)
  private updateOverlay(): void {
    if (this.cursorPos == null) return;
    const $pos = this.editorView.state.doc.resolve(this.cursorPos);
    const isBlock = !$pos.parent.inlineContent;
    let rect: { left: number; right: number; top: number; bottom: number } | undefined;
    const editorDOM = this.editorView.dom;
    const editorRect = editorDOM.getBoundingClientRect();
    const scaleX = editorRect.width / (editorDOM as HTMLElement).offsetWidth;
    const scaleY = editorRect.height / (editorDOM as HTMLElement).offsetHeight;

    if (isBlock) {
      const before = $pos.nodeBefore;
      const after = $pos.nodeAfter;
      if (before || after) {
        const node = this.editorView.nodeDOM(this.cursorPos - (before ? before.nodeSize : 0));
        if (node) {
          const nodeRect = (node as HTMLElement).getBoundingClientRect();
          let top = before ? nodeRect.bottom : nodeRect.top;
          if (before && after) {
            const afterDom = this.editorView.nodeDOM(this.cursorPos);
            if (afterDom) {
              top = (top + (afterDom as HTMLElement).getBoundingClientRect().top) / 2;
            }
          }
          const halfWidth = (this.width / 2) * scaleY;
          rect = { left: nodeRect.left, right: nodeRect.right, top: top - halfWidth, bottom: top + halfWidth };
        }
      }
    }
    if (!rect) {
      const coords = this.editorView.coordsAtPos(this.cursorPos);
      const halfWidth = (this.width / 2) * scaleX;
      rect = { left: coords.left - halfWidth, right: coords.left + halfWidth, top: coords.top, bottom: coords.bottom };
    }

    const parent = (this.editorView.dom as HTMLElement).offsetParent as HTMLElement | null;
    if (!this.element) {
      const host = parent ?? document.body;
      this.element = host.appendChild(document.createElement('div'));
      if (this.className) this.element.className = this.className;
      this.element.style.cssText = 'position: absolute; z-index: 50; pointer-events: none;';
      if (this.color) this.element.style.backgroundColor = this.color;
    }
    this.element.classList.toggle('prosemirror-dropcursor-block', isBlock);
    this.element.classList.toggle('prosemirror-dropcursor-inline', !isBlock);

    let parentLeft: number;
    let parentTop: number;
    if (!parent || (parent === document.body && getComputedStyle(parent).position === 'static')) {
      parentLeft = -window.pageXOffset;
      parentTop = -window.pageYOffset;
    } else {
      const parentRect = parent.getBoundingClientRect();
      const parentScaleX = parentRect.width / parent.offsetWidth;
      const parentScaleY = parentRect.height / parent.offsetHeight;
      parentLeft = parentRect.left - parent.scrollLeft * parentScaleX;
      parentTop = parentRect.top - parent.scrollTop * parentScaleY;
    }
    this.element.style.left = `${(rect.left - parentLeft) / scaleX}px`;
    this.element.style.top = `${(rect.top - parentTop) / scaleY}px`;
    this.element.style.width = `${(rect.right - rect.left) / scaleX}px`;
    this.element.style.height = `${(rect.bottom - rect.top) / scaleY}px`;
  }

  private scheduleRemoval(ms: number): void {
    if (this.timeout !== -1) clearTimeout(this.timeout);
    this.timeout = setTimeout(() => this.setCursor(null), ms);
  }

  // ── 节流核心:dragover 多次触发只 stash 最新事件,rAF 内跑一次 ──
  private onDragoverThrottled(event: DragEvent): void {
    this.pendingDragoverEvent = event;
    if (this.rafPending) return;
    this.rafPending = requestAnimationFrame(() => {
      this.rafPending = 0;
      const ev = this.pendingDragoverEvent;
      this.pendingDragoverEvent = null;
      if (!ev) return;
      this.processDragover(ev);
    });
  }

  // 字面照搬 PM 官方 dragover handler 逻辑(只把 this.editorView 字段访问拆开)
  private processDragover(event: DragEvent): void {
    if (!this.editorView.editable) return;
    const pos = this.editorView.posAtCoords({ left: event.clientX, top: event.clientY });
    const node = pos && pos.inside >= 0 && this.editorView.state.doc.nodeAt(pos.inside);
    const disableDropCursorSpec = node ? node.type.spec.disableDropCursor : undefined;
    const disabled = typeof disableDropCursorSpec === 'function'
      ? disableDropCursorSpec(this.editorView, pos, event)
      : disableDropCursorSpec;
    if (pos && !disabled) {
      let target = pos.pos;
      // editorView.dragging 是 PM 内部属性,官方源码里直接读
      const dragging = (this.editorView as unknown as { dragging?: { slice?: import('prosemirror-model').Slice } }).dragging;
      if (dragging && dragging.slice) {
        const point = dropPoint(this.editorView.state.doc, target, dragging.slice);
        if (point != null) target = point;
      }
      this.setCursor(target);
      this.scheduleRemoval(5000);
    }
  }

  private onDragend(): void {
    this.scheduleRemoval(20);
  }

  private onDrop(): void {
    this.scheduleRemoval(20);
  }

  private onDragleave(event: DragEvent): void {
    const target = event.relatedTarget as Node | null;
    if (!target || !this.editorView.dom.contains(target)) {
      this.setCursor(null);
    }
  }
}
