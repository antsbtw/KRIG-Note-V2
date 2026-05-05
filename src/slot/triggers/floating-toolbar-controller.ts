/** FloatingToolbar Controller(选区上方浮条)*/

interface FloatingToolbarState {
  visible: boolean;
  x: number;
  y: number;
  viewId: string;
}

class FloatingToolbarController {
  private state: FloatingToolbarState = { visible: false, x: 0, y: 0, viewId: '' };
  private listeners: Set<() => void> = new Set();

  show(x: number, y: number, viewId: string): void {
    this.state = { visible: true, x, y, viewId };
    this.notify();
  }

  hide(): void {
    if (!this.state.visible) return;
    this.state = { ...this.state, visible: false };
    this.notify();
  }

  getState(): FloatingToolbarState { return this.state; }
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  private notify(): void { this.listeners.forEach((l) => l()); }
}

export const floatingToolbarController = new FloatingToolbarController();
