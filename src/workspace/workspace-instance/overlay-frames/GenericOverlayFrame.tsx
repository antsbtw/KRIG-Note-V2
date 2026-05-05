/**
 * GenericOverlayFrame — 通用浮层 frame
 *
 * L4 阶段:接入 OverlayBinding
 */

import { OverlayBinding } from '@slot/frame-bindings/OverlayBinding';

interface GenericOverlayFrameProps {
  viewId: string | null;
}

export function GenericOverlayFrame({ viewId }: GenericOverlayFrameProps) {
  return <OverlayBinding viewId={viewId} />;
}
