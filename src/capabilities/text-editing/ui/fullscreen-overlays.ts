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
 * 触发链(以 mermaid 为例):
 *   node-view 全屏按钮 mousedown
 *     → setMermaidFullscreenContext({ instanceId, nodePos })
 *     → fullscreenOverlayController.show('text-editing.fullscreen.mermaid')
 *     → FullscreenOverlayBinding 渲染 MermaidFullscreenPanel
 *     → 关闭(Esc / × / business hide)→ binding unmount → cleanup 写回 PM
 */

import { fullscreenOverlayRegistry }
  from '@slot/interaction-registries/fullscreen-overlay-registry/registry';
import { MermaidFullscreenPanel }
  from '@drivers/text-editing-driver/blocks/code-block/fullscreen/MermaidFullscreenPanel';

/** capability 加载时一次性注册所有 text-editing 相关 fullscreen overlay */
export function registerTextEditingFullscreenOverlays(): void {
  fullscreenOverlayRegistry.register({
    id: 'text-editing.fullscreen.mermaid',
    Component: MermaidFullscreenPanel,
  });
}
