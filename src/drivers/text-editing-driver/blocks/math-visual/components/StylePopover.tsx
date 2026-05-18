/**
 * StylePopover — 颜色/线宽/线型选择弹出面板
 *
 * 1:1 迁自 V1 `src/plugins/note/blocks/math-visual/components/StylePopover.tsx`。
 * 零依赖,纯 UI。
 */

import React from 'react';

const COLORS = ['#2D7FF9', '#00D4AA', '#FF6B35', '#A855F7', '#EC4899', '#EAB308', '#ef4444', '#8B5CF6', '#06B6D4', '#84CC16'];

export function StylePopover({
  color,
  lineWidth,
  style,
  onChangeColor,
  onChangeLineWidth,
  onChangeStyle,
}: {
  color: string;
  lineWidth: number;
  style: 'solid' | 'dashed' | 'dotted';
  onChangeColor: (c: string) => void;
  onChangeLineWidth: (w: number) => void;
  onChangeStyle: (s: 'solid' | 'dashed' | 'dotted') => void;
}) {
  return (
    <div className="mv-style-popover" onMouseDown={(e) => e.stopPropagation()}>
      <div className="mv-style-colors">
        {COLORS.map((c) => (
          <span
            key={c}
            className={`mv-style-swatch ${c === color ? 'mv-style-swatch--active' : ''}`}
            style={{ backgroundColor: c }}
            onClick={() => onChangeColor(c)}
          />
        ))}
      </div>
      <div className="mv-style-row">
        <span className="mv-style-label">线宽</span>
        <input
          type="range" min="1" max="6" step="0.5" value={lineWidth}
          className="mv-style-slider"
          onChange={(e) => onChangeLineWidth(Number(e.target.value))}
        />
        <span className="mv-style-value">{lineWidth}</span>
      </div>
      <div className="mv-style-row">
        <span className="mv-style-label">线型</span>
        <div className="mv-style-btns">
          {(['solid', 'dashed', 'dotted'] as const).map((s) => (
            <button key={s} className={`mv-style-btn ${s === style ? 'mv-style-btn--active' : ''}`}
              onClick={() => onChangeStyle(s)}>
              {s === 'solid' ? '━━' : s === 'dashed' ? '╌╌' : '┈┈'}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
