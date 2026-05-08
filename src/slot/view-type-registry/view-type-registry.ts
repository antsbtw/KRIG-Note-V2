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
import { capabilityRegistry } from '../capability-registry/capability-registry';
import { keymapRegistry } from '../keymap-registry/keymap-registry';

class ViewTypeRegistry {
  private views: Map<string, ViewDefinition> = new Map();
  private listeners: Set<() => void> = new Set();
  /** ViewSwitcher 用的有序快照缓存(useSyncExternalStore 稳定引用)*/
  private cachedNavSideTabs: ViewDefinition[] | null = null;
  /** SlotArea 用的全集快照缓存(同上,L3.5 加)*/
  private cachedAll: ViewDefinition[] | null = null;

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
    // Wave 1:install 列表校验(charter § 1.2 — 让违规可见,不阻塞)
    this.validateInstall(def);
    // 自动拆分到对应 Registry
    this.distributeToRegistries(def);
    this.notify();
  }

  /**
   * 校验 install 列表里每个 id 都已注册到 capabilityRegistry。
   *
   * W5 严格收尾:install 列表 0 driver id(KNOWN_DRIVER_IDS 整体淘汰),
   * 缺失 → console.warn(不抛错,避免启动顺序敏感)。
   */
  private validateInstall(def: ViewDefinition): void {
    if (!def.install || def.install.length === 0) return;
    const missing = def.install.filter((id) => !capabilityRegistry.has(id));
    if (missing.length === 0) return;
    console.warn(
      `[L4] viewTypeRegistry: view '${def.id}' install ids 未在 capabilityRegistry 中: ${missing.join(', ')}\n` +
        `(charter § 1.2:install 项必须是已注册的 capability id)`,
    );
  }

  /** 取消注册 view + 清理所有 Registry 子项 */
  unregister(id: string): void {
    if (!this.views.has(id)) return;
    this.unregisterRegistries(id);
    this.views.delete(id);
    this.notify();
  }

  get(id: string): ViewDefinition | undefined {
    return this.views.get(id);
  }

  /**
   * 全集 — useSyncExternalStore 稳定引用(L3.5 SlotArea 用)。
   *
   * 数据未变时返回同一数组引用;notify() 时失效缓存。
   */
  getAll(): ViewDefinition[] {
    if (this.cachedAll === null) {
      this.cachedAll = Array.from(this.views.values());
    }
    return this.cachedAll;
  }

  /**
   * ViewSwitcher 用 — 取所有声明 navSideTab 的 view,按 order 升序。
   *
   * 返回缓存数组(useSyncExternalStore 稳定引用),notify() 失效。
   */
  getAllForNavSide(): ViewDefinition[] {
    if (this.cachedNavSideTabs === null) {
      this.cachedNavSideTabs = Array.from(this.views.values())
        .filter((v) => v.navSideTab !== undefined)
        .sort((a, b) => (a.navSideTab!.order - b.navSideTab!.order));
    }
    return this.cachedNavSideTabs;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    this.cachedNavSideTabs = null;
    this.cachedAll = null;
    this.listeners.forEach((l) => l());
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
    // W4.1:keymap 不需要补 view 字段(注册按 viewId 索引,见 KeymapRegistry.register 签名)
    if (def.keymap) {
      keymapRegistry.register(def.id, def.keymap);
    }
  }

  /** 取消该 view 的所有 Registry 子项 */
  private unregisterRegistries(id: string): void {
    contextMenuRegistry.unregisterByView(id);
    toolbarRegistry.unregisterByView(id);
    slashRegistry.unregisterByView(id);
    handleRegistry.unregisterByView(id);
    floatingToolbarRegistry.unregisterByView(id);
    keymapRegistry.unregisterByView(id);
  }
}

export const viewTypeRegistry = new ViewTypeRegistry();

/** 公开 API:L5 view 通过此函数注册 */
export function registerView(def: ViewDefinition): void {
  viewTypeRegistry.register(def);
}
