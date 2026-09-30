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
  /** SlotPicker 用的有序快照缓存(navSideTab ∪ slotPickerEntry)*/
  private cachedSlotPicker: ViewDefinition[] | null = null;

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

  /**
   * SlotPicker 用 — navSideTab 或 slotPickerEntry 二者有其一的 view,按 order 升序
   * (navSideTab.order 优先,slotPickerEntry-only 的 view 用自己的 order)。
   *
   * 与 getAllForNavSide 的差异:多出 slotPickerEntry-only 的 hidden view
   * (如 thought-view — 不占 NavSide 切换条,但可被手动召回右槽)。
   */
  getAllForSlotPicker(): ViewDefinition[] {
    if (this.cachedSlotPicker === null) {
      this.cachedSlotPicker = Array.from(this.views.values())
        .filter((v) => v.navSideTab !== undefined || v.slotPickerEntry !== undefined)
        .sort(
          (a, b) =>
            (a.navSideTab?.order ?? a.slotPickerEntry!.order) -
            (b.navSideTab?.order ?? b.slotPickerEntry!.order),
        );
    }
    return this.cachedSlotPicker;
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
    this.cachedSlotPicker = null;
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
    // ⭐ commands 只登记不执行 —— 它要等本窗口真 wsId(见 ViewDefinition.commands)
    if (def.commands) {
      this.commandRegistrars.set(def.id, def.commands);
      // ⚠️ 若 wsId 已经到了(view 晚注册),当场补跑一次,否则这个 view 的命令
      // 会**静默没有** —— onMyWsIdReady 是一次性的,晚订阅收不到第二次。
      if (this.readyWsId !== null) def.commands(this.readyWsId);
    }
  }

  /**
   * ⭐ 各 view 登记的命令注册器(id → registrar)。
   * 只存不跑:命令注册要本窗口真 wsId,而那是异步到的。
   */
  private commandRegistrars = new Map<string, (wsId: string) => void>();

  /** 本窗口 wsId 一旦就绪就记下 —— 给「晚注册的 view」补跑用 */
  private readyWsId: string | null = null;

  /**
   * ⭐ renderer 在 `onMyWsIdReady` 里调一次:把已登记的命令注册器全跑掉。
   *
   * 之后再注册的 view 会在 `distributeToRegistries` 里当场补跑,
   * 所以**先注册**和**后注册**两种顺序都不会漏。
   */
  runCommandRegistrars(wsId: string): void {
    this.readyWsId = wsId;
    this.commandRegistrars.forEach((run) => run(wsId));
  }

  /** 取消该 view 的所有 Registry 子项 */
  private unregisterRegistries(id: string): void {
    this.commandRegistrars.delete(id);
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

/**
 * ⭐ 跑掉所有 view 登记的命令注册器(renderer 在 onMyWsIdReady 里调一次)。
 *
 * 在此之前 renderer 要为每个模块写**两行**(具名 import + 显式调用);
 * 现在模块在自己的 self-register 里填 `commands` 字段即可,
 * 卸载该模块 = 删掉 renderer 里那一行 `import '@views/xxx'`。
 */
export function runViewCommandRegistrars(wsId: string): void {
  viewTypeRegistry.runCommandRegistrars(wsId);
}
