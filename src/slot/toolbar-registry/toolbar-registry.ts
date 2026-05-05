/**
 * ToolbarRegistry — 顶部 Toolbar 内容注册中心
 */

import type { ToolbarItem } from './toolbar-types';

class ToolbarRegistry {
  private items: ToolbarItem[] = [];
  private listeners: Set<() => void> = new Set();

  register(items: ToolbarItem[]): void {
    this.items.push(...items);
    this.notify();
  }

  unregisterByView(viewId: string): void {
    this.items = this.items.filter((item) => item.view !== viewId);
    this.notify();
  }

  /** 按 view + group 过滤 */
  getItemsForView(viewId: string, group?: 'left' | 'center' | 'right'): ToolbarItem[] {
    return this.items
      .filter((item) => {
        if (item.view !== undefined && item.view !== viewId) return false;
        if (group !== undefined && item.group !== group) return false;
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

export const toolbarRegistry = new ToolbarRegistry();
