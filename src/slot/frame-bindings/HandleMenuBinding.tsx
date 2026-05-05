/**
 * HandleMenu Binding — 渲染 Handle(块手柄)菜单
 */

import { useEffect, useRef, useState } from 'react';
import { useHandleVersion } from './use-registry';
import { useCollisionPosition } from './use-collision-position';
import { handleRegistry } from '../interaction-registries/handle-registry/handle-registry';
import { handleMenuController } from '../triggers/handle-menu-controller';
import { commandRegistry } from '../command-registry/command-registry';

export function HandleMenuBinding() {
  useHandleVersion();
  const [state, setState] = useState(handleMenuController.getState());
  const menuRef = useRef<HTMLDivElement | null>(null);
  const { x, y } = useCollisionPosition(menuRef, state.x, state.y);

  useEffect(() => {
    return handleMenuController.subscribe(() => setState(handleMenuController.getState()));
  }, []);

  if (!state.visible) return null;
  const items = handleRegistry.getItemsForBlock(state.viewId, state.blockType);
  if (items.length === 0) return null;

  return (
    <div
      ref={menuRef}
      className="krig-handle-menu"
      style={{ left: x, top: y }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          className="krig-handle-menu-item"
          onClick={() => {
            commandRegistry.execute(item.command);
            handleMenuController.hide();
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
