/**
 * math-visual help-panel — 公共 export
 *
 * 注册到 helpPanelRegistry 由 text-editing capability 完成(对齐 learning 模式)。
 * 触发由 inline component 的 ? 按钮(走 setContext + helpPanelController.show)。
 */

export { MathVisualHelpPanel } from './MathVisualHelpPanel';
export {
  setMathVisualHelpContext,
  getMathVisualHelpContext,
  clearMathVisualHelpContext,
  type MathVisualHelpContext,
} from './help-context';
export const MATH_VISUAL_HELP_PANEL_ID = 'text-editing.help.math-visual';
