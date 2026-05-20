/**
 * Popup Binding — anchor-positioned 弹层渲染
 *
 * 职责:
 * - 订阅 popupController + popupRegistry
 * - 计算 popup 位置(默认 anchor 下方,溢出时翻上方/夹紧边)
 * - 点外/Esc 关闭
 * - 渲染注册项的 Component(传 onClose)
 *
 * 跟 OverlayBinding 区别:
 * - OverlayBinding 是 backdrop 全屏 dialog
 * - PopupBinding 是 anchor 旁的弹层(对齐 V1 LinkPanel / ColorPicker 模式)
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { popupController } from '../triggers/popup-controller';
import { popupRegistry } from '../interaction-registries/popup-registry/popup-registry';
import { usePopupVersion } from './use-registry';

const VIEWPORT_MARGIN = 8;
const ANCHOR_GAP = 4;

export function PopupBinding() {
  usePopupVersion();
  const [state, setState] = useState(popupController.getState());
  const popupRef = useRef<HTMLDivElement | null>(null);

  const [pos, setPos] = useState<{ left: number; top: number; visible: boolean }>({
    left: 0,
    top: 0,
    visible: false,
  });

  // 订阅 controller 状态
  useEffect(() => {
    return popupController.subscribe(() => setState(popupController.getState()));
  }, []);

  // 测量 popup 尺寸 + 修正位置(anchor 下方为主,溢出翻上方)
  useLayoutEffect(() => {
    if (!state.visible || !state.anchorRect) {
      setPos((p) => ({ ...p, visible: false }));
      return;
    }
    const el = popupRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const anchor = state.anchorRect;

    // 默认 anchor 下方水平居中
    let left = anchor.left + anchor.width / 2 - rect.width / 2;
    if (left < VIEWPORT_MARGIN) left = VIEWPORT_MARGIN;
    if (left + rect.width > vw - VIEWPORT_MARGIN) {
      left = vw - rect.width - VIEWPORT_MARGIN;
    }

    let top = anchor.bottom + ANCHOR_GAP;
    // 下方放不下且上方更宽裕 → 翻到 anchor 上方
    if (top + rect.height > vh - VIEWPORT_MARGIN && anchor.top > vh - anchor.bottom) {
      top = anchor.top - rect.height - ANCHOR_GAP;
      if (top < VIEWPORT_MARGIN) top = VIEWPORT_MARGIN;
    }

    setPos({ left, top, visible: true });
  }, [state.visible, state.activeId, state.anchorRect]);

  // 点外关闭(挂在 document 上)
  useEffect(() => {
    if (!state.visible) return;
    const handler = (e: MouseEvent) => {
      const popupEl = popupRef.current;
      if (!popupEl) return;
      // 点击 popup 内部 → 不关
      if (popupEl.contains(e.target as Node)) return;
      // 点击 anchor 自己 → 让 anchor 自己处理(toggle)
      if (state.anchorRect) {
        const a = state.anchorRect;
        const x = e.clientX;
        const y = e.clientY;
        if (x >= a.left && x <= a.right && y >= a.top && y <= a.bottom) return;
      }
      popupController.hide();
    };
    // 用 mousedown(在 click 之前触发)+ 微延迟避开当前事件
    const timer = window.setTimeout(() => {
      document.addEventListener('mousedown', handler);
    }, 0);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('mousedown', handler);
    };
  }, [state.visible, state.anchorRect]);

  // Esc 关闭
  useEffect(() => {
    if (!state.visible) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        popupController.hide();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [state.visible]);

  if (!state.visible || !state.activeId) return null;
  const item = popupRegistry.get(state.activeId);
  if (!item) return null;

  const Component = item.Component;
  const handleClose = () => popupController.hide();

  return (
    <div
      ref={popupRef}
      className="krig-popup"
      style={{
        position: 'fixed',
        left: pos.left,
        top: pos.top,
        visibility: pos.visible ? 'visible' : 'hidden',
        zIndex: 1000,
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {/* key 用 activeId-showSeq:同 id 重复 show 时也强制 remount,确保
          pending-context 模式(AskAIPanel useMemo consume)能读到新 ctx */}
      <Component key={`${state.activeId}-${state.showSeq}`} onClose={handleClose} />
    </div>
  );
}
