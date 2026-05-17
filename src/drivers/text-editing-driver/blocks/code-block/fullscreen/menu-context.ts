/**
 * mermaid fullscreen overlay context — 模块级 SSOT 传 payload
 *
 * 对齐 [[table/menu-context]] 模式:fullscreenOverlayController.show(id) 不带额外参,
 * 而 MermaidFullscreenPanel 需要知道目标 PM 实例 + mermaid 节点位置才能写回。
 *
 * 触发链:
 *   node-view 全屏按钮 mousedown
 *     → setMermaidFullscreenContext({ instanceId, nodePos })
 *     → fullscreenOverlayController.show('text-editing.fullscreen.mermaid')
 *     → FullscreenOverlayBinding 渲染 MermaidFullscreenPanel
 *     → Panel mount 时 getMermaidFullscreenContext() 拿 ctx
 *     → 关闭(Esc / × / 业务方主动)时通过 instanceRegistry.get(instanceId).view 写回
 *     → unmount cleanup 清 ctx
 *
 * 单实例:fullscreenOverlayController 同一时刻只允许一个 overlay,模块级单变量
 * 不会撞。
 */

export interface MermaidFullscreenContext {
  /** driver instanceId(node-view 从 view.dom data-instance-id 反查)*/
  instanceId: string;
  /** 目标 codeBlock 节点在 doc 中的起点(getPos() 返回值)*/
  nodePos: number;
}

let current: MermaidFullscreenContext | null = null;

export function setMermaidFullscreenContext(ctx: MermaidFullscreenContext): void {
  current = ctx;
}

export function getMermaidFullscreenContext(): MermaidFullscreenContext | null {
  return current;
}

export function clearMermaidFullscreenContext(): void {
  current = null;
}
