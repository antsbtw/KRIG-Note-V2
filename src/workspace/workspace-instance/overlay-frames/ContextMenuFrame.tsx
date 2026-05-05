/**
 * ContextMenuFrame — 右键菜单 frame
 *
 * L4 阶段:接入 ContextMenuBinding(由 useContextMenuTrigger 触发显示)
 */

import { ContextMenuBinding } from '@slot/frame-bindings/ContextMenuBinding';

export function ContextMenuFrame() {
  return <ContextMenuBinding />;
}
