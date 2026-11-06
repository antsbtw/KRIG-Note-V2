/**
 * math-rendering 几何对象的纯计算 + 常量表达式求值(题意图 P1,2026-11-06)
 * 设计稿:docs/10-business-design/math/题意图-几何对象与分帧设计.md
 */
import { describe, it, expect } from 'vitest';
import {
  cardinalOf, tickPositions, leftNormal, formatTickValue, MAX_TICKS,
  screenUnit, labelShiftPx, labelLayout, shapeLabelBox,
} from '@capabilities/math-rendering/compute/shape-geometry';
import { evalScalar } from '@capabilities/math-rendering/compute/evaluator';

describe('cardinalOf', () => {
  it('四正方向与四斜方向', () => {
    expect(cardinalOf(0, 1)).toBe('n');
    expect(cardinalOf(1, 0)).toBe('e');
    expect(cardinalOf(0, -1)).toBe('s');
    expect(cardinalOf(-1, 0)).toBe('w');
    expect(cardinalOf(1, 1)).toBe('ne');
    expect(cardinalOf(-1, -1)).toBe('sw');
  });
  it('零向量给 ne 不抛', () => {
    expect(cardinalOf(0, 0)).toBe('ne');
  });
});

describe('tickPositions', () => {
  it('Andy 向北 24 英里、每 8 一道 → 8 / 16 / 24 三道', () => {
    expect(tickPositions([0, 0], [0, 24], 8)).toEqual([[0, 8], [0, 16], [0, 24]]);
  });
  it('不含起点;终点不在刻度上就不画到终点', () => {
    expect(tickPositions([0, 0], [10, 0], 4)).toEqual([[4, 0], [8, 0]]);
  });
  it('step ≤ 0 或零长度 → 空', () => {
    expect(tickPositions([0, 0], [0, 10], 0)).toEqual([]);
    expect(tickPositions([0, 0], [0, 10], -1)).toEqual([]);
    expect(tickPositions([1, 1], [1, 1], 2)).toEqual([]);
  });
  it('超过上限 → null(调用方报错,不画一团黑)', () => {
    expect(tickPositions([0, 0], [MAX_TICKS + 1, 0], 1)).toBeNull();
    expect(tickPositions([0, 0], [MAX_TICKS, 0], 1)).toHaveLength(MAX_TICKS);
  });
});

describe('leftNormal / formatTickValue', () => {
  it('向北的线左侧是西,向东的线左侧是北', () => {
    const n1 = leftNormal([0, 0], [0, 5]);
    expect(n1[0]).toBeCloseTo(-1);
    expect(n1[1]).toBeCloseTo(0);
    const n2 = leftNormal([0, 0], [5, 0]);
    expect(n2[0]).toBeCloseTo(0);
    expect(n2[1]).toBeCloseTo(1);
  });
  it('整数原样,小数两位', () => {
    expect(formatTickValue(16)).toBe('16');
    expect(formatTickValue(0.1 + 0.2)).toBe('0.3');
    expect(formatTickValue(2.5)).toBe('2.5');
  });
});

describe('evalScalar', () => {
  it('数字与引用参数', () => {
    expect(evalScalar('24', [])).toEqual({ value: 24, error: null });
    expect(evalScalar('8*T', [{ name: 'T', value: 3 }]).value).toBe(24);
    expect(evalScalar('12*(T-1)', [{ name: 'T', value: 3 }]).value).toBe(24);
  });
  it('算不出来:value=null 且带原因,不兜底成 0', () => {
    const r = evalScalar('8*T', []);
    expect(r.value).toBeNull();
    expect(r.error).toMatch(/T/);
    expect(evalScalar('', []).value).toBeNull();
    expect(evalScalar('1/0', []).value).toBeNull();
    expect(evalScalar('[1,2]', []).value).toBeNull();
  });
});

describe('标签布局(渲染与命中共用)', () => {
  // 用户截图:箭头朝北时标签压在箭头上 —— Mafs Text attach 的上下偏移是反的,改为自己算
  it('屏幕方向:北是向上(y 减小),东北是右上', () => {
    expect(screenUnit('n')).toEqual([0, -1]);
    const ne = screenUnit('ne');
    expect(ne[0]).toBeGreaterThan(0);
    expect(ne[1]).toBeLessThan(0);
    expect(screenUnit(null)).toEqual([0, 0]);
  });

  it('朝北箭头的标签整个在箭头尖上方,不压箭头', () => {
    const spec = { kind: 'arrow' as const, id: 'a', color: '#000', from: [0, 0] as [number, number], to: [0, 24] as [number, number], label: 'Andy 8 mi/h' };
    const toPx = (p: [number, number]): [number, number] => [100 + p[0] * 10, 400 - p[1] * 10];
    const tip = toPx([0, 24]);
    const box = shapeLabelBox(spec, toPx)!;
    expect(box.y1).toBeLessThan(tip[1]);
    expect(labelLayout(spec)?.dir).toBe('n');
  });

  it('用户拖动偏移叠加在默认偏移上', () => {
    const layout = { at: [0, 0] as [number, number], dir: 'n' as const, distance: 16, size: 15, text: 'x' };
    expect(labelShiftPx(layout)).toEqual([0, -16]);
    expect(labelShiftPx(layout, [5, 30])).toEqual([5, 14]);
  });

  it('文字对象没有标签布局', () => {
    expect(labelLayout({ kind: 'text', id: 't', color: '#000', at: [0, 0], text: 'hi' })).toBeNull();
  });
});
