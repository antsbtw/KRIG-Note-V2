/**
 * FloatingToolbarRegistry — 选区上方浮动工具条注册中心
 */

import type { FloatingToolbarItem } from './floating-toolbar-types';

class FloatingToolbarRegistry {
  private items: FloatingToolbarItem[] = [];
  private listeners: Set<() => void> = new Set();

  register(items: FloatingToolbarItem[]): void {
    this.items.push(...items);
    this.notify();
  }

  unregisterByView(viewId: string): void {
    this.items = this.items.filter((item) => item.view !== viewId);
    this.notify();
  }

  /**
   * 按当前 viewId 过滤可见条目:
   * - scope='global':所有 view 都可见(L5-G4.5,PM 编辑通用条目)
   * - scope='view' 缺省:仅 item.view === viewId 时可见
   *   (item.view === undefined 历史兼容:也算 view-scoped 但匹配所有 — 见旧测试)
   */
  getItemsForView(viewId: string): FloatingToolbarItem[] {
    return this.items
      .filter((item) => {
        if (item.scope === 'global') return true;
        return item.view === undefined || item.view === viewId;
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

export const floatingToolbarRegistry = new FloatingToolbarRegistry();
