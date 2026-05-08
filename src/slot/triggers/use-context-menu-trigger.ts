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
import { selection } from '@capabilities/selection';

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

      // 检测当前选区状态
      const domSel = window.getSelection();
      const hasSelection = !!domSel && !domSel.isCollapsed;
      const isEditable = !!target && (target.isContentEditable || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA');

      // L5-B3.15:从 selection capability 读 activeMarks 判 hasLink
      // (driver 在选区变化时已 emit;capability 缓存 last value,右键时同步读)
      const selPayload = selection.api.getCurrent();
      const hasLink = !!selPayload?.activeMarks?.includes('link');

      const context: ContextInfo = {
        hasSelection,
        isEditable,
        hasLink,
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
