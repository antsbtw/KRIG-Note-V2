/**
 * Help Panel Controller(L4.1)— 右栏长侧栏 state + 互斥
 *
 * state:visible / activeId
 * (无 anchorRect — help-panel 是右栏定宽侧栏,位置由 binding CSS 决定)
 *
 * 同一时刻只允许一个 help-panel 可见(显式打开新 panel 自动关旧)。
 *
 * 全局单例(对齐 popupController)— Q8=A 决策:
 * 跨 workspace 也互斥,跟 popupController 同形。如未来要做 per-workspace
 * 隔离,作为单独 stage 改全部 4 个 controller 一并迁,不在 L4.1 范围。
 *
 * 全局 listener(Esc / click-outside)由 HelpPanelBinding 安装(对齐 PopupBinding),
 * 不放 controller — 原因:listener 需要 React DOM ref(读 panelEl.contains target),
 * controller 不持 DOM。
 */

interface HelpPanelState {
  visible: boolean;
  /** 当前可见 panel ID(对应 helpPanelRegistry 注册项)*/
  activeId: string | null;
}

const EMPTY_STATE: HelpPanelState = Object.freeze({
  visible: false,
  activeId: null,
});

class HelpPanelController {
  private state: HelpPanelState = EMPTY_STATE;
  private listeners: Set<() => void> = new Set();

  show(activeId: string): void {
    this.state = { visible: true, activeId };
    this.notify();
  }

  /** 显式关闭(× 按钮 / Esc / 点外部 / panel 内 onClose)*/
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

  getState(): HelpPanelState {
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

export const helpPanelController = new HelpPanelController();
