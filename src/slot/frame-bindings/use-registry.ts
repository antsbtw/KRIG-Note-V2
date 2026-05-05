/**
 * useRegistry hooks — 让 React 组件订阅 Registry 状态变化
 *
 * 关键设计(避免 L3 同样的 useSyncExternalStore 无限循环 bug):
 * - 只用 hook 订阅"已稳定快照"(如 NavSide / Toolbar 内容,数据稳定)
 * - 触发型查询(右键 / Slash 等动态过滤)不用 hook,binding 直接调 Registry.getItemsForX 同步获取
 *
 * V1 教训(L3 阶段已遇到):
 * useSyncExternalStore getSnapshot 必须返回 === 引用,否则无限循环。
 */

import { useSyncExternalStore } from 'react';
import { overlayRegistry } from '../interaction-registries/overlay-registry/overlay-registry';
import { navSideRegistry } from '../nav-side-registry/nav-side-registry';
import { toolbarRegistry } from '../toolbar-registry/toolbar-registry';
import type { OverlayDefinition } from '../interaction-registries/overlay-registry/overlay-types';
import type { NavSideContent } from '../nav-side-registry/nav-side-types';
import type { ToolbarItem } from '../toolbar-registry/toolbar-types';

/**
 * 订阅 NavSide 内容变化(触发重渲)
 *
 * NavSideRegistry 用 Map<view, content>,Map.get 返回稳定引用 → 安全。
 */
export function useNavSideContent(viewId: string): NavSideContent | undefined {
  return useSyncExternalStore(
    (cb) => navSideRegistry.subscribe(cb),
    () => navSideRegistry.getContentForView(viewId),
  );
}

/**
 * 订阅活跃 Overlay 变化
 *
 * 返回单一对象引用 / null,稳定。
 */
export function useActiveOverlay(viewId: string): OverlayDefinition | null {
  return useSyncExternalStore(
    (cb) => overlayRegistry.subscribe(cb),
    () => overlayRegistry.getActive(viewId),
  );
}

/**
 * 订阅 ToolbarRegistry 注册项总数变化(触发重渲;具体 items 由 binding 调 getItemsForView)
 *
 * 避免缓存数组的复杂度 — Toolbar binding 在 render 时直接 getItemsForView。
 */
export function useToolbarVersion(): number {
  // 用 count 作为版本号,数据变化时 count 变 / 引用变(notify 触发)
  return useSyncExternalStore(
    (cb) => toolbarRegistry.subscribe(cb),
    () => toolbarRegistry.count,
  );
}

/** 同上 — 让组件订阅 ContextMenu 注册变化 */
import { contextMenuRegistry } from '../interaction-registries/context-menu-registry/context-menu-registry';
import { slashRegistry } from '../interaction-registries/slash-registry/slash-registry';
import { handleRegistry } from '../interaction-registries/handle-registry/handle-registry';
import { floatingToolbarRegistry } from '../interaction-registries/floating-toolbar-registry/floating-toolbar-registry';

export function useContextMenuVersion(): number {
  return useSyncExternalStore(
    (cb) => contextMenuRegistry.subscribe(cb),
    () => contextMenuRegistry.count,
  );
}

export function useSlashVersion(): number {
  return useSyncExternalStore(
    (cb) => slashRegistry.subscribe(cb),
    () => slashRegistry.count,
  );
}

export function useHandleVersion(): number {
  return useSyncExternalStore(
    (cb) => handleRegistry.subscribe(cb),
    () => handleRegistry.count,
  );
}

export function useFloatingToolbarVersion(): number {
  return useSyncExternalStore(
    (cb) => floatingToolbarRegistry.subscribe(cb),
    () => floatingToolbarRegistry.count,
  );
}

export type { ToolbarItem };
