/**
 * FontEmbedConfirmPanel 模块出口(L5-G7.4)
 *
 * - registerFontEmbedConfirmPopup():注册 popup 到 popupRegistry(graph-canvas-view 调一次)。
 * - showFontEmbedConfirm(ctx):返回 Promise<boolean> —— 用户确认嵌入 true,取消 false。
 *   仿 X 2.5-a showXSendConfirm 的 fake anchor 居中弹窗,但包成 await 友好的 Promise。
 */

import { popupRegistry } from '@slot/interaction-registries/popup-registry/popup-registry';
import { popupController } from '@slot/triggers/popup-controller';
import { FontEmbedConfirmPanel } from './FontEmbedConfirmPanel';
import {
  FONT_EMBED_CONFIRM_POPUP_ID,
  setPendingFontEmbedConfirm,
} from './panel-context';

export function registerFontEmbedConfirmPopup(): void {
  popupRegistry.register({
    id: FONT_EMBED_CONFIRM_POPUP_ID,
    view: undefined, // 全局 PopupFrame 渲染,不绑特定 view
    Component: FontEmbedConfirmPanel,
    estimatedSize: { width: 340, height: 260 },
  });
}

/**
 * 弹嵌入确认窗,返回用户决定(true=嵌入,false=取消)。
 * fake anchor 视口偏上居中(同 showXSendConfirm)。
 */
export function showFontEmbedConfirm(opts: {
  family: string;
  sizeKb: number;
  overThreshold: boolean;
}): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    setPendingFontEmbedConfirm({ ...opts, resolve });
    const fake = document.createElement('div');
    fake.style.position = 'fixed';
    fake.style.left = `${Math.round(window.innerWidth / 2)}px`;
    fake.style.top = `${Math.round(window.innerHeight / 4)}px`;
    fake.style.width = '1px';
    fake.style.height = '1px';
    fake.style.pointerEvents = 'none';
    document.body.appendChild(fake);
    popupController.show(FONT_EMBED_CONFIRM_POPUP_ID, fake);
    window.setTimeout(() => fake.remove(), 0);
  });
}
