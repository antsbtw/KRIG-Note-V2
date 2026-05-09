/**
 * Help Panel Registry — 右栏长侧栏注册中心(L4.1)
 *
 * 跟 popup-registry 同构(扁平 register/get + Map);跟 4 大 menu 不同 —
 * help-panel content 是 React 组件而非 items 列表,事件由 panel 内部处理。
 *
 * 用法:
 * ```ts
 * helpPanelRegistry.register({
 *   id: 'note-view.help.dictionary',
 *   view: 'note-view',
 *   title: '词典',
 *   Component: DictionaryPanel,
 * });
 *
 * helpPanelController.show('note-view.help.dictionary');
 * ```
 */

import type { HelpPanelItem } from './help-panel-types';

class HelpPanelRegistry {
  private items: Map<string, HelpPanelItem> = new Map();
  private listeners: Set<() => void> = new Set();

  register(item: HelpPanelItem): void {
    this.items.set(item.id, item);
    this.notify();
  }

  unregister(id: string): void {
    if (this.items.delete(id)) this.notify();
  }

  unregisterByView(viewId: string): void {
    let changed = false;
    for (const [id, item] of this.items) {
      if (item.view === viewId) {
        this.items.delete(id);
        changed = true;
      }
    }
    if (changed) this.notify();
  }

  get(id: string): HelpPanelItem | undefined {
    return this.items.get(id);
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  get count(): number {
    return this.items.size;
  }

  private notify(): void {
    this.listeners.forEach((l) => l());
  }
}

export const helpPanelRegistry = new HelpPanelRegistry();
