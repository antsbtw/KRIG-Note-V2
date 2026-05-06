/**
 * ContextMenuPopover — 通用右键菜单浮层
 *
 * 1:1 沿用 V1 src/renderer/navside/components/FolderTree/ContextMenu.tsx。
 * 改造点:item.command 字段优先走 commandRegistry,否则 fallback onClick。
 */

import { useEffect, useRef, useState, useLayoutEffect, type CSSProperties } from 'react';
import { commandRegistry } from '@slot/command-registry/command-registry';
import type { ContextMenuPopoverProps } from './types';

const baseStyles: Record<string, CSSProperties> = {
  popover: {
    position: 'fixed',
    background: 'rgba(30,30,30,0.98)',
    border: '1px solid #444',
    borderRadius: 4,
    boxShadow: '0 4px 14px rgba(0,0,0,0.5)',
    padding: '4px 0',
    minWidth: 140,
    zIndex: 2000,
    fontSize: 12,
    color: '#ccc',
  },
  item: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '5px 10px',
    cursor: 'pointer',
  },
  itemDisabled: {
    color: '#555',
    cursor: 'default',
  },
  separator: {
    height: 1,
    background: '#444',
    margin: '4px 0',
  },
};

export function ContextMenuPopover({ x, y, items, onClose }: ContextMenuPopoverProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; visible: boolean }>({
    left: x,
    top: y,
    visible: false,
  });

  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose]);

  // 测量后边界翻转
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const margin = 4;
    let left = x;
    let top = y;
    if (left + rect.width > vw - margin) left = Math.max(margin, x - rect.width);
    if (top + rect.height > vh - margin) top = Math.max(margin, y - rect.height);
    setPos({ left, top, visible: true });
  }, [x, y]);

  if (items.length === 0) return null;

  return (
    <div
      ref={ref}
      style={{
        ...baseStyles.popover,
        left: pos.left,
        top: pos.top,
        visibility: pos.visible ? 'visible' : 'hidden',
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {items.map((item) => {
        if (item.separator) return <div key={item.id} style={baseStyles.separator} />;
        const itemStyle = {
          ...baseStyles.item,
          ...(item.disabled ? baseStyles.itemDisabled : {}),
        };
        return (
          <div
            key={item.id}
            style={itemStyle}
            onClick={() => {
              if (item.disabled) return;
              if (item.command) {
                commandRegistry.execute(item.command, item.commandArg);
              } else {
                item.onClick?.();
              }
              onClose();
            }}
            onMouseEnter={(e) => {
              if (!item.disabled) e.currentTarget.style.background = '#3a3a3a';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
            }}
          >
            {item.icon && <span>{item.icon}</span>}
            <span>{item.label}</span>
          </div>
        );
      })}
    </div>
  );
}
