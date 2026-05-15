/**
 * HandleColorSubmenu — handle 菜单 Color submenu 自定义渲染内容(block-scoped)
 *
 * 通过 HandleItem.submenuRender 装入 ⠿ → 🎨 Color hover 浮出 submenu。
 * 复用 ColorSwatchGrid 视觉组件 + TEXT_COLORS / BG_COLORS 共享色板。
 *
 * 与 ColorPickerPanel(selection-bound)的区别:
 * - 拿 blockPos 不拿 selection
 * - 调 applyBlockTextColor / applyBlockBgColor(内部 mathBlock 走 node attr 分流)
 *
 * instanceId 来源:通过 workspaceManager.getActiveId() 取(与 note-commands.ts
 * getHandlePos 同源)— ctx.viewId 是 view 类型名("note-view"),不是 driver
 * instanceId。
 */

import type { HandleSubmenuContext } from '@slot/interaction-registries/handle-registry/handle-types';
import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import type { TextEditingApi } from '@capabilities/text-editing/types';
import { workspaceManager } from '@workspace/workspace-state/workspace-manager';
import { ColorSwatchGrid, TEXT_COLORS, BG_COLORS } from './ColorSwatchGrid';

interface HandleColorSubmenuProps {
  ctx: HandleSubmenuContext;
}

export function HandleColorSubmenu({ ctx }: HandleColorSubmenuProps) {
  const instanceId = workspaceManager.getActiveId();
  const api = requireCapabilityApi<TextEditingApi>('text-editing').api;
  const currentText = instanceId ? api.getBlockTextColor(instanceId, ctx.blockPos) : null;
  const currentBg = instanceId ? api.getBlockBgColor(instanceId, ctx.blockPos) : null;

  const applyText = (color: string) => {
    if (!instanceId) return;
    api.applyBlockTextColor(instanceId, ctx.blockPos, color);
    ctx.close();
  };

  const applyBg = (color: string) => {
    if (!instanceId) return;
    api.applyBlockBgColor(instanceId, ctx.blockPos, color);
    ctx.close();
  };

  return (
    <div className="krig-color-picker krig-color-picker--handle-submenu">
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
