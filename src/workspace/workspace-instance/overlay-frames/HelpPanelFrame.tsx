/**
 * HelpPanelFrame — 右栏长侧栏 frame(L4.1)
 *
 * 跟其他 Frame 同模式:接入 HelpPanelBinding 渲染 helpPanelController 当前状态。
 *
 * 不同于 PopupFrame:不需要 anchor 定位测量(CSS 固定贴右),也不需要 view 过滤
 * (panel 跨 view 共享 — 但 helpPanelRegistry.register 时可指定 view: id 限定)。
 */

import { HelpPanelBinding } from '@slot/frame-bindings/HelpPanelBinding';

export function HelpPanelFrame() {
  return <HelpPanelBinding />;
}
