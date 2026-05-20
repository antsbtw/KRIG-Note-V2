/**
 * latex help-panel — 公共 export(LaTeX 公式速查)
 *
 * 注册到 helpPanelRegistry 由 text-editing capability 完成(对齐 math-visual help-panel)。
 * 触发由 math-block / math-inline node-view 的 ? 按钮(走 setContext + helpPanelController.show)。
 */

export { LatexHelpPanel } from './LatexHelpPanel';
export {
  setLatexHelpContext,
  getLatexHelpContext,
  clearLatexHelpContext,
  type LatexHelpContext,
} from './help-context';
export const LATEX_HELP_PANEL_ID = 'text-editing.help.latex';
