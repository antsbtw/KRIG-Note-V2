/**
 * ShapeContextMenu — 全屏面板内的图形右键菜单(2026-11-06 用户:「复制删除用右键菜单好了」)
 *
 * 只在 math-visual 全屏面板里用,不走 app 的菜单注册表(那套挂在 note 编辑器上,
 * 全屏 overlay 里的画布不在它的范围)。点菜单外 / Esc / 滚轮 关闭。
 */

import React, { useEffect, useRef } from 'react';

export interface ContextMenuItem {
  label: string;
  shortcut?: string;
  danger?: boolean;
  onClick: () => void;
}

/** null = 分隔线 */
export type ContextMenuEntry = ContextMenuItem | null;

export const ShapeContextMenu: React.FC<{
  x: number;
  y: number;
  title?: string;
  entries: ContextMenuEntry[];
  onClose: () => void;
}> = ({ x, y, title, entries, onClose }) => {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); }
    };
    window.addEventListener('mousedown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('wheel', onClose, true);
    return () => {
      window.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('wheel', onClose, true);
    };
  }, [onClose]);

  // 贴着窗口右 / 下边时往回收,别伸出屏幕
  const left = Math.min(x, window.innerWidth - 200);
  const top = Math.min(y, window.innerHeight - 40 - entries.length * 30);

  return (
    <div
      ref={ref}
      onContextMenu={(e) => e.preventDefault()}
      style={{
        position: 'fixed', left, top, zIndex: 10000, minWidth: 180,
        background: '#2a2a2a', border: '1px solid #4a4a4a', borderRadius: 8,
        boxShadow: '0 8px 24px rgba(0,0,0,0.45)', padding: '4px 0',
        color: '#e0e0e0', fontSize: 13,
      }}
    >
      {title && (
        <div style={{ padding: '4px 12px 6px', color: '#a0a0a0', fontSize: 12, borderBottom: '1px solid #3a3a3a', marginBottom: 4 }}>
          {title}
        </div>
      )}
      {entries.map((it, i) =>
        it === null ? (
          <div key={`sep-${i}`} style={{ height: 1, background: '#3a3a3a', margin: '4px 0' }} />
        ) : (
          <div
            key={it.label}
            role="menuitem"
            onClick={() => { it.onClick(); onClose(); }}
            onMouseEnter={(e) => { e.currentTarget.style.background = '#1a3a5c'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            style={{
              display: 'flex', justifyContent: 'space-between', gap: 16,
              padding: '6px 12px', cursor: 'pointer',
              color: it.danger ? '#f87171' : '#e0e0e0',
            }}
          >
            <span>{it.label}</span>
            {it.shortcut && <span style={{ color: '#a0a0a0' }}>{it.shortcut}</span>}
          </div>
        ),
      )}
    </div>
  );
};
