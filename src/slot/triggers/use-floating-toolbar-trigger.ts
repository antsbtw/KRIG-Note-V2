/**
 * useFloatingToolbarTrigger — 监听 Esc 关 floating-toolbar
 *
 * L5-B3.1:floating-toolbar 显示由 driver 内部订阅 selection capability 触发;
 *         hook 只负责"Esc 关菜单"行为(visibility 跟选区联动 — 用户清空选区自然隐)。
 *
 * 见 docs/RefactorV2/stages/L5B3.1-interactions-design.md § 4.3。
 */

import { useEffect } from 'react';
import { floatingToolbarController } from './floating-toolbar-controller';

export { floatingToolbarController };

export function useFloatingToolbarTrigger(viewId: string | null): void {
  useEffect(() => {
    if (!viewId) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && floatingToolbarController.getState().visible) {
        floatingToolbarController.hide();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [viewId]);
}
