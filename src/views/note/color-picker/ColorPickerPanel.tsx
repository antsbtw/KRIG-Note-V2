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
 * - BG_COLORS 10 项(default + 9 色 rgba 0.2)
 */

import type { PopupCloseProps } from '@slot/interaction-registries/popup-registry/popup-types';
import { workspaceManager } from '@workspace/workspace-state/workspace-manager';
import { textEditingDriverApi } from '@drivers/text-editing-driver';

const TEXT_COLORS: ReadonlyArray<{ name: string; color: string }> = [
  { name: 'Default', color: '' },
  { name: 'Gray', color: '#9aa0a6' },
  { name: 'Brown', color: '#a67c52' },
  { name: 'Orange', color: '#f29900' },
  { name: 'Yellow', color: '#f5c518' },
  { name: 'Green', color: '#34a853' },
  { name: 'Blue', color: '#8ab4f8' },
  { name: 'Purple', color: '#c58af9' },
  { name: 'Pink', color: '#f48fb1' },
  { name: 'Red', color: '#ea4335' },
];

const BG_COLORS: ReadonlyArray<{ name: string; color: string }> = [
  { name: 'Default', color: '' },
  { name: 'Gray', color: 'rgba(154, 160, 166, 0.2)' },
  { name: 'Brown', color: 'rgba(166, 124, 82, 0.2)' },
  { name: 'Orange', color: 'rgba(242, 153, 0, 0.2)' },
  { name: 'Yellow', color: 'rgba(245, 197, 24, 0.2)' },
  { name: 'Green', color: 'rgba(52, 168, 83, 0.2)' },
  { name: 'Blue', color: 'rgba(138, 180, 248, 0.2)' },
  { name: 'Purple', color: 'rgba(197, 138, 249, 0.2)' },
  { name: 'Pink', color: 'rgba(244, 143, 177, 0.2)' },
  { name: 'Red', color: 'rgba(234, 67, 53, 0.2)' },
];

export function ColorPickerPanel({ onClose }: PopupCloseProps) {
  const wsId = workspaceManager.getActiveId();
  const currentText = wsId ? textEditingDriverApi.getActiveTextColor(wsId) : null;
  const currentBg = wsId ? textEditingDriverApi.getActiveHighlight(wsId) : null;

  const applyText = (color: string) => {
    if (!wsId) return;
    textEditingDriverApi.setTextColor(wsId, color);
    onClose();
  };

  const applyBg = (color: string) => {
    if (!wsId) return;
    textEditingDriverApi.setHighlight(wsId, color);
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
