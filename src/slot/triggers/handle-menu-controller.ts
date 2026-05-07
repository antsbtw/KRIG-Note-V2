/** Handle 菜单 Controller
 *
 * L5-B3.11:加 blockAttrs 字段,给 HandleItem.visibleWhen 用(对齐 V1 条件显示)
 */

interface HandleMenuState {
  visible: boolean;
  x: number;
  y: number;
  viewId: string;
  blockType?: string;
  /** L5-B3.1:命令需要知道作用于哪个 block(PM doc 中的 pos) */
  pos?: number;
  /** L5-B3.11:block 节点 attrs(给 visibleWhen 判断,如 isTitle / level / indent) */
  blockAttrs?: Record<string, unknown>;
}

class HandleMenuController {
  private state: HandleMenuState = { visible: false, x: 0, y: 0, viewId: '' };
  private listeners: Set<() => void> = new Set();

  show(
    x: number,
    y: number,
    viewId: string,
    blockType?: string,
    pos?: number,
    blockAttrs?: Record<string, unknown>,
  ): void {
    this.state = { visible: true, x, y, viewId, blockType, pos, blockAttrs };
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
