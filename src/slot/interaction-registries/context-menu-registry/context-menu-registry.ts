/**
 * ContextMenuRegistry — 右键菜单注册中心
 *
 * 按 charter § 1.4 + view-hierarchy-v2.md § 6:
 * - 所有 ContextMenu 都归 Workspace,无 scope 字段
 * - 默认 view 为 undefined(全局,所有 view 都显示)
 * - capability 注册时不指定 view(Q6=A:全局过滤)
 */

import type { ContextMenuItem, ContextInfo } from './context-menu-types';

class ContextMenuRegistry {
  private items: ContextMenuItem[] = [];
  private listeners: Set<() => void> = new Set();

  register(items: ContextMenuItem[]): void {
    this.items.push(...items);
    this.notify();
  }

  /** 取消注册某 view 的所有 items(view 关闭时清理)*/
  unregisterByView(viewId: string): void {
    this.items = this.items.filter((item) => item.view !== viewId);
    this.notify();
  }

  /** 按当前活跃 view + context 过滤 + 排序 */
  getItemsForContext(viewId: string, context: ContextInfo): ContextMenuItem[] {
    return this.items
      .filter((item) => {
        // view 过滤:undefined = 全局,或匹配当前 view
        if (item.view !== undefined && item.view !== viewId) return false;
        // enabledWhen 过滤
        if (item.enabledWhen === 'has-selection' && !context.hasSelection) return false;
        if (item.enabledWhen === 'is-editable' && !context.isEditable) return false;
        // L5-B3.15:has-link 条件项(如"移除链接")— 选区无 link mark 时隐藏
        if (item.enabledWhen === 'has-link' && !context.hasLink) return false;
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

export const contextMenuRegistry = new ContextMenuRegistry();
