/** Handle 菜单 Controller
 *
 * L5-B3.11:加 blockAttrs 字段,给 HandleItem.visibleWhen 用(对齐 V1 条件显示)
 *
 * fix/handle-menu-instance-id:加 instanceId 必填字段。根因 — 之前 controller
 * 只记录 pos+viewId,handle-* 命令通过 resolveInstanceId() 走
 * `instanceRegistry.getFocusedInstanceId() ?? workspaceManager.getActiveId()`
 * 兜底拿 instanceId。在多 PM 实例共存场景(thought 横切层 + NoteView 主 editor)
 * 下,thought 卡片 hover handle 时焦点常仍在 NoteView,导致 thought 的 pos 被
 * 用到 NoteView 实例上 — 卡片首块的小 pos 映射到 Note 首块(noteTitle)的删除。
 * 现在 caller 必须显式传 instanceId(plugin 闭包里本就有 instanceId)。
 */

interface HandleMenuState {
  visible: boolean;
  x: number;
  y: number;
  viewId: string;
  /** PM 实例 ID — handle 命令必须用此 id 路由到正确 EditorView,不再走 focused 兜底 */
  instanceId: string;
  blockType?: string;
  /** L5-B3.1:命令需要知道作用于哪个 block(PM doc 中的 pos) */
  pos?: number;
  /** L5-B3.11:block 节点 attrs(给 visibleWhen 判断,如 isTitle / level / indent) */
  blockAttrs?: Record<string, unknown>;
}

class HandleMenuController {
  private state: HandleMenuState = { visible: false, x: 0, y: 0, viewId: '', instanceId: '' };
  private listeners: Set<() => void> = new Set();

  show(
    x: number,
    y: number,
    viewId: string,
    instanceId: string,
    blockType?: string,
    pos?: number,
    blockAttrs?: Record<string, unknown>,
  ): void {
    this.state = { visible: true, x, y, viewId, instanceId, blockType, pos, blockAttrs };
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
