/**
 * ColorPickerPanel — 文字色 + 高亮背景色选择器(L5-B3.4)
 *
 * 用于:浮条 A 按钮 / 顶部 toolbar 弹出(selection-bound)。
 * handle 菜单 Color 走 HandleColorPanel(block-scoped),不复用本组件。
 *
 * 拆分(2026-05-15):
 * - L3 视觉 → ColorSwatchGrid 组件 + TEXT_COLORS / BG_COLORS 共享色板
 * - L4 装配 → 本组件:接 selection 当前色 + 调 setTextColor / setHighlight(不传 range)
 */

import type { PopupCloseProps } from '@slot/interaction-registries/popup-registry/popup-types';
import { workspaceManager } from '@workspace/workspace-state/workspace-manager';
import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import type { TextEditingApi } from '@capabilities/text-editing/types';
import { ColorSwatchGrid, TEXT_COLORS, BG_COLORS } from './ColorSwatchGrid';

export function ColorPickerPanel({ onClose }: PopupCloseProps) {
  const wsId = workspaceManager.getActiveId();
  const api = wsId ? requireCapabilityApi<TextEditingApi>('text-editing').api : null;
  const currentText = api && wsId ? api.getActiveTextColor(wsId) : null;
  const currentBg = api && wsId ? api.getActiveHighlight(wsId) : null;

  const applyText = (color: string) => {
    if (!api || !wsId) return;
    api.setTextColor(wsId, color);
    onClose();
  };

  const applyBg = (color: string) => {
    if (!api || !wsId) return;
    api.setHighlight(wsId, color);
    onClose();
  };

  return (
    <div className="krig-color-picker">
      <ColorSwatchGrid
        sectionLabel="文字颜色"
        swatches={TEXT_COLORS}
        activeColor={currentText}
        defaultDisplayBg="#e8eaed"
        onPick={applyText}
      />
      <div style={{ marginTop: 8 }}>
        <ColorSwatchGrid
          sectionLabel="背景颜色"
          swatches={BG_COLORS}
          activeColor={currentBg}
          defaultDisplayBg="#3a3a3a"
          onPick={applyBg}
        />
      </div>
    </div>
  );
}
