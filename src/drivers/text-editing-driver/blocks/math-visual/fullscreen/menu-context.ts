/**
 * MathVisual 全屏 menu-context — 模块级 SSOT
 *
 * 模式对齐 V2 `src/drivers/text-editing-driver/blocks/code-block/fullscreen/menu-context.ts`:
 * - inline 全屏按钮触发时 setMathVisualFullscreenContext({ instanceId, nodePos })
 * - L2 Binding 渲染 MathVisualFullscreenPanel,Panel mount 时 getMathVisualFullscreenContext()
 *   拿数据(查 PM doc 当前 node)
 * - Panel unmount 时 clearMathVisualFullscreenContext()
 *
 * 单时刻只能一个 overlay 开,故模块级单例不会撞。
 */

export interface MathVisualFullscreenContext {
  instanceId: string;     // driver instance ID
  nodePos: number;        // mathVisual 节点起点(getPos() 返回值)
}

let current: MathVisualFullscreenContext | null = null;

export function setMathVisualFullscreenContext(ctx: MathVisualFullscreenContext): void {
  current = ctx;
}

export function getMathVisualFullscreenContext(): MathVisualFullscreenContext | null {
  return current;
}

export function clearMathVisualFullscreenContext(): void {
  current = null;
}
