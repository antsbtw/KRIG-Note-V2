/**
 * NavSideRegistry — NavSide 内容注册中心
 *
 * V1 navside/registry.ts 沿用核心思路,改为按 view 注册(V2 取消 WorkMode)。
 */

import type { NavSideContent } from './nav-side-types';

class NavSideRegistry {
  private contents: Map<string, NavSideContent> = new Map();
  private listeners: Set<() => void> = new Set();

  register(content: NavSideContent): void {
    this.contents.set(content.view, content);
    this.notify();
  }

  unregisterByView(viewId: string): void {
    this.contents.delete(viewId);
    this.notify();
  }

  /** 按当前活跃 view 获取内容 */
  getContentForView(viewId: string): NavSideContent | undefined {
    return this.contents.get(viewId);
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    this.listeners.forEach((l) => l());
  }

  get count(): number {
    return this.contents.size;
  }
}

export const navSideRegistry = new NavSideRegistry();
