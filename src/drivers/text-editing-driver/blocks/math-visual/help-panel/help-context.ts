/**
 * MathVisual help-panel context — 模块级 SSOT
 *
 * 模式对齐 Phase 2 fullscreen/menu-context.ts:
 * - inline ? 按钮触发时 setMathVisualHelpContext({ insertFn })
 * - MathVisualHelpPanel mount 时 getMathVisualHelpContext().insertFn
 * - Panel 内点 Insert → 调 insertFn(expr) → 插入到当前 math-visual 函数行
 *
 * V2 helpPanelRegistry.register 的 Component 只接 HelpPanelCloseProps,
 * insertFn 这种业务回调走模块级 SSOT 传递。同一时刻只一个 help-panel 可见,
 * 不会撞。
 */

export interface MathVisualHelpContext {
  /** 插入表达式回调:Panel 内点 Insert 按钮时调,inline 端注入到 active 函数行 */
  insertFn: (expr: string) => void;
}

let current: MathVisualHelpContext | null = null;

export function setMathVisualHelpContext(ctx: MathVisualHelpContext): void {
  current = ctx;
}

export function getMathVisualHelpContext(): MathVisualHelpContext | null {
  return current;
}

export function clearMathVisualHelpContext(): void {
  current = null;
}
