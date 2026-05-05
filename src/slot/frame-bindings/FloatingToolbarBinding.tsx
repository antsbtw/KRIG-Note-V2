/**
 * FloatingToolbar Binding — 渲染选区上方浮动工具条
 */

import { useEffect, useState } from 'react';
import { useFloatingToolbarVersion } from './use-registry';
import { floatingToolbarRegistry } from '../interaction-registries/floating-toolbar-registry/floating-toolbar-registry';
import { floatingToolbarController } from '../triggers/floating-toolbar-controller';
import { commandRegistry } from '../command-registry/command-registry';

export function FloatingToolbarBinding() {
  useFloatingToolbarVersion();
  const [state, setState] = useState(floatingToolbarController.getState());

  useEffect(() => {
    return floatingToolbarController.subscribe(() => setState(floatingToolbarController.getState()));
  }, []);

  if (!state.visible) return null;
  const items = floatingToolbarRegistry.getItemsForView(state.viewId);
  if (items.length === 0) return null;

  return (
    <div
      className="krig-floating-toolbar"
      style={{ left: state.x, top: state.y }}
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
