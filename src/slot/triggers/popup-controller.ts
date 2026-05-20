/**
 * Popup Controller(anchor-positioned 弹层)— L5-B3.4
 *
 * state:visible / activeId / anchorRect
 * anchor 用 DOMRect(getBoundingClientRect)而非 element 引用,避免 stale ref 问题。
 *
 * 同一时刻只允许一个 popup 可见(显式打开新 popup 自动关旧)。
 */

interface PopupState {
  visible: boolean;
  /** 当前可见 popup ID(对应 popupRegistry 注册项)*/
  activeId: string | null;
  /** anchor 元素的 viewport 坐标 rect(给 binding 算 popup 位置)*/
  anchorRect: DOMRect | null;
  /**
   * show 序号(每次 show 自增),配合 PopupBinding 里 key={activeId-showSeq}
   * 让"同 id 重复 show"也能强制 Component remount —— pending-context 模式
   * (AskAIPanel 等)依赖 mount 时 consume,不 remount 会让新 ctx 永远不被读取。
   */
  showSeq: number;
}

const EMPTY_STATE: PopupState = Object.freeze({
  visible: false,
  activeId: null,
  anchorRect: null,
  showSeq: 0,
});

class PopupController {
  private state: PopupState = EMPTY_STATE;
  private listeners: Set<() => void> = new Set();

  show(activeId: string, anchorEl: Element): void {
    const rect = anchorEl.getBoundingClientRect();
    this.state = {
      visible: true,
      activeId,
      anchorRect: rect,
      showSeq: this.state.showSeq + 1,
    };
    this.notify();
  }

  /** 显式关闭(popup 内部调 onClose / 点外部 / Esc)*/
  hide(): void {
    if (!this.state.visible) return;
    this.state = EMPTY_STATE;
    this.notify();
  }

  /** 切换:相同 id 时 toggle(关闭),不同 id 时直接打开新的 */
  toggle(activeId: string, anchorEl: Element): void {
    if (this.state.visible && this.state.activeId === activeId) {
      this.hide();
    } else {
      this.show(activeId, anchorEl);
    }
  }

  getState(): PopupState {
    return this.state;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    this.listeners.forEach((l) => l());
  }
}

export const popupController = new PopupController();
