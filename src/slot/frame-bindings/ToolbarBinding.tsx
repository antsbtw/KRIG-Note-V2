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

function ToolbarDropdown({ item, ctx }: { item: ToolbarItem; ctx: ToolbarItemContext }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

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

  // 浮层定位(锚 trigger 下边缘)
  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    setPos({ left: rect.left, top: rect.bottom + 2 });
  }, [open]);

  const currentLabel = item.currentLabel?.(ctx) ?? item.label;

  return (
    <div className="krig-toolbar-dropdown">
      <button
        ref={triggerRef}
        type="button"
        className="krig-toolbar-button krig-toolbar-dropdown-trigger"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen((v) => !v)}
        title={item.label}
      >
        {currentLabel} <span className="krig-toolbar-dropdown-caret">▾</span>
      </button>
      {open && pos && (
        <div
          ref={menuRef}
          className="krig-toolbar-dropdown-menu"
          style={{ left: pos.left, top: pos.top }}
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
