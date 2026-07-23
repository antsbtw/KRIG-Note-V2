/**
 * Settings Modal Controller（全局单例）
 *
 * 对齐 fullscreenOverlayController 模式：订阅/通知，无 React 依赖。
 * activePanel: 当前激活的左侧面板 id（'profiles' | 'network' | 'general'）。
 */

export type SettingsPanel = 'profiles' | 'network' | 'general';

interface SettingsState {
  visible: boolean;
  activePanel: SettingsPanel;
}

class SettingsController {
  private state: SettingsState = { visible: false, activePanel: 'profiles' };
  private listeners = new Set<() => void>();

  open(panel: SettingsPanel = 'profiles'): void {
    this.state = { visible: true, activePanel: panel };
    this.notify();
  }

  close(): void {
    if (!this.state.visible) return;
    this.state = { ...this.state, visible: false };
    this.notify();
  }

  setPanel(panel: SettingsPanel): void {
    if (this.state.activePanel === panel) return;
    this.state = { ...this.state, activePanel: panel };
    this.notify();
  }

  getState(): SettingsState {
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

export const settingsController = new SettingsController();
