/**
 * useHandleTrigger — 监听全局 mousedown 关闭 handle menu
 *
 * L5-B3.1:handle 触发(显示 ⋮⋮)由 driver block-handle plugin 实施;
 *         hook 只负责"点击外部关菜单"行为。
 *
 * 见 docs/RefactorV2/stages/L5B3.1-interactions-design.md § 4.2。
 */

import { useEffect, type RefObject } from 'react';
import { handleMenuController } from './handle-menu-controller';

export { handleMenuController };

export function useHandleTrigger(_elementRef: RefObject<HTMLElement | null>, viewId: string | null): void {
  useEffect(() => {
    if (!viewId) return;
    const onMouseDown = (e: MouseEvent) => {
      if (!handleMenuController.getState().visible) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest('.krig-handle-menu')) return;
      if (target?.closest('.krig-block-handle')) return;
      handleMenuController.hide();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && handleMenuController.getState().visible) {
        handleMenuController.hide();
      }
    };
    window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [viewId]);
}
