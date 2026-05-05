/**
 * HandleRegistry — Handle(块手柄)菜单注册中心
 */

import type { HandleItem } from './handle-types';

class HandleRegistry {
  private items: HandleItem[] = [];
  private listeners: Set<() => void> = new Set();

  register(items: HandleItem[]): void {
    this.items.push(...items);
    this.notify();
  }

  unregisterByView(viewId: string): void {
    this.items = this.items.filter((item) => item.view !== viewId);
    this.notify();
  }

  /** 按 view + blockType 过滤 */
  getItemsForBlock(viewId: string, blockType?: string): HandleItem[] {
    return this.items
      .filter((item) => {
        if (item.view !== undefined && item.view !== viewId) return false;
        if (item.blockType !== undefined && item.blockType !== blockType) return false;
        return true;
      })
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    this.listeners.forEach((l) => l());
  }

  get count(): number {
    return this.items.length;
  }
}

export const handleRegistry = new HandleRegistry();
