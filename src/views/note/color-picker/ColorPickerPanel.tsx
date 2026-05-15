/**
 * ColorPickerPanel — 文字色 + 高亮背景色选择器(L5-B3.4)
 *
 * 完整 V1 ColorPicker UI:10 文字色 + 10 背景色 swatch 网格
 *
 * 替换 L5-B3.3 的 cycle 按钮(Plan C-1 缩水方案):
 * - cycle 命令(note-view.cycle-text-color / cycle-highlight)保留作快捷键备份(本阶段不绑)
 * - floating-toolbar / 顶部 toolbar 的 A / A̲ 按钮改 popup-trigger
 *
 * 颜色源对齐 V1 ColorPicker:
 * - TEXT_COLORS 10 项(default + 9 色)
 * - BG_COLORS 10 项(default + 9 色)
 *   displayColor:swatch 显示用不透明色(独立于容器底色,深浅 panel 都鲜亮)
 *   applyColor:实际写到 highlight mark 的色值(rgba 0.2,叠在编辑区白稿纸上才不刺眼)
 */

import type { PopupCloseProps } from '@slot/interaction-registries/popup-registry/popup-types';
import { workspaceManager } from '@workspace/workspace-state/workspace-manager';
import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import type { TextEditingApi } from '@capabilities/text-editing/types';

// 色相对齐 Apple FreeForm 调色板(2026-05-14)
// V2 编辑区暗色稿纸 → V1 rgba 0.2 配色全暗,换不透明鲜艳色
// highlight mark toDOM 自带 color:#000 保证浅底+黑字可读
const TEXT_COLORS: ReadonlyArray<{ name: string; color: string }> = [
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

const BG_COLORS: ReadonlyArray<{ name: string; color: string }> = [
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

export function ColorPickerPanel({ onClose }: PopupCloseProps) {
  const wsId = workspaceManager.getActiveId();
  const currentText = wsId ? requireCapabilityApi<TextEditingApi>('text-editing').api.getActiveTextColor(wsId) : null;
  const currentBg = wsId ? requireCapabilityApi<TextEditingApi>('text-editing').api.getActiveHighlight(wsId) : null;

  const applyText = (color: string) => {
    if (!wsId) return;
    requireCapabilityApi<TextEditingApi>('text-editing').api.setTextColor(wsId, color);
    onClose();
  };

  const applyBg = (color: string) => {
    if (!wsId) return;
    requireCapabilityApi<TextEditingApi>('text-editing').api.setHighlight(wsId, color);
    onClose();
  };

  return (
    <div className="krig-color-picker">
      <div className="krig-color-picker__section-label">文字颜色</div>
      <div className="krig-color-picker__grid">
        {TEXT_COLORS.map((c) => {
          const active = (currentText ?? '') === c.color;
          return (
            <button
              key={`t-${c.name}`}
              type="button"
              className={`krig-color-picker__swatch${active ? ' active' : ''}`}
              style={{ background: c.color || '#e8eaed' }}
              title={c.name}
              onClick={() => applyText(c.color)}
            />
          );
        })}
      </div>

      <div className="krig-color-picker__section-label" style={{ marginTop: 8 }}>
        背景颜色
      </div>
      <div className="krig-color-picker__grid">
        {BG_COLORS.map((c) => {
          const active = (currentBg ?? '') === c.color;
          return (
            <button
              key={`b-${c.name}`}
              type="button"
              className={`krig-color-picker__swatch${active ? ' active' : ''}`}
              style={{ background: c.color || '#3a3a3a' }}
              title={c.name}
              onClick={() => applyBg(c.color)}
            />
          );
        })}
      </div>
    </div>
  );
}
