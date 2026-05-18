/**
 * text-editing help-panel 注册(对齐 learning/ui/help-panels.ts 模式)
 *
 * 模式:capability 加载时一次性注册;触发由 driver inline component / 全屏 Panel
 * 走 helpPanelController.show(id) — 不通过 capability API 暴露(panel 内交互
 * 与 capability 无关,直接用 controller)。
 *
 * 注册时机:capability 顶层 import 副作用 — text-editing capability index.ts
 * 调 registerTextEditingHelpPanels()。
 */

import { helpPanelRegistry }
  from '@slot/interaction-registries/help-panel-registry/help-panel-registry';
import { MathVisualHelpPanel, MATH_VISUAL_HELP_PANEL_ID }
  from '@drivers/text-editing-driver/blocks/math-visual/help-panel';

/** capability 加载时一次性注册 text-editing 全部 help-panel */
export function registerTextEditingHelpPanels(): void {
  // math-visual:函数图形参考(Phase 3,V1 directly 迁)
  helpPanelRegistry.register({
    id: MATH_VISUAL_HELP_PANEL_ID,
    title: 'Function Reference',
    Component: MathVisualHelpPanel,
    // 点击 math-visual block 内 / 全屏内不算"点外部",不关闭面板
    excludeFromClickOutside: ['.krig-math-visual', '.mv-fullscreen-overlay'],
  });
}
