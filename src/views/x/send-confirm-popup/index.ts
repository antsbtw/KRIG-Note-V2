/**
 * XSendConfirmPanel 模块出口(X 集成 阶段 2.5-a)
 *
 * - registerXSendConfirmPopup():注册 popup 到 popupRegistry(由 views/x/index.ts 调一次)。
 * - showXSendConfirm(ctx):send-to-x 调,缓存 pending ctx + 弹窗(居中)。
 *
 * 定位:发到 X 由命令触发、无右键坐标(不同于 ask-ai 的右键 anchorX/Y),故用一个
 * 视口居中的 fake anchor —— PopupBinding 会在其下方居中展开(同 ask-ai 的 fake div 模式)。
 */

import { popupRegistry } from '@slot/interaction-registries/popup-registry/popup-registry';
import { popupController } from '@slot/triggers/popup-controller';
import { XSendConfirmPanel } from './XSendConfirmPanel';
import {
  X_SEND_CONFIRM_POPUP_ID,
  setPendingXSendConfirm,
  type XSendConfirmContext,
} from './panel-context';

export function registerXSendConfirmPopup(): void {
  // view: undefined → 全 view 可弹(发到 X 的触发可能来自 note-view 右键,弹窗渲染在
  // 全局 PopupFrame,不绑特定 view)。
  popupRegistry.register({
    id: X_SEND_CONFIRM_POPUP_ID,
    view: undefined,
    Component: XSendConfirmPanel,
    estimatedSize: { width: 360, height: 320 },
  });
}

/**
 * 弹「发到 X 确认」窗:缓存 pending ctx,在视口偏上居中位置弹出。
 *
 * fake anchor:1x1 透明 div(同 ask-ai-popup/index.ts 模式)。放在视口宽度中点、
 * 高度约 1/4 处 —— PopupBinding 默认 anchor 下方水平居中展开,故弹窗落在视口偏上居中。
 */
export function showXSendConfirm(ctx: XSendConfirmContext): void {
  setPendingXSendConfirm(ctx);
  const fake = document.createElement('div');
  fake.style.position = 'fixed';
  fake.style.left = `${Math.round(window.innerWidth / 2)}px`;
  fake.style.top = `${Math.round(window.innerHeight / 4)}px`;
  fake.style.width = '1px';
  fake.style.height = '1px';
  fake.style.pointerEvents = 'none';
  document.body.appendChild(fake);
  popupController.show(X_SEND_CONFIRM_POPUP_ID, fake);
  window.setTimeout(() => fake.remove(), 0);
}
