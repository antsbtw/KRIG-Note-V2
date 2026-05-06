/**
 * Overlay Frames 集合 — 渲染所有浮层容器
 *
 * L4 阶段:5 个 Frame 都接入对应 Binding,接收当前活跃 view ID
 */

import { ContextMenuFrame } from './ContextMenuFrame';
import { SlashMenuFrame } from './SlashMenuFrame';
import { HandleMenuFrame } from './HandleMenuFrame';
import { FloatingToolbarFrame } from './FloatingToolbarFrame';
import { GenericOverlayFrame } from './GenericOverlayFrame';
import { PopupFrame } from './PopupFrame';

interface OverlayFramesProps {
  /** 当前活跃 view ID(传给 OverlayBinding 用于过滤 view-specific overlay)*/
  viewId: string | null;
}

export function OverlayFrames({ viewId }: OverlayFramesProps) {
  return (
    <>
      <ContextMenuFrame />
      <SlashMenuFrame />
      <HandleMenuFrame />
      <FloatingToolbarFrame />
      <PopupFrame />
      <GenericOverlayFrame viewId={viewId} />
    </>
  );
}
