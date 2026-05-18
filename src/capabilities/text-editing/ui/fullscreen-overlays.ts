/**
 * text-editing fullscreen-overlay 注册(对齐 popups.ts 模式)
 *
 * Fullscreen overlay 与 popup 的关键差异:
 * - popup:view-scoped 小弹层(LinkPanel / ColorPicker 等),anchor 定位
 * - fullscreen-overlay:app-scoped 全屏视图(mermaid 全屏 / 未来 PDF / 画板等),
 *   撑满 viewport,workspace 层隐藏
 *
 * 详见 src/shell/DESIGN.md v0.4 § 1.2 边界辨析。
 *
 * 触发链(Phase 3 后通用 — mermaid / plain / JS / TS / Py / JSON / MD 都走它):
 *   node-view 全屏按钮 mousedown
 *     → setCodeFullscreenContext({ instanceId, nodePos, language })
 *     → fullscreenOverlayController.show('text-editing.fullscreen.code')
 *     → FullscreenOverlayBinding 渲染 CodeFullscreenPanel
 *     → 关闭(Esc / × / business hide)→ binding unmount → cleanup 写回 PM
 *
 * Phase 3 alias:旧 id `text-editing.fullscreen.mermaid` 同时注册指向同一 Component,
 * 短期兼容老 trigger;Phase 4 全部下游迁完后可删。
 */

import { fullscreenOverlayRegistry }
  from '@slot/interaction-registries/fullscreen-overlay-registry/registry';
import { CodeFullscreenPanel }
  from '@drivers/text-editing-driver/blocks/code-block/fullscreen/CodeFullscreenPanel';
import { MathVisualFullscreenPanel }
  from '@drivers/text-editing-driver/blocks/math-visual/fullscreen/MathVisualFullscreenPanel';

/** capability 加载时一次性注册所有 text-editing 相关 fullscreen overlay */
export function registerTextEditingFullscreenOverlays(): void {
  fullscreenOverlayRegistry.register({
    id: 'text-editing.fullscreen.code',
    Component: CodeFullscreenPanel,
  });
  // alias:Phase 3 兼容(老的 'text-editing.fullscreen.mermaid' trigger 仍能工作)
  fullscreenOverlayRegistry.register({
    id: 'text-editing.fullscreen.mermaid',
    Component: CodeFullscreenPanel,
  });
  // math-visual 全屏(Phase 2):独立 Component,共用 L2 机制
  fullscreenOverlayRegistry.register({
    id: 'text-editing.fullscreen.math-visual',
    Component: MathVisualFullscreenPanel,
  });
}
