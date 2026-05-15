/**
 * SlashRegistry — / 命令菜单注册中心
 */

import type { SlashItem } from './slash-types';

class SlashRegistry {
  private items: SlashItem[] = [];
  private listeners: Set<() => void> = new Set();

  register(items: SlashItem[]): void {
    this.items.push(...items);
    this.notify();
  }

  unregisterByView(viewId: string): void {
    this.items = this.items.filter((item) => item.view !== viewId);
    this.notify();
  }

  /**
   * 按当前活跃 view + 关键词过滤
   *
   * - item.view === viewId 命中
   * - item.view === undefined 历史兼容(也算 view-scoped 匹配所有)
   */
  getItemsForView(viewId: string, query: string = ''): SlashItem[] {
    const q = query.toLowerCase();
    return this.items
      .filter((item) => {
        const visible = item.view === undefined || item.view === viewId;
        if (!visible) return false;
        if (q) {
          const matchLabel = item.label.toLowerCase().includes(q);
          const matchKeywords = item.keywords?.some((k) => k.toLowerCase().includes(q));
          return matchLabel || matchKeywords;
        }
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

export const slashRegistry = new SlashRegistry();
