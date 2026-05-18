/**
 * compute/plot-detect — 表达式 → plotType 启发式判定
 *
 * 1:1 迁自 V1 `src/plugins/note/blocks/math-visual/utils.ts`(detectPlotType)。
 *
 * 规则:
 * - "x = <常数>"             → vertical-line(表达式归一为常数值)
 * - "<x(t)>;<y(t)>"          → parametric(单分号,两段表达式)
 * - 其他                      → y-of-x(默认)
 *
 * polar 不在自动检测列表 — driver 侧手动指定 plotType=polar 时才生效。
 */

import type { PlotType } from '../types';

export function detectPlotType(expression: string): { plotType: PlotType; expression: string } {
  const trimmed = expression.trim();
  const vLineMatch = trimmed.match(/^x\s*=\s*(.+)$/);
  if (vLineMatch) {
    const val = Number(vLineMatch[1]);
    if (isFinite(val)) {
      return { plotType: 'vertical-line', expression: String(val) };
    }
  }
  if (trimmed.includes(';') && trimmed.split(';').length === 2) {
    return { plotType: 'parametric', expression: trimmed };
  }
  return { plotType: 'y-of-x', expression: trimmed };
}
