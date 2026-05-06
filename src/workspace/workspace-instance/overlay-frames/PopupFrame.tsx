/**
 * PopupFrame — anchor-positioned 弹层(L5-B3.4)
 *
 * 跟其他 Frame 同模式:接入 PopupBinding 渲染 popup-controller 的当前状态。
 */

import { PopupBinding } from '@slot/frame-bindings/PopupBinding';

export function PopupFrame() {
  return <PopupBinding />;
}
