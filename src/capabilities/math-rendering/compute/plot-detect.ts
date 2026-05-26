/**
 * compute/plot-detect — 表达式 → plotType 启发式判定
 *
 * 规则(按优先级):
 * - "x = <常数>"             → vertical-line(表达式归一为常数值)
 * - "<x(t)>;<y(t)>"          → parametric(单分号,两段表达式)
 * - "y = <expr>"             → y-of-x(只取右侧表达式)
 * - 含 = 的其他二元方程      → implicit(归一为 "left - (right)" 即 F(x,y)=0 形式)
 * - 其他                      → y-of-x(默认,隐含 y =)
 *
 * polar 不在自动检测列表 — driver 侧手动指定 plotType=polar 时才生效。
 */

import type { PlotType } from '../types';

/**
 * detectPlotType 返回:
 * - plotType: 启发式判定的曲线类型
 * - expression: 归一化后的表达式(喂给求值器,如 implicit 的 F(x,y) 形式)
 * - displayExpression: 用户原始输入(忠实保留,用于 UI 显示)
 */
export function detectPlotType(expression: string): {
  plotType: PlotType;
  expression: string;
  displayExpression: string;
} {
  const trimmed = expression.trim();

  // 1. x = <常数> → vertical-line
  const vLineMatch = trimmed.match(/^x\s*=\s*(.+)$/);
  if (vLineMatch) {
    const val = Number(vLineMatch[1]);
    if (isFinite(val)) {
      return { plotType: 'vertical-line', expression: String(val), displayExpression: trimmed };
    }
  }

  // 2. parametric: 单分号两段
  if (trimmed.includes(';') && trimmed.split(';').length === 2) {
    return { plotType: 'parametric', expression: trimmed, displayExpression: trimmed };
  }

  // 3. y = <expr> → y-of-x(只取右侧)
  const yOfXMatch = trimmed.match(/^y\s*=\s*(.+)$/);
  if (yOfXMatch) {
    return { plotType: 'y-of-x', expression: yOfXMatch[1].trim(), displayExpression: trimmed };
  }

  // 4. 含 = 的二元方程 → implicit(归一为 "left - (right)" → F(x,y)=0)
  const eqIdx = trimmed.indexOf('=');
  if (eqIdx > 0 && eqIdx < trimmed.length - 1) {
    const left = trimmed.slice(0, eqIdx).trim();
    const right = trimmed.slice(eqIdx + 1).trim();
    if (left && right) {
      // F(x,y) = left - (right);用括号包裹避免减号歧义
      return {
        plotType: 'implicit',
        expression: `(${left}) - (${right})`,
        displayExpression: trimmed,
      };
    }
  }

  // 5. 其他 → y-of-x(隐含 y =)
  return { plotType: 'y-of-x', expression: trimmed, displayExpression: trimmed };
}
