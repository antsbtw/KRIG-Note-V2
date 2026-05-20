/**
 * Latex help-panel context — 模块级 SSOT
 *
 * 模式对齐 math-visual/help-panel/help-context.ts:
 * - math-block / math-inline 的 ? 按钮触发时 setLatexHelpContext({ insertFn })
 * - LatexHelpPanel mount 时 getLatexHelpContext().insertFn
 * - Panel 内点 Insert → 调 insertFn(latex) → 插到当前 math-block / math-inline 光标位
 *
 * V2 helpPanelRegistry.register 的 Component 只接 HelpPanelCloseProps,
 * insertFn 这种业务回调走模块级 SSOT 传递。同一时刻只一个 help-panel 可见,
 * 不会撞;切换 active block(e.g. 从 mathBlock 切到 mathInline) 时调
 * setLatexHelpContext 即覆盖旧的。
 */

export interface LatexHelpContext {
  /** 插入 LaTeX 回调:Panel 内点 Insert 按钮时调,active block 端注入到光标位 */
  insertFn: (latex: string) => void;
}

let current: LatexHelpContext | null = null;

export function setLatexHelpContext(ctx: LatexHelpContext): void {
  current = ctx;
}

export function getLatexHelpContext(): LatexHelpContext | null {
  return current;
}

export function clearLatexHelpContext(): void {
  current = null;
}
