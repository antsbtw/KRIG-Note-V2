/**
 * useContextMenuTrigger — 监听 Slot 内右键 → 显示 ContextMenuBinding
 *
 * 由 L4 / L5 view mount 时调用,view 不写触发逻辑(charter § 1.4)。
 *
 * 使用:
 *   useContextMenuTrigger(slotElementRef, 'note');
 */

import { useEffect, RefObject } from 'react';
import { contextMenuController } from './context-menu-controller';
import { contextMenuRegistry } from '../interaction-registries/context-menu-registry/context-menu-registry';
import type { ContextInfo } from '../interaction-registries/context-menu-registry/context-menu-types';

export function useContextMenuTrigger(
  elementRef: RefObject<HTMLElement | null>,
  viewId: string,
): void {
  useEffect(() => {
    const el = elementRef.current;
    if (!el) return;

    const handleContextMenu = (e: MouseEvent) => {
      // 检测当前选区状态
      const selection = window.getSelection();
      const hasSelection = !!selection && !selection.isCollapsed;
      const target = e.target as HTMLElement | null;
      const isEditable = !!target && (target.isContentEditable || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA');

      const context: ContextInfo = {
        hasSelection,
        isEditable,
        x: e.clientX,
        y: e.clientY,
      };

      // 只有当有匹配的菜单项才阻止默认右键菜单
      const items = contextMenuRegistry.getItemsForContext(viewId, context);
      if (items.length > 0) {
        e.preventDefault();
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
