/**
 * Overlay Frames 集合 — 渲染所有浮层容器
 *
 * L3 阶段:5 个 Frame 都是空容器(null)。等 L4 Registry 落地后激活。
 */

import { ContextMenuFrame } from './ContextMenuFrame';
import { SlashMenuFrame } from './SlashMenuFrame';
import { HandleMenuFrame } from './HandleMenuFrame';
import { FloatingToolbarFrame } from './FloatingToolbarFrame';
import { GenericOverlayFrame } from './GenericOverlayFrame';

export function OverlayFrames() {
  return (
    <>
      <ContextMenuFrame />
      <SlashMenuFrame />
      <HandleMenuFrame />
      <FloatingToolbarFrame />
      <GenericOverlayFrame />
    </>
  );
}
