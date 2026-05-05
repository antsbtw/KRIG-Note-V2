/**
 * ViewTypeRegistry — view 类型注册中心
 *
 * 按 charter § 1.4 + § 1.2:
 * - L5 view 通过 registerView({...}) 注册
 * - 注册时自动把 contextMenu / toolbar / slash / handle / floatingToolbar
 *   子字段拆分到对应 Registry(view 字段补为 view ID)
 */

import type { ViewDefinition } from './view-definition';
import { contextMenuRegistry } from '../interaction-registries/context-menu-registry/context-menu-registry';
import { toolbarRegistry } from '../toolbar-registry/toolbar-registry';
import { slashRegistry } from '../interaction-registries/slash-registry/slash-registry';
import { handleRegistry } from '../interaction-registries/handle-registry/handle-registry';
import { floatingToolbarRegistry } from '../interaction-registries/floating-toolbar-registry/floating-toolbar-registry';

class ViewTypeRegistry {
  private views: Map<string, ViewDefinition> = new Map();

  /**
   * 注册 view + 自动拆分子字段到对应 Registry
   */
  register(def: ViewDefinition): void {
    if (this.views.has(def.id)) {
      console.warn(`[L4] ViewTypeRegistry: '${def.id}' already registered, overwriting`);
      // 取消旧注册的所有 Registry 子项
      this.unregisterRegistries(def.id);
    }
    this.views.set(def.id, def);
    // 自动拆分到对应 Registry
    this.distributeToRegistries(def);
  }

  /** 取消注册 view + 清理所有 Registry 子项 */
  unregister(id: string): void {
    if (!this.views.has(id)) return;
    this.unregisterRegistries(id);
    this.views.delete(id);
  }

  get(id: string): ViewDefinition | undefined {
    return this.views.get(id);
  }

  getAll(): ViewDefinition[] {
    return Array.from(this.views.values());
  }

  get count(): number {
    return this.views.size;
  }

  /** 分发子字段到对应 Registry */
  private distributeToRegistries(def: ViewDefinition): void {
    if (def.contextMenu) {
      contextMenuRegistry.register(def.contextMenu.map((item) => ({ ...item, view: def.id })));
    }
    if (def.toolbar) {
      toolbarRegistry.register(def.toolbar.map((item) => ({ ...item, view: def.id })));
    }
    if (def.slash) {
      slashRegistry.register(def.slash.map((item) => ({ ...item, view: def.id })));
    }
    if (def.handle) {
      handleRegistry.register(def.handle.map((item) => ({ ...item, view: def.id })));
    }
    if (def.floatingToolbar) {
      floatingToolbarRegistry.register(def.floatingToolbar.map((item) => ({ ...item, view: def.id })));
    }
  }

  /** 取消该 view 的所有 Registry 子项 */
  private unregisterRegistries(id: string): void {
    contextMenuRegistry.unregisterByView(id);
    toolbarRegistry.unregisterByView(id);
    slashRegistry.unregisterByView(id);
    handleRegistry.unregisterByView(id);
    floatingToolbarRegistry.unregisterByView(id);
  }
}

export const viewTypeRegistry = new ViewTypeRegistry();

/** 公开 API:L5 view 通过此函数注册 */
export function registerView(def: ViewDefinition): void {
  viewTypeRegistry.register(def);
}
