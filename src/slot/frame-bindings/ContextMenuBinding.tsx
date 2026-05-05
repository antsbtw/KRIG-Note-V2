/**
 * ContextMenu Binding — 渲染右键菜单(由 triggers 控制显示)
 *
 * L4 阶段:实现 frame 渲染逻辑;触发由 src/slot/triggers/use-context-menu-trigger.ts 通过
 *         contextMenuController 控制(显示/隐藏 + 位置 + 当前 items)。
 */

import { useEffect, useState } from 'react';
import { useContextMenuVersion } from './use-registry';
import { contextMenuRegistry } from '../interaction-registries/context-menu-registry/context-menu-registry';
import { contextMenuController } from '../triggers/context-menu-controller';
import { commandRegistry } from '../command-registry/command-registry';
import './overlay-bindings.css';

export function ContextMenuBinding() {
  // 订阅 Registry 变化(L4 阶段防御性 — 注册项变化时刷新)
  useContextMenuVersion();
  const [state, setState] = useState(contextMenuController.getState());

  useEffect(() => {
    return contextMenuController.subscribe(() => {
      setState(contextMenuController.getState());
    });
  }, []);

  if (!state.visible) return null;

  const items = contextMenuRegistry.getItemsForContext(state.viewId, state.context);
  if (items.length === 0) return null;

  return (
    <div
      className="krig-context-menu"
      style={{ left: state.x, top: state.y }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          className="krig-context-menu-item"
          onClick={() => {
            commandRegistry.execute(item.command);
            contextMenuController.hide();
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
