/**
 * Toolbar Binding — 把 ToolbarRegistry 内容渲染到 ToolbarFrame 内
 *
 * L5-B2 升级:
 * - 支持 ToolbarItem.kind = 'button' | 'dropdown' | 'separator'
 * - 订阅 selection capability,计算 activeWhen / currentLabel
 * - dropdown 内嵌浮层(Q6=A 简陋,L5-B2.5/B3 抽 Popover)
 */

import { useEffect, useState, useRef, useLayoutEffect } from 'react';
import { useToolbarVersion } from './use-registry';
import { toolbarRegistry } from '../toolbar-registry/toolbar-registry';
import { commandRegistry } from '../command-registry/command-registry';
import { popupController } from '../triggers/popup-controller';
import { selection, type SelectionPayload } from '@capabilities/selection';
import type {
  ToolbarItem,
  ToolbarItemContext,
  DropdownOption,
} from '../toolbar-registry/toolbar-types';
import './toolbar-bindings.css';

interface ToolbarBindingProps {
  viewId: string | null;
}

export function ToolbarBinding({ viewId }: ToolbarBindingProps) {
  useToolbarVersion();

  // 订阅 selection capability(activeWhen / currentLabel 用)
  const [sel, setSel] = useState<SelectionPayload | null>(() => selection.api.getCurrent());
  useEffect(() => {
    return selection.subscribe((payload) => setSel(payload));
  }, []);

  // L5-B4:view 未激活 / view 没注册任何 toolbar items 时不渲染框架 toolbar 行
  // (对齐 V1 — web view 类自带 view 内 toolbar 的 view 不应被框架 toolbar 占空间)
  if (!viewId) return null;

  const leftItems = toolbarRegistry.getItemsForView(viewId, 'left');
  const centerItems = toolbarRegistry.getItemsForView(viewId, 'center');
  const rightItems = toolbarRegistry.getItemsForView(viewId, 'right');
  const noGroup = toolbarRegistry.getItemsForView(viewId).filter((it) => !it.group);

  if (leftItems.length === 0 && centerItems.length === 0 && rightItems.length === 0 && noGroup.length === 0) {
    return null;
  }

  const ctx: ToolbarItemContext = { selection: sel };

  return (
    <div className="krig-toolbar-binding">
      <div className="krig-toolbar-group krig-toolbar-group--left">
        {[...leftItems, ...noGroup].map((item) => renderItem(item, ctx))}
      </div>
      <div className="krig-toolbar-group krig-toolbar-group--center">
        {centerItems.map((item) => renderItem(item, ctx))}
      </div>
      <div className="krig-toolbar-group krig-toolbar-group--right">
        {rightItems.map((item) => renderItem(item, ctx))}
      </div>
    </div>
  );
}

function renderItem(item: ToolbarItem, ctx: ToolbarItemContext) {
  if (item.kind === 'separator') {
    return <div key={item.id} className="krig-toolbar-sep" />;
  }
  if (item.kind === 'dropdown') {
    return <ToolbarDropdown key={item.id} item={item} ctx={ctx} />;
  }
  if (item.kind === 'custom-render' && item.Component) {
    const C = item.Component;
    return <C key={item.id} ctx={ctx} />;
  }
  // 默认 button(含 'popup-trigger' 分支)
  const active = item.activeWhen?.(ctx) ?? false;
  const isPopupTrigger = item.kind === 'popup-trigger';
  const variant = item.variant ?? 'default';
  const className = [
    'krig-toolbar-button',
    `krig-toolbar-button--${variant}`,
    active ? 'active' : '',
  ].filter(Boolean).join(' ');
  return (
    <button
      key={item.id}
      type="button"
      className={className}
      onMouseDown={(e) => e.preventDefault()} // 不抢编辑器焦点
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
}

const DROPDOWN_VIEWPORT_MARGIN = 8;
const DROPDOWN_ANCHOR_GAP = 2;

function ToolbarDropdown({ item, ctx }: { item: ToolbarItem; ctx: ToolbarItemContext }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; visible: boolean } | null>(null);

  // 关菜单:外部点击 / Esc
  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  // 浮层定位 — 测菜单实际宽高 + 视口边界夹紧(对齐 PopupBinding 模式)
  // 1) 默认 trigger 下方右对齐(下拉菜单常规);若 trigger 左边空间不够 → 改左对齐
  // 2) 右溢出:贴右边缘 - VIEWPORT_MARGIN;左溢出:贴左边缘 + VIEWPORT_MARGIN
  // 3) 下溢出且上方更宽裕:翻到 trigger 上方
  useLayoutEffect(() => {
    if (!open || !triggerRef.current || !menuRef.current) return;
    const anchor = triggerRef.current.getBoundingClientRect();
    const menu = menuRef.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // 水平:默认右对齐(menu.right 对齐 trigger.right),即菜单从 trigger 右端向左展开
    // 这样靠右 toolbar 的 trigger 弹出菜单一定不会越过右边缘
    let left = anchor.right - menu.width;
    if (left < DROPDOWN_VIEWPORT_MARGIN) left = DROPDOWN_VIEWPORT_MARGIN;
    if (left + menu.width > vw - DROPDOWN_VIEWPORT_MARGIN) {
      left = vw - menu.width - DROPDOWN_VIEWPORT_MARGIN;
    }

    // 垂直:默认 trigger 下方;下方放不下且上方更宽裕 → 翻上方
    let top = anchor.bottom + DROPDOWN_ANCHOR_GAP;
    if (top + menu.height > vh - DROPDOWN_VIEWPORT_MARGIN && anchor.top > vh - anchor.bottom) {
      top = anchor.top - menu.height - DROPDOWN_ANCHOR_GAP;
      if (top < DROPDOWN_VIEWPORT_MARGIN) top = DROPDOWN_VIEWPORT_MARGIN;
    }

    setPos({ left, top, visible: true });
  }, [open]);

  // 关闭时清 pos(下次打开重新测,避免拿 stale 坐标先闪一帧)
  useEffect(() => {
    if (!open) setPos(null);
  }, [open]);

  const currentLabel = item.currentLabel?.(ctx) ?? item.label;

  return (
    <div className="krig-toolbar-dropdown">
      <button
        ref={triggerRef}
        type="button"
        className="krig-toolbar-button krig-toolbar-button--default krig-toolbar-dropdown-trigger"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen((v) => !v)}
        title={item.label}
      >
        {currentLabel} <span className="krig-toolbar-dropdown-caret">▾</span>
      </button>
      {open && (
        <div
          ref={menuRef}
          className="krig-toolbar-dropdown-menu"
          style={{
            left: pos?.left ?? 0,
            top: pos?.top ?? 0,
            // 第一帧 pos 还没测出来时藏一下,避免左上角闪一下再跳到正确位置
            visibility: pos?.visible ? 'visible' : 'hidden',
          }}
        >
          {(item.options ?? []).map((opt) => renderDropdownOption(opt, ctx, () => setOpen(false)))}
        </div>
      )}
    </div>
  );
}

function renderDropdownOption(
  opt: DropdownOption,
  ctx: ToolbarItemContext,
  closeMenu: () => void,
) {
  const active = opt.activeWhen?.(ctx) ?? false;
  const disabled = opt.disabled ?? false;
  return (
    <div
      key={opt.id}
      className={
        'krig-toolbar-dropdown-option' +
        (active ? ' active' : '') +
        (disabled ? ' disabled' : '')
      }
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => {
        if (disabled) return;
        commandRegistry.execute(opt.command, opt.commandArg);
        closeMenu();
      }}
    >
      {opt.label}
    </div>
  );
}
