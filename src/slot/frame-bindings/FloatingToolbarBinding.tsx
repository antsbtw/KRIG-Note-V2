/**
 * FloatingToolbar Binding — 渲染选区上方浮动工具条
 */

import { useEffect, useRef, useState } from 'react';
import { useFloatingToolbarVersion } from './use-registry';
import { useCollisionPosition } from './use-collision-position';
import { floatingToolbarRegistry } from '../interaction-registries/floating-toolbar-registry/floating-toolbar-registry';
import { floatingToolbarController } from '../triggers/floating-toolbar-controller';
import { commandRegistry } from '../command-registry/command-registry';

export function FloatingToolbarBinding() {
  useFloatingToolbarVersion();
  const [state, setState] = useState(floatingToolbarController.getState());
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const { x, y } = useCollisionPosition(toolbarRef, state.x, state.y);

  useEffect(() => {
    return floatingToolbarController.subscribe(() => setState(floatingToolbarController.getState()));
  }, []);

  if (!state.visible) return null;
  const items = floatingToolbarRegistry.getItemsForView(state.viewId);
  if (items.length === 0) return null;

  return (
    <div
      ref={toolbarRef}
      className="krig-floating-toolbar"
      style={{ left: x, top: y }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          className="krig-floating-toolbar-item"
          onClick={() => commandRegistry.execute(item.command)}
          title={item.label}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
