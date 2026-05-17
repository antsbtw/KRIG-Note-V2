/**
 * Fullscreen Overlay Binding — app-scoped 全屏覆盖层渲染
 *
 * 职责:
 * - 订阅 fullscreenOverlayController + fullscreenOverlayRegistry
 * - active 时撑满 viewport 渲染注册项 Component
 * - 监听 Esc 键关闭(直接调 controller.hide(),Component cleanup 在 unmount 时跑)
 *
 * 与 PopupBinding 的关键差异:
 * - 无 anchor 定位(没有 anchorRect),直接 position:fixed inset:0
 * - 无点外关闭(全屏无外)
 * - 无尺寸测量 / 位置翻转
 * - Component 接收 onClose(同 popup 契约)
 *
 * 挂点:由 FullscreenOverlayContainer 挂在 L2 Shell 内,与 WorkspaceContainer
 * 并列。本组件只渲染 active 状态,inactive 时返回 null(不占 DOM)。
 */

import { useEffect, useState } from 'react';
import { fullscreenOverlayController } from '@slot/triggers/fullscreen-overlay-controller';
import { fullscreenOverlayRegistry } from '@slot/interaction-registries/fullscreen-overlay-registry/registry';
import { useFullscreenOverlayVersion } from '@slot/frame-bindings/use-registry';

export function FullscreenOverlayBinding() {
  useFullscreenOverlayVersion();
  const [state, setState] = useState(fullscreenOverlayController.getState());

  // 订阅 controller 状态
  useEffect(() => {
    return fullscreenOverlayController.subscribe(() =>
      setState(fullscreenOverlayController.getState()),
    );
  }, []);

  // Esc 关闭(active 时挂 document keydown,inactive 时不挂)
  useEffect(() => {
    if (!state.visible) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        fullscreenOverlayController.hide();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [state.visible]);

  if (!state.visible || !state.activeId) return null;
  const item = fullscreenOverlayRegistry.get(state.activeId);
  if (!item) return null;

  const Component = item.Component;
  const handleClose = () => fullscreenOverlayController.hide();

  return (
    <div className="krig-fullscreen-overlay" role="dialog" aria-modal="true">
      <Component onClose={handleClose} />
    </div>
  );
}
