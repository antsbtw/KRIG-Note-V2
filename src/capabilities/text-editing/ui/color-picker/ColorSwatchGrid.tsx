/**
 * ColorSwatchGrid — 颜色 swatch 网格(L3 视觉层)
 *
 * 纯视觉组件:接 swatches + activeColor + onPick callback,不知道颜色去哪。
 * 复用方:
 * - ColorPickerPanel(selection-bound,floating toolbar / 顶部 toolbar 用)
 * - HandleColorSubmenu(block-scoped,handle 菜单用)
 */

import type { ReactNode } from 'react';

export interface ColorSwatch {
  /** 显示名(swatch title 提示 + key)*/
  name: string;
  /** 实际写到 mark / attr 的色值。空字符串表示 "Default / 无色" */
  color: string;
}

interface ColorSwatchGridProps {
  /** 区段标签(渲染在 grid 上方) */
  sectionLabel: ReactNode;
  /** swatch 列表 */
  swatches: ReadonlyArray<ColorSwatch>;
  /** 当前 active 颜色(等于该 swatch.color 时高亮)。null = 取 Default */
  activeColor: string | null;
  /** Default swatch 的占位底色(swatch.color === '' 时实际渲染用),给视觉对比 */
  defaultDisplayBg: string;
  /** 点击 swatch */
  onPick: (color: string) => void;
}

export function ColorSwatchGrid({
  sectionLabel,
  swatches,
  activeColor,
  defaultDisplayBg,
  onPick,
}: ColorSwatchGridProps) {
  return (
    <>
      <div className="krig-color-picker__section-label">{sectionLabel}</div>
      <div className="krig-color-picker__grid">
        {swatches.map((c) => {
          const active = (activeColor ?? '') === c.color;
          return (
            <button
              key={c.name}
              type="button"
              className={`krig-color-picker__swatch${active ? ' active' : ''}`}
              style={{ background: c.color || defaultDisplayBg }}
              title={c.name}
              onClick={() => onPick(c.color)}
            />
          );
        })}
      </div>
    </>
  );
}

// 共享色板(与 V1 ColorPicker 对齐,FreeForm 调色板风格)
export const TEXT_COLORS: ReadonlyArray<ColorSwatch> = [
  { name: 'Default', color: '' },
  { name: 'Gray',    color: '#c8c8c8' },
  { name: 'Mint',    color: '#7ee5c8' },
  { name: 'Orange',  color: '#f29900' },
  { name: 'Yellow',  color: '#d4b85a' },
  { name: 'Green',   color: '#7cc26b' },
  { name: 'Blue',    color: '#5cb8e8' },
  { name: 'Purple',  color: '#7c4dff' },
  { name: 'Pink',    color: '#e85a9a' },
  { name: 'Red',     color: '#e74c3c' },
];

export const BG_COLORS: ReadonlyArray<ColorSwatch> = [
  { name: 'Default', color: '' },
  { name: 'Gray',    color: '#c8c8c8' },
  { name: 'Mint',    color: '#7ee5c8' },
  { name: 'Orange',  color: '#f29900' },
  { name: 'Yellow',  color: '#d4b85a' },
  { name: 'Green',   color: '#7cc26b' },
  { name: 'Blue',    color: '#5cb8e8' },
  { name: 'Purple',  color: '#7c4dff' },
  { name: 'Pink',    color: '#e85a9a' },
  { name: 'Red',     color: '#e74c3c' },
];
