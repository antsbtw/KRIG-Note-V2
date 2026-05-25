/**
 * ContextMenu Binding — 渲染右键菜单(由 triggers 控制显示)
 *
 * L4 阶段:实现 frame 渲染逻辑;触发由 src/slot/triggers/use-context-menu-trigger.ts 通过
 *         contextMenuController 控制(显示/隐藏 + 位置 + 当前 items)。
 *
 * L5-B3.9:支持 group 分组渲染(不同 group 之间插分隔符)
 *
 * Frame-format step:加 submenu 渲染(对齐 HandleMenuBinding 行为):
 * - 顶层 item(叶):click → 命令 + 关菜单
 * - 顶层 item(带 ▸):hover → 右侧浮出 submenu(默认 button 列表 / submenuRender 自定义)
 * - submenu 边界:右溢翻左,下溢上收(viewport pad 8px)
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useContextMenuVersion } from './use-registry';
import { useCollisionPosition } from './use-collision-position';
import { contextMenuRegistry } from '../interaction-registries/context-menu-registry/context-menu-registry';
import { contextMenuController } from '../triggers/context-menu-controller';
import { commandRegistry } from '../command-registry/command-registry';
import { groupWithDividers, isDivider } from './group-with-dividers';
import type {
  ContextMenuItem,
  ContextSubmenuContext,
} from '../interaction-registries/context-menu-registry/context-menu-types';
import './overlay-bindings.css';

const VIEWPORT_PAD = 8;

/** 把 items 按 submenu 分组,返回顶层 + submenu items map(已按 order 排) */
function organizeItems(items: ContextMenuItem[]): {
  topLevel: ContextMenuItem[];
  submenus: Map<string, ContextMenuItem[]>;
} {
  const topLevel: ContextMenuItem[] = [];
  const submenus = new Map<string, ContextMenuItem[]>();
  for (const it of items) {
    if (it.submenuOf) {
      const arr = submenus.get(it.submenuOf) ?? [];
      arr.push(it);
      submenus.set(it.submenuOf, arr);
    } else {
      topLevel.push(it);
    }
  }
  for (const [key, arr] of submenus) {
    arr.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    submenus.set(key, arr);
  }
  return { topLevel, submenus };
}

export function ContextMenuBinding() {
  useContextMenuVersion();
  const [state, setState] = useState(contextMenuController.getState());
  const menuRef = useRef<HTMLDivElement | null>(null);
  const subMenuRef = useRef<HTMLDivElement | null>(null);
  const { x, y } = useCollisionPosition(menuRef, state.x, state.y);

  const [openSub, setOpenSub] = useState<string | null>(null);
  const [subPos, setSubPos] = useState<{ left: number; top: number } | null>(null);
  /**
   * 当前展开 submenu 的父 row 元素 — submenu top 锚定 row.top(不是 menu.top),
   * 这样从 row A hover 到 row B,submenu 跟着 row.y 跳动,视觉上是"跟着鼠标的子菜单"。
   * (2026-05-25 修:之前 top = mainRect.top 固定,多 row 共用 submenu 看起来像同一个)
   */
  const openSubRowRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    return contextMenuController.subscribe(() => {
      setState(contextMenuController.getState());
      setOpenSub(null);
      setSubPos(null);
      openSubRowRef.current = null;
    });
  }, []);

  useLayoutEffect(() => {
    setSubPos(null);
  }, [openSub]);

  useLayoutEffect(() => {
    if (!openSub || !menuRef.current || !subMenuRef.current) return;
    const mainRect = menuRef.current.getBoundingClientRect();
    const subRect = subMenuRef.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = mainRect.right + 4;
    // top 锚 row.top(不是 menu.top)— hover 切换主菜单项时 submenu 跟着 row 跳
    const rowRect = openSubRowRef.current?.getBoundingClientRect();
    let top = rowRect?.top ?? mainRect.top;
    if (left + subRect.width > vw - VIEWPORT_PAD) {
      left = mainRect.left - subRect.width - 4;
    }
    if (top + subRect.height > vh - VIEWPORT_PAD) {
      top = vh - subRect.height - VIEWPORT_PAD;
    }
    if (top < VIEWPORT_PAD) top = VIEWPORT_PAD;
    if (left < VIEWPORT_PAD) left = VIEWPORT_PAD;
    setSubPos({ left, top });
  }, [openSub]);

  if (!state.visible) return null;

  const allItems = contextMenuRegistry.getItemsForContext(state.viewId, state.context);
  if (allItems.length === 0) return null;

  const { topLevel, submenus } = organizeItems(allItems);
  if (topLevel.length === 0) return null;
  const itemsWithDividers = groupWithDividers(topLevel);

  function executeItem(item: ContextMenuItem): void {
    if (item.submenuId) return; // 子菜单容器项,hover 触发,click 不动作
    if (!item.command) return;
    commandRegistry.execute(item.command);
    contextMenuController.hide();
  }

  const openSubParent = openSub
    ? topLevel.find((it) => it.submenuId === openSub) ?? null
    : null;
  const subItems = openSub ? submenus.get(openSub) ?? [] : [];

  const submenuCtx: ContextSubmenuContext | null = openSubParent
    ? {
        viewId: state.viewId,
        contextInfo: state.context,
        close: () => contextMenuController.hide(),
      }
    : null;

  return (
    <>
      <div
        ref={menuRef}
        className="krig-context-menu"
        style={{ left: x, top: y }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {itemsWithDividers.map((item) => {
          if (isDivider(item)) {
            return <div key={item.key} className="krig-context-menu-divider" />;
          }
          const hasSubmenu = !!item.submenuId;
          const disabled = !item.command && !hasSubmenu;
          const cls = ['krig-context-menu-item'];
          if (disabled) cls.push('krig-context-menu-item--disabled');
          if (hasSubmenu && openSub === item.submenuId) cls.push('krig-context-menu-item--active');
          return (
            <button
              key={item.id}
              type="button"
              className={cls.join(' ')}
              disabled={disabled}
              onMouseEnter={(e) => {
                openSubRowRef.current = hasSubmenu
                  ? (e.currentTarget as HTMLElement)
                  : null;
                setOpenSub(hasSubmenu ? item.submenuId! : null);
              }}
              onClick={() => executeItem(item)}
            >
              <span className="krig-context-menu-item__label">{item.label}</span>
              {hasSubmenu && <span className="krig-context-menu-item__arrow">▸</span>}
            </button>
          );
        })}
      </div>

      {openSubParent && (
        <div
          ref={subMenuRef}
          className="krig-context-submenu"
          style={{
            left: subPos?.left ?? 0,
            top: subPos?.top ?? 0,
            visibility: subPos ? 'visible' : 'hidden',
          }}
          onMouseDown={(e) => e.stopPropagation()}
          onMouseEnter={() => setOpenSub(openSub)}
        >
          {openSubParent.submenuRender && submenuCtx ? (
            openSubParent.submenuRender(submenuCtx)
          ) : (
            groupWithDividers(subItems).map((item) => {
              if (isDivider(item)) {
                return <div key={item.key} className="krig-context-menu-divider" />;
              }
              const disabled = !item.command;
              const cls = ['krig-context-menu-item'];
              if (disabled) cls.push('krig-context-menu-item--disabled');
              return (
                <button
                  key={item.id}
                  type="button"
                  className={cls.join(' ')}
                  disabled={disabled}
                  onClick={() => executeItem(item)}
                >
                  <span className="krig-context-menu-item__label">{item.label}</span>
                </button>
              );
            })
          )}
        </div>
      )}
    </>
  );
}
