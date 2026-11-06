/**
 * math-rendering 几何对象的纯计算 + 常量表达式求值(题意图 P1,2026-11-06)
 * 设计稿:docs/10-business-design/math/题意图-几何对象与分帧设计.md
 */
import { describe, it, expect } from 'vitest';
import {
  cardinalOf, tickPositions, leftNormal, formatTickValue, MAX_TICKS,
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
