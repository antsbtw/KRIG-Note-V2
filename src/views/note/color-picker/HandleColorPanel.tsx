/**
 * HandleColorPanel — handle 菜单 Color panel(block-scoped 装配)
 *
 * 用于:handle 菜单 ⠿ → Color panel(2026-05-15,对齐 Notion handle UX)。
 * 复用 ColorSwatchGrid 视觉组件 + TEXT_COLORS / BG_COLORS 共享色板。
 *
 * 与 ColorPickerPanel(selection-bound)的区别:
 * - 拿 blockPos 不拿 selection
 * - 调 applyBlockTextColor / applyBlockBgColor(内部 mathBlock 走 node attr 分流)
 */

import type { HandlePanelContext } from '@slot/interaction-registries/handle-registry/handle-types';
import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import type { TextEditingApi } from '@capabilities/text-editing/types';
import { ColorSwatchGrid, TEXT_COLORS, BG_COLORS } from './ColorSwatchGrid';

interface HandleColorPanelProps {
  ctx: HandlePanelContext;
}

export function HandleColorPanel({ ctx }: HandleColorPanelProps) {
  const api = requireCapabilityApi<TextEditingApi>('text-editing').api;
  const currentText = api.getBlockTextColor(ctx.viewId, ctx.blockPos);
  const currentBg = api.getBlockBgColor(ctx.viewId, ctx.blockPos);

  const applyText = (color: string) => {
    api.applyBlockTextColor(ctx.viewId, ctx.blockPos, color);
    ctx.close();
  };

  const applyBg = (color: string) => {
    api.applyBlockBgColor(ctx.viewId, ctx.blockPos, color);
    ctx.close();
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
