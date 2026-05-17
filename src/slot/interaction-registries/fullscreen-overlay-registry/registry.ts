/**
 * Fullscreen Overlay Registry — app-scoped 全屏 overlay 注册中心
 *
 * 与 popup-registry 对比:
 * - popup-registry:view-scoped popup,Component 接 PopupCloseProps,
 *   定位锚定 anchorEl
 * - fullscreen-overlay-registry:app-scoped 全屏,Component 接
 *   FullscreenOverlayCloseProps,无 anchor,撑满 viewport
 *
 * 用法:
 * ```ts
 * fullscreenOverlayRegistry.register({
 *   id: 'text-editing.fullscreen.mermaid',
 *   Component: MermaidFullscreenPanel,
 * });
 *
 * fullscreenOverlayController.show('text-editing.fullscreen.mermaid');
 * ```
 *
 * payload 通过模块级 SSOT(参考 [[table/menu-context]] 模式)而非 controller
 * 传递 — 同一时刻只一个 overlay 可见,模块级单变量不会撞。
 */

import type { FullscreenOverlayItem } from './types';

class FullscreenOverlayRegistry {
  private items: Map<string, FullscreenOverlayItem> = new Map();
  private listeners: Set<() => void> = new Set();

  register(item: FullscreenOverlayItem): void {
    this.items.set(item.id, item);
    this.notify();
  }

  unregister(id: string): void {
    if (this.items.delete(id)) this.notify();
  }

  get(id: string): FullscreenOverlayItem | undefined {
    return this.items.get(id);
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  get count(): number {
    return this.items.size;
  }

  private notify(): void {
    this.listeners.forEach((l) => l());
  }
}

export const fullscreenOverlayRegistry = new FullscreenOverlayRegistry();
