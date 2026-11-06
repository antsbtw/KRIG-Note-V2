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
import { HelpPanelFrame } from './HelpPanelFrame';
import { useFullscreenOverlayActive } from '@slot/frame-bindings/InteractionOverlayBindings';

interface OverlayFramesProps {
  /** 当前活跃 view ID(传给 OverlayBinding 用于过滤 view-specific overlay)*/
  viewId: string | null;
}

export function OverlayFrames({ viewId }: OverlayFramesProps) {
  // 全屏覆盖层打开时,交互浮层组改由全屏层挂(本层此时 display:none,挂了也看不见);
  // 这里同时不挂,保证任何时刻只有一套(见 InteractionOverlayBindings 注释)
  const fullscreenActive = useFullscreenOverlayActive();
  if (fullscreenActive) {
    return (
      <>
        <HelpPanelFrame />
        <GenericOverlayFrame viewId={viewId} />
      </>
    );
  }
  return (
    <>
      <ContextMenuFrame />
      <SlashMenuFrame />
      <HandleMenuFrame />
      <FloatingToolbarFrame />
      <PopupFrame />
      <HelpPanelFrame />
      <GenericOverlayFrame viewId={viewId} />
    </>
  );
}
