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
import { floatingToolbarController } from './floating-toolbar-controller';
import { contextMenuRegistry } from '../interaction-registries/context-menu-registry/context-menu-registry';
import type { ContextInfo } from '../interaction-registries/context-menu-registry/context-menu-types';
import { selection } from '@capabilities/selection';
import { getCapabilityApi } from '@slot/capability-registry/get-capability-api';
import type { TextEditingApi } from '@capabilities/text-editing/types';

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

      // L5-B3.15:hasLink 双重判定 — 用户在 link 内右键就该能"移除链接",
      //   不应该强迫先选中文字。两条互补路径:
      //
      // (1) DOM 路径:右键 target 的祖先有 <a href> 元素(link mark 渲染)
      //     — 光标在 link 文字内或贴在 link 边界都能命中,最可靠
      // (2) selection 路径:driver emit 的 activeMarks 含 'link'
      //     — 选区跨多个字符且至少一个位置覆盖 link 时命中(包含 collapsed 选区
      //       时 driver 自己已用 $from.marks() 处理)
      //
      // 任一命中即 hasLink = true(对齐"光标在链接里就能移除"的 UX 直觉)
      const inLinkDom = !!target?.closest('a[href]');
      const selPayload = selection.api.getCurrent();
      const inLinkSel = !!selPayload?.activeMarks?.includes('link');
      const hasLink = inLinkDom || inLinkSel;

      // "移除格式" 用 — 选区上覆盖至少一个 mark(光标态/无选区/空 mark 集都 false)
      const hasMarks = !!selPayload?.activeMarks && selPayload.activeMarks.length > 0;
      // "删除 Block" 用 — block/multi-block 选区(NodeSelection 或跨多 block 文本选区)
      const hasBlockSelection =
        selPayload?.kind === 'block' || selPayload?.kind === 'multi-block';

      // thought-view:点击位置 thought anchor 三态 DOM 检测
      //   - inline mark    → <span data-thought-id="...">
      //   - image attr     → <div data-thought-id="..." class="krig-image-block">
      //   - block frame    → 节点上挂 data-thought-block-id="..." (decoration)
      const thoughtEl = target?.closest('[data-thought-id], [data-thought-block-id]');
      const thoughtId =
        thoughtEl?.getAttribute('data-thought-id') ??
        thoughtEl?.getAttribute('data-thought-block-id') ??
        null;

      // thought-view:抓拍 focused PM 实例(右键事件触发那一刻 PM 还有焦点;
      // contextMenuController.show 之后 focus 转向菜单,getFocusedInstanceId
      // 会返 null)。命令 handler 从 controller.context.pmInstanceId 拿。
      // 诊断路径(getCapabilityApi):text-editing 未注册时退化 null,不破坏其他 view。
      const textEditing = getCapabilityApi<TextEditingApi>('text-editing');
      const pmInstanceId = textEditing?.instanceRegistry.getFocusedInstanceId() ?? null;

      const context: ContextInfo = {
        hasSelection,
        isEditable,
        hasLink,
        hasMarks,
        hasBlockSelection,
        thoughtId,
        pmInstanceId,
        x: e.clientX,
        y: e.clientY,
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
