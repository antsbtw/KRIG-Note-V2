/**
 * floating-toolbar driver source
 *
 * Q1=A:driver 内部监听 selection capability,非空选区(text 类型)→ floatingToolbarController.show
 *
 * 见 docs/RefactorV2/stages/L5B3.1-interactions-design.md § 3.3。
 */

import type { EditorView } from 'prosemirror-view';
import { selection } from '@capabilities/selection';
import { floatingToolbarController } from '@slot/triggers/floating-toolbar-controller';

/**
 * driver Host mount 时调,返回 unregister 函数
 *
 * @param view EditorView 实例
 * @param viewId NoteView 的 view-id('note-view')— 给 controller 用
 * @param instanceId driver 实例 id(== workspaceId)— 用于过滤 selection 事件
 */
export function setupFloatingToolbarTrigger(
  view: EditorView,
  viewId: string,
  instanceId: string,
): () => void {
  const expectedSource = `text-editing-driver:${instanceId}`;

  const unsub = selection.subscribe((payload) => {
    if (payload.source !== expectedSource) return;
    if (payload.kind !== 'text') return;
    if (payload.isEmpty) {
      floatingToolbarController.hide();
      return;
    }
    if (view.isDestroyed) return;
    // 计算选区屏幕坐标(选区上方居中)
    // FLOATING_TOOLBAR_HEIGHT 跟 overlay-bindings.css .krig-floating-toolbar 实际高度一致(行高+padding+border)
    // 用估算值是因为浮条 mount 前算不出真实高度,微调 ±2px 用户感知不到
    const FLOATING_TOOLBAR_HEIGHT = 38;
    const GAP = 8;
    try {
      const sel = view.state.selection;
      const fromCoords = view.coordsAtPos(sel.from);
      const toCoords = view.coordsAtPos(sel.to);
      const x = (fromCoords.left + toCoords.right) / 2;
      const selectionTop = Math.min(fromCoords.top, toCoords.top);
      // 浮条 top = 选区 top - 浮条高度 - 间距(让浮条**底部**在选区上方 GAP px)
      const y = selectionTop - FLOATING_TOOLBAR_HEIGHT - GAP;
      floatingToolbarController.show(x, y, viewId);
    } catch {
      // 坐标算不出来时静默(选区跨多行可能瞬态)
    }
  });

  return () => {
    unsub();
    if (floatingToolbarController.getState().viewId === viewId) {
      floatingToolbarController.hide();
    }
  };
}
