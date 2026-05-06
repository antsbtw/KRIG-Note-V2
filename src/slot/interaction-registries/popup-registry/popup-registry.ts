/**
 * Popup Registry — anchor-positioned 弹层注册中心(L5-B3.4)
 *
 * 跟 4 大 menu 的对比:
 * - context-menu / handle-menu / slash-menu:items 列表 + binding 渲染
 * - popup:整个 React 组件由注册者提供,binding 只管 portal + 位置
 *
 * 用法:
 * ```ts
 * popupRegistry.register({
 *   id: 'note-view.popup.link',
 *   view: 'note-view',
 *   Component: LinkPanel,
 * });
 *
 * popupController.show('note-view.popup.link', anchorEl);
 * ```
 */

import type { PopupItem } from './popup-types';

class PopupRegistry {
  private items: Map<string, PopupItem> = new Map();
  private listeners: Set<() => void> = new Set();

  register(item: PopupItem): void {
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

  get(id: string): PopupItem | undefined {
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

export const popupRegistry = new PopupRegistry();
