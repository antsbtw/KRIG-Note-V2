/**
 * math-visual 几何对象:表达式 → 可画对象、新建、吸附、等比例、点击换算(题意图 P1,2026-11-06)
 * 设计稿:docs/10-business-design/math/题意图-几何对象与分帧设计.md
 *
 * 样本 = Andy / Betsy 骑车题的帧 3(完整题意图),用真的 evalScalar(mathjs)求值。
 */
import { describe, it, expect } from 'vitest';
import {
  compileShapes, createShape, snapStep, snap, fitEqualScale, relToData, fmtNum,
  MAFS_VIEWBOX_PADDING,
} from '@drivers/text-editing-driver/blocks/math-visual/shapes';
import type { ShapeEntry } from '@drivers/text-editing-driver/blocks/math-visual/types';
import { evalScalar } from '@capabilities/math-rendering/compute/evaluator';

const base = { color: '#2D7FF9', style: 'solid' as const, lineWidth: 2.5 };

/** 帧 3:出发点、Andy 向北箭头(刻度 8)、Betsy 向东箭头(刻度 12)、以出发点为圆心的圆、打叉虚线、文字 */
const FRAME3: ShapeEntry[] = [
  { ...base, id: 'o', kind: 'point', at: ['0', '0'], text: 'Mathville' },
  { ...base, id: 'andy', kind: 'arrow', from: ['0', '0'], to: ['0', '24'], text: 'Andy 8 mi/h',
    ticks: { step: 8, labels: ['2:30', '3:30', '4:30'] } },
  { ...base, id: 'betsy', kind: 'arrow', from: ['0', '0'], to: ['24', '0'], text: 'Betsy 12 mi/h',
    color: '#FF6B35', ticks: { step: 12 } },
  { ...base, id: 'ring', kind: 'circle', center: ['0', '0'], radius: '24', style: 'dashed' },
  { ...base, id: 'between', kind: 'segment', from: ['0', '24'], to: ['24', '0'], style: 'dashed', struck: true },
  { ...base, id: 'q', kind: 'text', at: ['18', '22'], text: '几点一样远?' },
];

describe('compileShapes', () => {
  it('帧 3 样本全部画得出来,没有错误', () => {
    const { specs, errors } = compileShapes(FRAME3, evalScalar, []);
    expect(errors).toEqual({});
    expect(specs.map((s) => s.id)).toEqual(['o', 'andy', 'betsy', 'ring', 'between', 'q']);
    const andy = specs.find((s) => s.id === 'andy');
    expect(andy).toMatchObject({ kind: 'arrow', from: [0, 0], to: [0, 24], label: 'Andy 8 mi/h', ticks: { step: 8 } });
    expect(specs.find((s) => s.id === 'ring')).toMatchObject({ kind: 'circle', radius: 24, style: 'dashed' });
    expect(specs.find((s) => s.id === 'between')).toMatchObject({ struck: true });
  });

  it('坐标可以引用参数', () => {
    const shapes: ShapeEntry[] = [{ ...base, id: 'a', kind: 'point', at: ['0', '8*T'] }];
    const { specs } = compileShapes(shapes, evalScalar, [{ name: 'T', value: 2 }]);
    expect(specs[0]).toMatchObject({ at: [0, 16] });
  });

  it('一个坐标写错:只有它进 errors 且不画,其他照常', () => {
    const shapes: ShapeEntry[] = [
      { ...base, id: 'bad', kind: 'arrow', from: ['0', '0'], to: ['0', '8*T'] },
      { ...base, id: 'ok', kind: 'point', at: ['1', '2'] },
    ];
    const { specs, errors } = compileShapes(shapes, evalScalar, []);
    expect(specs.map((s) => s.id)).toEqual(['ok']);
    expect(errors.bad).toMatch(/终点 y/);
  });

  it('半径 ≤ 0、刻度间隔 ≤ 0 或太密、文字为空 → 报错', () => {
    const shapes: ShapeEntry[] = [
      { ...base, id: 'r0', kind: 'circle', center: ['0', '0'], radius: '0' },
      { ...base, id: 't0', kind: 'segment', from: ['0', '0'], to: ['0', '5'], ticks: { step: 0 } },
      { ...base, id: 'tMany', kind: 'segment', from: ['0', '0'], to: ['0', '1000'], ticks: { step: 1 } },
      { ...base, id: 'empty', kind: 'text', at: ['0', '0'], text: '' },
      { ...base, id: 'noAt', kind: 'point' },
    ];
    const { specs, errors } = compileShapes(shapes, evalScalar, []);
    expect(specs).toEqual([]);
    expect(Object.keys(errors).sort()).toEqual(['empty', 'noAt', 'r0', 't0', 'tMany']);
    expect(errors.tMany).toMatch(/1000/);
  });

  it('老数据没有 shapes:空列表 → 空结果', () => {
    expect(compileShapes([], evalScalar, [])).toEqual({ specs: [], errors: {} });
  });
});

