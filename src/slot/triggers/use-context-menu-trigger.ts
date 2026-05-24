/**
 * useContextMenuTrigger — 监听 Slot 内右键 → 显示 ContextMenuBinding
 *
 * 由 L4 / L5 view mount 时调用,view 不写触发逻辑(charter § 1.4)。
 *
 * 使用:
 *   useContextMenuTrigger(slotElementRef, 'note');
 *
 * L4 重构(handoff: docs/tasks/context-menu-registry-handoff.md):
 * - L4 字面 0 业务字段(无 thought / pmInstanceId / hasLink / hasMarks 等)
 * - 业务字段通过 contextInfoProviderRegistry.collect(target) 汇总到 ContextInfo.custom
 * - 各 capability / view 自行注册 provider(text-editing / thought / 未来 ebook)
 */

import { useEffect, RefObject } from 'react';
import { contextMenuController } from './context-menu-controller';
import { floatingToolbarController } from './floating-toolbar-controller';
import { contextMenuRegistry } from '../interaction-registries/context-menu-registry/context-menu-registry';
import { contextInfoProviderRegistry } from '../interaction-registries/context-info-provider-registry';
import type { ContextInfo } from '../interaction-registries/context-menu-registry/context-menu-types';

export function useContextMenuTrigger(
  elementRef: RefObject<HTMLElement | null>,
  viewId: string | null,
): void {
  useEffect(() => {
    const el = elementRef.current;
    if (!el || !viewId) return;

    const handleContextMenu = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;

      // 自治区域:某些容器自己处理右键(如 FolderTree),L4 不接管
      if (target?.closest('[data-krig-context-menu-handled]')) return;

      // base 字段:L4 通用 DOM 概念
      const domSel = window.getSelection();
      const hasSelection = !!domSel && !domSel.isCollapsed;
      const isEditable =
        !!target &&
        (target.isContentEditable ||
          target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA');

      // 业务字段:遍历所有 provider(text-editing / thought / 未来 ebook 等)→ custom
      const custom = target
        ? contextInfoProviderRegistry.collect(target)
        : {};

      const context: ContextInfo = {
        hasSelection,
        isEditable,
        x: e.clientX,
        y: e.clientY,
        custom,
      };

      // 只有当有匹配的菜单项才阻止默认右键菜单
      const items = contextMenuRegistry.getItemsForContext(viewId, context);
      if (items.length > 0) {
        e.preventDefault();
        // 互斥:floating toolbar 跟 context menu 不同时出现(右键既有 cm 项就关浮条)
        floatingToolbarController.hide();
        contextMenuController.show(e.clientX, e.clientY, viewId, context);
      }
    };

    const handleClickOutside = (e: MouseEvent) => {
      const state = contextMenuController.getState();
      if (!state.visible) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest('.krig-context-menu')) return;
      contextMenuController.hide();
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') contextMenuController.hide();
    };

    el.addEventListener('contextmenu', handleContextMenu);
    window.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('keydown', handleEscape);

    return () => {
      el.removeEventListener('contextmenu', handleContextMenu);
      window.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('keydown', handleEscape);
    };
  }, [elementRef, viewId]);
}
