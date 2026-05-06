/**
 * useSlashTrigger — slash menu 全局键盘
 *
 * L5-B3.1:slash 显示由 driver PM Plugin(buildSlashPlugin)触发;
 *         hook 只负责 ↑↓ Enter Esc 键盘导航(由 SlashMenuBinding 自管 selectedIdx —
 *         hook 仅监听 Esc 关菜单 + 防止键盘 fallthrough 到编辑器)。
 *
 * 见 docs/RefactorV2/stages/L5B3.1-interactions-design.md § 4.1。
 */

import { useEffect, type RefObject } from 'react';
import { slashMenuController } from './slash-menu-controller';

export { slashMenuController };

export function useSlashTrigger(_elementRef: RefObject<HTMLElement | null>, viewId: string | null): void {
  useEffect(() => {
    if (!viewId) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && slashMenuController.getState().visible) {
        slashMenuController.hide();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [viewId]);
}
