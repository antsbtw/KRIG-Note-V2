/**
 * ContextMenuRegistry — 右键菜单注册中心
 *
 * 按 charter § 1.4 + view-hierarchy-v2.md § 6:
 * - 所有 ContextMenu 都归 Workspace,无 scope 字段
 * - 默认 view 为 undefined(全局,所有 view 都显示)
 * - capability 注册时不指定 view(Q6=A:全局过滤)
 *
 * enabledWhen 重构(handoff: docs/tasks/context-menu-registry-handoff.md):
 * - L4 不再硬编码 if 链,统一委托 enabledWhenRegistry.eval
 * - builtin('always' / 'has-selection' / 'is-editable')在 enabledWhenRegistry 构造时挂
 * - 业务谓词(has-link / has-marks / has-block-selection / has-thought / ...)由
 *   各 capability / view 自行注册
 */

import type { ContextMenuItem, ContextInfo } from './context-menu-types';
import { enabledWhenRegistry } from '../enabled-when-registry';

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
        // enabledWhen 过滤:不设 → 默认显示;设了 → 走 enabledWhenRegistry
        if (item.enabledWhen === undefined) return true;
        return enabledWhenRegistry.eval(item.enabledWhen, context);
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
