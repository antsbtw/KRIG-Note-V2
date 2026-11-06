/**
 * 交互浮层组(右键 / Slash / Handle / 浮动工具条 / Popup)+ 「全屏是否打开」hook
 *
 * 2026-11-06 起:这组浮层**跟着可见的那一层走,任何时刻只挂一套**。
 * - 平时:挂在 Workspace 的 OverlayFrames 里(原样)
 * - 全屏覆盖层打开时:App 把整个 workspace 层 display:none,挂在里面的浮层跟着消失
 *   → 全屏里的编辑器(如 math-visual 说明卡片嵌的 note 编辑器)敲 / 弹不出菜单、
 *   选中文字没有浮动工具条。所以全屏打开时改由 FullscreenOverlayBinding 挂这组,
 *   Workspace 那组同时不渲染。
 *
 * ⚠️ 不能两边都挂:SlashMenuBinding 在 window capture 阶段监听 ↑↓/Enter,
 * 挂两套 = 一次回车执行两次命令。
 */

import { useEffect, useState } from 'react';
import { fullscreenOverlayController } from '../triggers/fullscreen-overlay-controller';
import { ContextMenuBinding } from './ContextMenuBinding';
import { SlashMenuBinding } from './SlashMenuBinding';
import { HandleMenuBinding } from './HandleMenuBinding';
import { FloatingToolbarBinding } from './FloatingToolbarBinding';
import { PopupBinding } from './PopupBinding';

/** 全屏覆盖层是否打开(订阅 fullscreenOverlayController) */
export function useFullscreenOverlayActive(): boolean {
  const [visible, setVisible] = useState(fullscreenOverlayController.getState().visible);
  useEffect(
    () => fullscreenOverlayController.subscribe(() => setVisible(fullscreenOverlayController.getState().visible)),
    [],
  );
  return visible;
}

export function InteractionOverlayBindings() {
  return (
    <>
      <ContextMenuBinding />
      <SlashMenuBinding />
      <HandleMenuBinding />
      <FloatingToolbarBinding />
      <PopupBinding />
    </>
  );
}
