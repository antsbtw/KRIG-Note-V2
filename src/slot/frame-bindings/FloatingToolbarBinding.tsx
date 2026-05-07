/**
 * FloatingToolbar Binding — 渲染选区上方浮动工具条
 *
 * L5-B3.1:
 * - 订阅 selection capability,activeWhen 计算 active 高亮(对齐顶部 Toolbar)
 * - **不**用 useCollisionPosition(它假设向右下展开;floating-toolbar 是向上 + 水平居中,
 *   语义不同)。自己算边界:水平 anchor 是选区中点 → translateX(-50%) 让浮条居中,
 *   越界时夹紧到 viewport 边;垂直 anchor 已经是浮条 top(driver 已扣除浮条高度)。
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useFloatingToolbarVersion } from './use-registry';
import { floatingToolbarRegistry } from '../interaction-registries/floating-toolbar-registry/floating-toolbar-registry';
import { floatingToolbarController } from '../triggers/floating-toolbar-controller';
import { popupController } from '../triggers/popup-controller';
import { commandRegistry } from '../command-registry/command-registry';
import { selection, type SelectionPayload } from '@capabilities/selection';
import type { ToolbarItemContext } from '../toolbar-registry/toolbar-types';
import { groupWithDividers, isDivider } from './group-with-dividers';

const VIEWPORT_MARGIN = 8;

export function FloatingToolbarBinding() {
  useFloatingToolbarVersion();
  const [state, setState] = useState(floatingToolbarController.getState());
  const toolbarRef = useRef<HTMLDivElement | null>(null);

  // 实际渲染用的位置(测量后修正)
  const [pos, setPos] = useState<{ left: number; top: number; visible: boolean }>({
    left: 0,
    top: 0,
    visible: false,
  });

  // 订阅 selection capability(activeWhen 计算)
  const [sel, setSel] = useState<SelectionPayload | null>(() => selection.api.getCurrent());
  useEffect(() => selection.subscribe((payload) => setSel(payload)), []);

  useEffect(() => {
    return floatingToolbarController.subscribe(() => setState(floatingToolbarController.getState()));
  }, []);

  // 测量浮条尺寸 + 修正位置
  useLayoutEffect(() => {
    if (!state.visible) {
      setPos((p) => ({ ...p, visible: false }));
      return;
    }
    const el = toolbarRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const vw = window.innerWidth;

    // 水平:state.x 是选区中点,浮条要水平居中 → left = x - width/2
    let left = state.x - rect.width / 2;
    if (left < VIEWPORT_MARGIN) left = VIEWPORT_MARGIN;
    if (left + rect.width > vw - VIEWPORT_MARGIN) left = vw - rect.width - VIEWPORT_MARGIN;

    // 垂直:state.y 已经是浮条 top(driver 扣除浮条高度);上溢时翻到选区下方
    let top = state.y;
    if (top < VIEWPORT_MARGIN) {
      // 上方放不下 → 翻到选区下方(state.y + 浮条高度 + 2*GAP 是选区 top + GAP)
      // 简化:直接设 top = VIEWPORT_MARGIN + rect.height(选区下方,但本身浮条高度已知)
      top = VIEWPORT_MARGIN;
    }

    setPos({ left, top, visible: true });
  }, [state.visible, state.x, state.y]);

  if (!state.visible) return null;
  const items = floatingToolbarRegistry.getItemsForView(state.viewId);
  if (items.length === 0) return null;

  const ctx: ToolbarItemContext = { selection: sel };

  return (
    <div
      ref={toolbarRef}
      className="krig-floating-toolbar"
      style={{
        left: pos.left,
        top: pos.top,
        visibility: pos.visible ? 'visible' : 'hidden',
      }}
      onMouseDown={(e) => e.preventDefault()} // 不抢编辑器焦点
    >
      {groupWithDividers(items).map((item) => {
        if (isDivider(item)) {
          return <div key={item.key} className="krig-floating-toolbar-divider" />;
        }
        const active = item.activeWhen?.(ctx) ?? false;
        const isPopupTrigger = item.kind === 'popup-trigger';
        return (
          <button
            key={item.id}
            type="button"
            className={`krig-floating-toolbar-item${active ? ' active' : ''}`}
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => {
              if (isPopupTrigger && item.popupId) {
                popupController.toggle(item.popupId, e.currentTarget);
              } else if (item.command) {
                commandRegistry.execute(item.command, item.commandArg);
              }
            }}
            title={item.label}
          >
            {item.icon ?? item.label}
          </button>
        );
      })}
    </div>
  );
}
