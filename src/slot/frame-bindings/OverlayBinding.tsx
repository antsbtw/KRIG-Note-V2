/**
 * Overlay Binding — 渲染通用浮层(帮助 / dialog 等)
 */

import { useActiveOverlay } from './use-registry';
import { overlayRegistry } from '../interaction-registries/overlay-registry/overlay-registry';

interface OverlayBindingProps {
  viewId: string | null;
}

export function OverlayBinding({ viewId }: OverlayBindingProps) {
  const overlay = useActiveOverlay(viewId ?? '');
  if (!overlay) return null;

  const Render = overlay.render;

  return (
    <div className="krig-overlay-backdrop" onClick={() => overlayRegistry.hide()}>
      <div className="krig-overlay-content" onClick={(e) => e.stopPropagation()}>
        <Render />
      </div>
    </div>
  );
}
