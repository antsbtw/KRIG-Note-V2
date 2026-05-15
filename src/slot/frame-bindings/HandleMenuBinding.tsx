/**
 * HandleMenu Binding — 渲染块手柄菜单(L5-B3.11 + 2026-05-15 统一交互式样)
 *
 * 统一交互式样:
 * - 顶层 item(叶):click → 触发命令 + 关菜单
 * - 顶层 item(带 ▸):hover → 右侧浮出 submenu
 * - submenu 默认 button 列表(submenuOf 子项填充)
 * - submenu 自定义渲染(item.submenuRender 字段)— Color swatch grid 等用
 *
 * 支持:
 * - group 分组(自动插分隔符;同组无分隔)
 * - submenu(item.submenuId 设置时是父项,渲染右侧 ▸ + 子菜单)
 * - submenuRender 自定义内容(submenuRender 函数返回 ReactNode 替换 button 列表)
 * - visibleWhen(只在 block 满足条件时渲染该 item)
 *
 * 注册原则:未实装的功能不注册,registry 里没该 item → 菜单不出现该项。
 */

import { useEffect, useRef, useState, useLayoutEffect } from 'react';
import { useHandleVersion } from './use-registry';
import { useCollisionPosition } from './use-collision-position';
import { handleRegistry } from '../interaction-registries/handle-registry/handle-registry';
import { handleMenuController } from '../triggers/handle-menu-controller';
import { commandRegistry } from '../command-registry/command-registry';
import type {
  HandleItem,
  HandleVisibilityContext,
  HandleSubmenuContext,
} from '../interaction-registries/handle-registry/handle-types';
import { groupWithDividers, isDivider } from './group-with-dividers';

const VIEWPORT_PAD = 8;

/** 把 raw items 按 visibleWhen + submenu 划分,返回顶层 items + submenu items map */
function organizeItems(
  raw: HandleItem[],
  ctx: HandleVisibilityContext,
): { topLevel: HandleItem[]; submenus: Map<string, HandleItem[]> } {
  const filtered = raw.filter((it) => !it.visibleWhen || it.visibleWhen(ctx));
  const topLevel: HandleItem[] = [];
  const submenus = new Map<string, HandleItem[]>();
  for (const it of filtered) {
    if (it.submenuOf) {
      const arr = submenus.get(it.submenuOf) ?? [];
      arr.push(it);
      submenus.set(it.submenuOf, arr);
    } else {
      topLevel.push(it);
    }
  }
  // submenu 内部也按 order 排
  for (const [key, arr] of submenus) {
    arr.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    submenus.set(key, arr);
  }
  return { topLevel, submenus };
}

