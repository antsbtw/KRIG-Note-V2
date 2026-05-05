/**
 * SlashMenu Binding — 渲染 / 命令菜单
 */

import { useEffect, useRef, useState } from 'react';
import { useSlashVersion } from './use-registry';
import { useCollisionPosition } from './use-collision-position';
import { slashRegistry } from '../interaction-registries/slash-registry/slash-registry';
import { slashMenuController } from '../triggers/slash-menu-controller';
import { commandRegistry } from '../command-registry/command-registry';

export function SlashMenuBinding() {
  useSlashVersion();
  const [state, setState] = useState(slashMenuController.getState());
  const menuRef = useRef<HTMLDivElement | null>(null);
  const { x, y } = useCollisionPosition(menuRef, state.x, state.y);

  useEffect(() => {
    return slashMenuController.subscribe(() => setState(slashMenuController.getState()));
  }, []);

  if (!state.visible) return null;
  const items = slashRegistry.getItemsForView(state.viewId, state.query);
  if (items.length === 0) return null;

  return (
    <div
      ref={menuRef}
      className="krig-slash-menu"
      style={{ left: x, top: y }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          className="krig-slash-menu-item"
          onClick={() => {
            commandRegistry.execute(item.command);
            slashMenuController.hide();
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