describe('createShape', () => {
  it('两点图形从两次点击建出', () => {
    const a = createShape('arrow', [[0, 0], [0, 24]], 0);
    expect(a).toMatchObject({ kind: 'arrow', from: ['0', '0'], to: ['0', '24'] });
    const c = createShape('circle', [[0, 0], [3, 4]], 1);
    expect(c).toMatchObject({ kind: 'circle', center: ['0', '0'], radius: '5' });
    const t = createShape('text', [[1.5, 2]], 2);
    expect(t).toMatchObject({ kind: 'text', at: ['1.5', '2'], text: '文字' });
  });
  it('点数不够直接抛(不悄悄建一个坏对象)', () => {
    expect(() => createShape('segment', [[0, 0]], 0)).toThrow(/2 个点/);
  });
});

describe('吸附 / 数字格式', () => {
  it('snapStep 取 1/2/5×10^k', () => {
    expect(snapStep(10)).toBe(0.2);
    expect(snapStep(40)).toBe(1);
    expect(snapStep(60)).toBe(2);
    expect(snapStep(200)).toBe(5);
  });
  it('snap + fmtNum 不留浮点尾巴', () => {
    expect(fmtNum(snap(3.27, 0.2))).toBe('3.2');
    expect(fmtNum(-0)).toBe('0');
  });
});

describe('fitEqualScale', () => {
  const unitX = (v: { x: [number, number] }, w: number) => (v.x[1] - v.x[0] + 2 * MAFS_VIEWBOX_PADDING) / w;
  const unitY = (v: { y: [number, number] }, h: number) => (v.y[1] - v.y[0] + 2 * MAFS_VIEWBOX_PADDING) / h;

  it('放宽后 x、y 每像素单位一样,且原范围全部可见', () => {
    const want = { x: [-5, 30] as [number, number], y: [-5, 30] as [number, number] };
    const v = fitEqualScale(want, 900, 600);
    expect(unitX(v, 900)).toBeCloseTo(unitY(v, 600));
    expect(v.x[0]).toBeLessThanOrEqual(-5);
    expect(v.x[1]).toBeGreaterThanOrEqual(30);
    expect(v.y[0]).toBeCloseTo(-5);
    expect(v.y[1]).toBeCloseTo(30);
  });
  it('画布尺寸未知 → 原样返回', () => {
    const want = { x: [0, 1] as [number, number], y: [0, 2] as [number, number] };
    expect(fitEqualScale(want, 0, 600)).toBe(want);
  });
});

describe('relToData', () => {
  it('四角对应带边距的范围', () => {
    const v = { x: [0, 10] as [number, number], y: [0, 10] as [number, number] };
    expect(relToData(0, 0, v)).toEqual([-0.5, 10.5]);
    expect(relToData(1, 1, v)).toEqual([10.5, -0.5]);
    expect(relToData(0.5, 0.5, v)).toEqual([5, 5]);
  });
});
