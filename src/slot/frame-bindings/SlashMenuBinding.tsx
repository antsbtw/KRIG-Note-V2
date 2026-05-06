/**
 * SlashMenu Binding — 渲染 / 命令菜单
 *
 * L5-B3.1:加 selectedIdx 内部 state(↑↓ 选中 / Enter 触发);query 变化时 reset 0。
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

  // 选中 idx(本地 state)
  const [selectedIdx, setSelectedIdx] = useState(0);

  useEffect(() => {
    return slashMenuController.subscribe(() => setState(slashMenuController.getState()));
  }, []);

  // query 变化 → reset selectedIdx
  useEffect(() => {
    setSelectedIdx(0);
  }, [state.query, state.viewId]);

  // 键盘导航(只在 visible 时)
  useEffect(() => {
    if (!state.visible) return;
    const items = slashRegistry.getItemsForView(state.viewId, state.query);
    if (items.length === 0) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        e.stopPropagation();
        setSelectedIdx((idx) => (idx + 1) % items.length);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        e.stopPropagation();
        setSelectedIdx((idx) => (idx - 1 + items.length) % items.length);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        const item = items[selectedIdx];
        if (item) {
          commandRegistry.execute(item.command);
          slashMenuController.hide();
        }
      }
    };
    // 用 capture 阶段抢在 PM 编辑器之前
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [state.visible, state.viewId, state.query, selectedIdx]);

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
      {items.map((item, idx) => (
        <button
          key={item.id}
          type="button"
          className={`krig-slash-menu-item${idx === selectedIdx ? ' selected' : ''}`}
          onMouseEnter={() => setSelectedIdx(idx)}
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
