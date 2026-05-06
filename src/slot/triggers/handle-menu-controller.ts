/** Handle 菜单 Controller */

interface HandleMenuState {
  visible: boolean;
  x: number;
  y: number;
  viewId: string;
  blockType?: string;
  /** L5-B3.1:命令需要知道作用于哪个 block(PM doc 中的 pos) */
  pos?: number;
}

class HandleMenuController {
  private state: HandleMenuState = { visible: false, x: 0, y: 0, viewId: '' };
  private listeners: Set<() => void> = new Set();

  show(x: number, y: number, viewId: string, blockType?: string, pos?: number): void {
    this.state = { visible: true, x, y, viewId, blockType, pos };
    this.notify();
  }

  hide(): void {
    if (!this.state.visible) return;
    this.state = { ...this.state, visible: false };
    this.notify();
  }

  getState(): HandleMenuState { return this.state; }
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  private notify(): void { this.listeners.forEach((l) => l()); }
}

export const handleMenuController = new HandleMenuController();
