/**
 * ColorPickerPanel — 文字色 + 高亮背景色选择器(L5-B3.4)
 *
 * 用于:浮条 A 按钮 / 顶部 toolbar 弹出(selection-bound)。
 * handle 菜单 Color 走 HandleColorSubmenu(block-scoped),不复用本组件。
 *
 * 分层(2026-05-15 上提到 capability/text-editing/ui):
 * - L3 视觉 → ColorSwatchGrid 组件 + TEXT_COLORS / BG_COLORS 共享色板
 * - L4 装配 → 本组件:接 focused PM 实例 + 调 setTextColor / setHighlight(不传 range)
 *
 * instanceId 来源 — instanceRegistry.getFocusedInstanceId()(L5-G4.5):
 * 浮条 A 触发时 PM EditorView 仍持有焦点(toolbar 不抢 focus),取真正在编辑的实例。
 * **不能用 workspaceManager.getActiveId()** — canvas-text-node 场景 instanceId 是
 * 复合 `${workspaceId}::${nodeId}`,与 workspaceId 不等。
 */

import type { PopupCloseProps } from '@slot/interaction-registries/popup-registry/popup-types';
import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import type { TextEditingApi } from '@capabilities/text-editing/types';
import { ColorSwatchGrid, TEXT_COLORS, BG_COLORS } from './ColorSwatchGrid';

export function ColorPickerPanel({ onClose }: PopupCloseProps) {
  const textEditing = requireCapabilityApi<TextEditingApi>('text-editing');
  const instanceId = textEditing.instanceRegistry.getFocusedInstanceId();
  const api = textEditing.api;
  const currentText = instanceId ? api.getActiveTextColor(instanceId) : null;
  const currentBg = instanceId ? api.getActiveHighlight(instanceId) : null;

  const applyText = (color: string) => {
    if (!instanceId) return;
    api.setTextColor(instanceId, color);
    onClose();
  };

  const applyBg = (color: string) => {
    if (!instanceId) return;
    api.setHighlight(instanceId, color);
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
