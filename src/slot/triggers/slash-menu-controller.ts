/** SlashMenu Controller — 控制 SlashMenuBinding 显示 */

interface SlashMenuState {
  visible: boolean;
  x: number;
  y: number;
  viewId: string;
  query: string;
}

const initialState: SlashMenuState = {
  visible: false, x: 0, y: 0, viewId: '', query: '',
};

class SlashMenuController {
  private state: SlashMenuState = initialState;
  private listeners: Set<() => void> = new Set();

  show(x: number, y: number, viewId: string, query: string = ''): void {
    this.state = { visible: true, x, y, viewId, query };
    this.notify();
  }

  updateQuery(query: string): void {
    this.state = { ...this.state, query };
    this.notify();
  }

  hide(): void {
    if (!this.state.visible) return;
    this.state = { ...this.state, visible: false };
    this.notify();
  }

  getState(): SlashMenuState { return this.state; }
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  private notify(): void { this.listeners.forEach((l) => l()); }
}

export const slashMenuController = new SlashMenuController();
