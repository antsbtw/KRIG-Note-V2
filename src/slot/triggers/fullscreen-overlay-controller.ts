/**
 * Fullscreen Overlay Controller(app-scoped 全屏覆盖层)
 *
 * 与 popupController 的差异:
 * - popupController:state = { visible, activeId, anchorRect } — 有 anchor
 * - fullscreenOverlayController:state = { visible, activeId } — 无 anchor,撑满 viewport
 *
 * 同一时刻只允许一个 overlay 可见(显式 show 新 overlay 自动 hide 旧的)。
 *
 * 全局单例 — 不属于任何 Workspace。如果 Workspace 切换,L2 Shell 入口决定
 * 是否调 hide()(本期实现:active 时 WorkspaceContainer 整体 display:none,
 * 用户感知不到切 Workspace 的可能 — Workspace 切换按钮在 WorkspaceBar 上,
 * WorkspaceBar 此时也 hidden)。
 */

interface FullscreenOverlayState {
  visible: boolean;
  /** 当前可见 overlay ID(对应 fullscreenOverlayRegistry 注册项)*/
  activeId: string | null;
}

const EMPTY_STATE: FullscreenOverlayState = Object.freeze({
  visible: false,
  activeId: null,
});

class FullscreenOverlayController {
  private state: FullscreenOverlayState = EMPTY_STATE;
  private listeners: Set<() => void> = new Set();

  show(activeId: string): void {
    this.state = { visible: true, activeId };
    this.notify();
  }

  /** 显式关闭(overlay 内部调 onClose / Esc 触发 / 业务方主动关)*/
  hide(): void {
    if (!this.state.visible) return;
    this.state = EMPTY_STATE;
    this.notify();
  }

  /** 切换:相同 id 时 toggle(关闭),不同 id 时直接打开新的 */
  toggle(activeId: string): void {
    if (this.state.visible && this.state.activeId === activeId) {
      this.hide();
    } else {
      this.show(activeId);
    }
  }

  getState(): FullscreenOverlayState {
    return this.state;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    this.listeners.forEach((l) => l());
  }
}

export const fullscreenOverlayController = new FullscreenOverlayController();
