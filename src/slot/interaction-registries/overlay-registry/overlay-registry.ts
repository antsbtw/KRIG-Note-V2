/**
 * OverlayRegistry — 通用浮层注册中心(帮助 / dialog / 进度 等)
 *
 * 按 view-hierarchy-v2.md § 6:所有 Overlay 都归 Workspace,无 scope 字段。
 * V1 完全没有此 Registry,V2 新增。
 *
 * 使用模式:
 * 1. capability / view 注册 Overlay 定义 + 触发命令
 * 2. 用户调用 commandRegistry.execute(triggerCommand) → 显示对应 Overlay
 */

import type { OverlayDefinition } from './overlay-types';

class OverlayRegistry {
  private definitions: Map<string, OverlayDefinition> = new Map();
  private activeOverlay: string | null = null;
  private listeners: Set<() => void> = new Set();

  register(def: OverlayDefinition): void {
    if (this.definitions.has(def.id)) {
      console.warn(`[L4] OverlayRegistry: '${def.id}' already registered, overwriting`);
    }
    this.definitions.set(def.id, def);
    this.notify();
  }

  unregisterByView(viewId: string): void {
    for (const [id, def] of this.definitions) {
      if (def.view === viewId) {
        this.definitions.delete(id);
        if (this.activeOverlay === id) this.activeOverlay = null;
      }
    }
    this.notify();
  }

  /** 显示 Overlay */
  show(id: string): void {
    if (!this.definitions.has(id)) {
      console.warn(`[L4] OverlayRegistry: cannot show '${id}' — not registered`);
      return;
    }
    this.activeOverlay = id;
    this.notify();
  }

  /** 关闭当前 Overlay */
  hide(): void {
    this.activeOverlay = null;
    this.notify();
  }

  /** 获取当前活跃 Overlay 定义(给 frame-binding 渲染用)*/
  getActive(viewId: string): OverlayDefinition | null {
    if (!this.activeOverlay) return null;
    const def = this.definitions.get(this.activeOverlay);
    if (!def) return null;
    if (def.view !== undefined && def.view !== viewId) return null;
    return def;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    this.listeners.forEach((l) => l());
  }

  get count(): number {
    return this.definitions.size;
  }
}

export const overlayRegistry = new OverlayRegistry();
