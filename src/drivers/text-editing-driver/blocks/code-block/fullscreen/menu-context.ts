/**
 * Code fullscreen overlay context — 模块级 SSOT 传 payload
 *
 * 对齐 [[table/menu-context]] 模式:fullscreenOverlayController.show(id) 不带额外参,
 * 而 CodeFullscreenPanel 需要知道目标 PM 实例 + 节点位置 + 语言才能正确写回。
 *
 * 触发链:
 *   node-view 全屏按钮 mousedown
 *     → setCodeFullscreenContext({ instanceId, nodePos, language })
 *     → fullscreenOverlayController.show('text-editing.fullscreen.code')
 *     → FullscreenOverlayBinding 渲染 CodeFullscreenPanel
 *     → Panel mount 时 getCodeFullscreenContext() 拿 ctx
 *     → 关闭(Esc / × / 业务方主动)时通过 instanceRegistry.get(instanceId).view 写回
 *     → unmount cleanup 清 ctx
 *
 * 单实例:fullscreenOverlayController 同一时刻只允许一个 overlay,模块级单变量
 * 不会撞。
 *
 * Phase 3:`MermaidFullscreenContext` → `CodeFullscreenContext`(加 language 字段);
 * 旧名作 type alias + setter/getter/clear alias 保留,允许下游短期内继续 import 旧名。
 */

export interface CodeFullscreenContext {
  /** driver instanceId(node-view 从 view.dom data-instance-id 反查)*/
  instanceId: string;
  /** 目标 codeBlock 节点在 doc 中的起点(getPos() 返回值)*/
  nodePos: number;
  /** 当前 attrs.language —— '' 表示 plain text;'mermaid' 走 preview 路径 */
  language: string;
}

/** Phase 3 兼容别名 — 等下游全部迁完可删 */
export type MermaidFullscreenContext = CodeFullscreenContext;

let current: CodeFullscreenContext | null = null;

export function setCodeFullscreenContext(ctx: CodeFullscreenContext): void {
  current = ctx;
}

export function getCodeFullscreenContext(): CodeFullscreenContext | null {
  return current;
}

export function clearCodeFullscreenContext(): void {
  current = null;
}

/** Phase 3 兼容别名 — 等下游全部迁完可删 */
export const setMermaidFullscreenContext = setCodeFullscreenContext;
export const getMermaidFullscreenContext = getCodeFullscreenContext;
export const clearMermaidFullscreenContext = clearCodeFullscreenContext;
