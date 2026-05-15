/**
 * callout emoji-picker — capability 端 popup 接入
 *
 * driver 的 calloutNodeView emoji click 通过 setCalloutEmojiHandler 调本模块
 * onOpen,本模块缓 pending ctx({instanceId, blockPos}) + 用 popupController.show
 * 启 popup(EmojiPickerPanel)。
 *
 * 解决 popup-controller 匿名契约(只携带 id + anchor,不带 payload)在 block-scoped
 * 场景下传 ctx 的问题:模块级 pending ctx 缓冲,Panel mount 时一次性消费。
 *
 * 装配:capability 加载时自调一次(详 capabilities/text-editing/index.ts);
 * driver activeHandler 是模块级单例,view 各自注册会互相覆盖,故归 capability 自管。
 */

import { setCalloutEmojiHandler } from '@drivers/text-editing-driver';
import { instanceRegistry } from '@drivers/text-editing-driver/instance-registry';
import { popupController } from '@slot/triggers/popup-controller';

const POPUP_ID = 'text-editing.popup.callout-emoji';

interface PendingCtx {
  instanceId: string;
  blockPos: number;
}

let pendingCtx: PendingCtx | null = null;

/**
 * Panel mount 时调用,拿 ctx 并立即清空(防 stale ctx 被下次 popup 复用)。
 */
export function consumeCalloutEmojiCtx(): PendingCtx | null {
  const ctx = pendingCtx;
  pendingCtx = null;
  return ctx;
}

/** capability 加载时一次性注册 driver callout emoji handler */
export function registerCalloutEmojiIntegration(): void {
  setCalloutEmojiHandler({
    onOpen(_view, blockPos, anchorEl) {
      // instanceId 优先用 focused(对 canvas-text-node 复合 id 场景安全)
      const instanceId = instanceRegistry.getFocusedInstanceId();
      if (!instanceId) return;
      pendingCtx = { instanceId, blockPos };
      popupController.show(POPUP_ID, anchorEl);
    },
    onClose() {
      const cur = popupController.getState();
      if (cur.visible && cur.activeId === POPUP_ID) {
        popupController.hide();
      }
      pendingCtx = null;
    },
  });
}