export function HandleMenuBinding() {
  useHandleVersion();
  const [state, setState] = useState(handleMenuController.getState());
  const menuRef = useRef<HTMLDivElement | null>(null);
  const subMenuRef = useRef<HTMLDivElement | null>(null);
  const { x, y } = useCollisionPosition(menuRef, state.x, state.y);

  /** 当前展开的 submenu ID(hover 触发)*/
  const [openSub, setOpenSub] = useState<string | null>(null);
  const [subPos, setSubPos] = useState<{ left: number; top: number } | null>(null);

  useEffect(() => {
    return handleMenuController.subscribe(() => {
      setState(handleMenuController.getState());
      // 切换菜单时关闭 submenu
      setOpenSub(null);
      setSubPos(null);
    });
  }, []);

  // 切换 openSub 时重置位置(避免新 submenu 按旧位置闪一帧)
  useLayoutEffect(() => {
    setSubPos(null);
  }, [openSub]);

  // submenu 边界翻转:默认右侧,溢出翻左;底部溢出向上收
  useLayoutEffect(() => {
    if (!openSub || !menuRef.current || !subMenuRef.current) return;
    const mainRect = menuRef.current.getBoundingClientRect();
    const subRect = subMenuRef.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = mainRect.right + 4;
    let top = mainRect.top;
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
  const allItems = handleRegistry.getItemsForBlock(state.viewId, state.blockType);
  if (allItems.length === 0) return null;

  const ctx: HandleVisibilityContext = {
    blockType: state.blockType ?? '',
    blockAttrs: state.blockAttrs ?? {},
  };
  const { topLevel, submenus } = organizeItems(allItems, ctx);
  if (topLevel.length === 0) return null;

  const itemsWithDividers = groupWithDividers(topLevel);

  function executeItem(item: HandleItem): void {
    if (item.submenuId) return; // submenu 容器项,只展开不执行(hover 触发,不走 click)
    if (!item.command) return; // 无命令(理论上不该到这步,但兜底)
    commandRegistry.execute(item.command);
    handleMenuController.hide();
  }

  // 当前展开的 submenu 父项 + 子项(用于判断渲染默认列表 or 自定义 render)
  const openSubParent = openSub
    ? topLevel.find((it) => it.submenuId === openSub) ?? null
    : null;
  const subItems = openSub ? submenus.get(openSub) ?? [] : [];

  // submenu 自定义渲染上下文(submenuRender 用)
  const submenuCtx: HandleSubmenuContext | null = openSubParent
    ? {
        blockType: state.blockType ?? '',
        blockAttrs: state.blockAttrs ?? {},
        blockPos: state.pos ?? 0,
        close: () => handleMenuController.hide(),
      }
    : null;

  return (
    <>
      {/* 主菜单 */}
      <div
        ref={menuRef}
        className="krig-handle-menu"
        style={{ left: x, top: y }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {itemsWithDividers.map((item) => {
          if (isDivider(item)) {
            return <div key={item.key} className="krig-handle-menu-divider" />;
          }
          const hasSubmenu = !!item.submenuId;
          const disabled = !item.command && !hasSubmenu;
          const cls = ['krig-handle-menu-item'];
          if (disabled) cls.push('krig-handle-menu-item--disabled');
          if (hasSubmenu && openSub === item.submenuId) cls.push('krig-handle-menu-item--active');
          return (
            <button
              key={item.id}
              type="button"
              className={cls.join(' ')}
              disabled={disabled}
              onMouseEnter={() => {
                if (hasSubmenu) {
                  setOpenSub(item.submenuId!);
                } else {
                  setOpenSub(null);
                }
              }}
              onClick={() => executeItem(item)}
            >
              {item.icon && <span className="krig-handle-menu-item__icon">{item.icon}</span>}
              <span className="krig-handle-menu-item__label">{item.label}</span>
              {hasSubmenu && <span className="krig-handle-menu-item__arrow">▸</span>}
            </button>
          );
        })}
      </div>

      {/* 子菜单 */}
      {openSubParent && (
        <div
          ref={subMenuRef}
          className="krig-handle-submenu"
          style={{
            left: subPos?.left ?? 0,
            top: subPos?.top ?? 0,
            visibility: subPos ? 'visible' : 'hidden',
          }}
          onMouseDown={(e) => e.stopPropagation()}
          onMouseEnter={() => setOpenSub(openSub)}
        >
          {openSubParent.submenuRender && submenuCtx ? (
            // 自定义渲染:Color swatch grid 等复杂内容
            openSubParent.submenuRender(submenuCtx)
          ) : (
            // 默认渲染:submenuOf 子项的 button 列表(Turn Into 等用)
            groupWithDividers(subItems).map((item) => {
              if (isDivider(item)) {
                return <div key={item.key} className="krig-handle-menu-divider" />;
              }
              const disabled = !item.command;
              const cls = ['krig-handle-menu-item'];
              if (disabled) cls.push('krig-handle-menu-item--disabled');
              return (
                <button
                  key={item.id}
                  type="button"
                  className={cls.join(' ')}
                  disabled={disabled}
                  onClick={() => executeItem(item)}
                >
                  {item.icon && <span className="krig-handle-menu-item__icon">{item.icon}</span>}
                  <span className="krig-handle-menu-item__label">{item.label}</span>
                </button>
              );
            })
          )}
        </div>
      )}
    </>
  );
}
