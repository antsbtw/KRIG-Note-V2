/**
 * FloatingToolbar Binding — 渲染选区上方浮动工具条
 *
 * L5-B3.1 升级:订阅 selection capability,activeWhen 计算 active 高亮(对齐顶部 Toolbar)
 */

import { useEffect, useRef, useState } from 'react';
import { useFloatingToolbarVersion } from './use-registry';
import { useCollisionPosition } from './use-collision-position';
import { floatingToolbarRegistry } from '../interaction-registries/floating-toolbar-registry/floating-toolbar-registry';
import { floatingToolbarController } from '../triggers/floating-toolbar-controller';
import { commandRegistry } from '../command-registry/command-registry';
import { selection, type SelectionPayload } from '@capabilities/selection';
import type { ToolbarItemContext } from '../toolbar-registry/toolbar-types';

export function FloatingToolbarBinding() {
  useFloatingToolbarVersion();
  const [state, setState] = useState(floatingToolbarController.getState());
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const { x, y } = useCollisionPosition(toolbarRef, state.x, state.y);

  // 订阅 selection capability(activeWhen 计算)
  const [sel, setSel] = useState<SelectionPayload | null>(() => selection.api.getCurrent());
  useEffect(() => selection.subscribe((payload) => setSel(payload)), []);

  useEffect(() => {
    return floatingToolbarController.subscribe(() => setState(floatingToolbarController.getState()));
  }, []);

  if (!state.visible) return null;
  const items = floatingToolbarRegistry.getItemsForView(state.viewId);
  if (items.length === 0) return null;

  const ctx: ToolbarItemContext = { selection: sel };

  return (
    <div
      ref={toolbarRef}
      className="krig-floating-toolbar"
      style={{ left: x, top: y }}
      onMouseDown={(e) => e.preventDefault()} // 不抢编辑器焦点
    >
      {items.map((item) => {
        const active = item.activeWhen?.(ctx) ?? false;
        return (
          <button
            key={item.id}
            type="button"
            className={`krig-floating-toolbar-item${active ? ' active' : ''}`}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => commandRegistry.execute(item.command, item.commandArg)}
            title={item.label}
          >
            {item.icon ?? item.label}
          </button>
        );
      })}
    </div>
  );
}
