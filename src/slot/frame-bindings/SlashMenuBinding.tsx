/**
 * SlashMenu Binding — 渲染 / 命令菜单
 */

import { useEffect, useState } from 'react';
import { useSlashVersion } from './use-registry';
import { slashRegistry } from '../interaction-registries/slash-registry/slash-registry';
import { slashMenuController } from '../triggers/slash-menu-controller';
import { commandRegistry } from '../command-registry/command-registry';

export function SlashMenuBinding() {
  useSlashVersion();
  const [state, setState] = useState(slashMenuController.getState());

  useEffect(() => {
    return slashMenuController.subscribe(() => setState(slashMenuController.getState()));
  }, []);

  if (!state.visible) return null;
  const items = slashRegistry.getItemsForView(state.viewId, state.query);
  if (items.length === 0) return null;

  return (
    <div
      className="krig-slash-menu"
      style={{ left: state.x, top: state.y }}
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
