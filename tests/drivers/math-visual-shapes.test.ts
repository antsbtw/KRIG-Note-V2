/**
 * math-visual 几何对象:表达式 → 可画对象、新建、吸附、等比例、点击换算(题意图 P1,2026-11-06)
 * 设计稿:docs/10-business-design/math/题意图-几何对象与分帧设计.md
 *
 * 样本 = Andy / Betsy 骑车题的帧 3(完整题意图),用真的 evalScalar(mathjs)求值。
 */
import { describe, it, expect } from 'vitest';
import {
  compileShapes, createShape, snapStep, snap, fitEqualScale, relToData, fmtNum,
  MAFS_VIEWBOX_PADDING, zoomView, panView, boundsOfShapes,
  hitTest, dataToPx, translateShape, setHandle, duplicateShape, isPlainNumber, shapeHandles,
  shapesInRect, specExtent,
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

describe('缩放 / 平移 / 显示全部', () => {
  const v = { x: [0, 10] as [number, number], y: [0, 10] as [number, number] };

  it('以锚点缩放:锚点不动,跨度按倍数变', () => {
    const z = zoomView(v, 0.5, [2, 8]);
    expect(z.x).toEqual([1, 6]);
    expect(z.y).toEqual([4, 9]);
    const out = zoomView(v, 2, [5, 5]);
    expect(out.x).toEqual([-5, 15]);
  });

  it('倍数有上下限,滚轮猛甩不会缩成一个点', () => {
    const z = zoomView(v, 0, [5, 5]);
    expect(z.x[1] - z.x[0]).toBeCloseTo(0.5);
  });

  it('平移', () => {
    expect(panView(v, 3, -2)).toEqual({ x: [3, 13], y: [-2, 8] });
  });

  it('显示全部:帧 3 样本框进来(含圆)并留余量;没有对象 → null', () => {
    const { specs } = compileShapes(FRAME3, evalScalar, []);
    const b = boundsOfShapes(specs);
    expect(b).not.toBeNull();
    expect(b!.x[0]).toBeLessThan(-24);
    expect(b!.x[1]).toBeGreaterThan(24);
    expect(b!.y[0]).toBeLessThan(-24);
    expect(b!.y[1]).toBeGreaterThan(24);
    expect(boundsOfShapes([])).toBeNull();
  });
});

describe('面(多边形)', () => {
  it('三个顶点画得出来;不够三个报错', () => {
    const tri = createShape('polygon', [[0, 0], [4, 0], [0, 3]], 0);
    expect(tri.points).toEqual([['0', '0'], ['4', '0'], ['0', '3']]);
    const { specs } = compileShapes([tri], evalScalar, []);
    expect(specs[0]).toMatchObject({ kind: 'polygon', points: [[0, 0], [4, 0], [0, 3]], fillOpacity: 0.15 });
    const two: ShapeEntry = { ...base, id: 'two', kind: 'polygon', points: [['0', '0'], ['1', '1']] };
    expect(compileShapes([two], evalScalar, []).errors.two).toMatch(/至少 3/);
    expect(() => createShape('polygon', [[0, 0], [1, 1]], 0)).toThrow(/3 个点/);
  });
  it('不填充 → fillOpacity 0', () => {
    const tri: ShapeEntry = { ...base, id: 't', kind: 'polygon', fill: false, points: [['0', '0'], ['4', '0'], ['0', '3']] };
    expect(compileShapes([tri], evalScalar, []).specs[0]).toMatchObject({ fillOpacity: 0 });
  });
});

describe('画布上选中 / 拖动', () => {
  // 视口 -0.5~10.5 映射到 1100×1100 像素:1 个数据单位 = 100px
  const frame = { view: { x: [0, 10] as [number, number], y: [0, 10] as [number, number] }, width: 1100, height: 1100 };
  const at = (x: number, y: number) => dataToPx([x, y], frame);

  it('dataToPx 与 relToData 互逆', () => {
    const px = at(3, 7);
    expect(relToData(px[0] / 1100, px[1] / 1100, frame.view)).toEqual([3, 7]);
  });

  it('点中线段本体、点中圆周、点空白', () => {
    const { specs } = compileShapes([
      { ...base, id: 'seg', kind: 'segment', from: ['1', '1'], to: ['9', '1'] },
      { ...base, id: 'c', kind: 'circle', center: ['5', '5'], radius: '2' },
    ], evalScalar, []);
    expect(hitTest(specs, at(5, 1), frame, null)).toEqual({ id: 'seg', part: null });
    expect(hitTest(specs, at(7, 5), frame, null)).toEqual({ id: 'c', part: null });
    expect(hitTest(specs, at(5, 5), frame, null)).toBeNull(); // 圆心不算点中圆
  });

  it('选中后优先命中手柄;后画的压在上面', () => {
    const { specs } = compileShapes([
      { ...base, id: 'a', kind: 'segment', from: ['1', '1'], to: ['9', '1'] },
      { ...base, id: 'b', kind: 'segment', from: ['5', '0'], to: ['5', '9'] },
    ], evalScalar, []);
    expect(hitTest(specs, at(5, 1), frame, null)).toEqual({ id: 'b', part: null });
    expect(hitTest(specs, at(9, 1), frame, 'a')).toEqual({ id: 'a', part: 'to' });
  });

  it('填充的面点内部也算选中', () => {
    const { specs } = compileShapes([
      { ...base, id: 'p', kind: 'polygon', points: [['1', '1'], ['6', '1'], ['1', '6']] },
    ], evalScalar, []);
    expect(hitTest(specs, at(2, 2), frame, null)).toEqual({ id: 'p', part: null });
  });

  it('整体平移:纯数字跟着动,算式不动', () => {
    const s: ShapeEntry = { ...base, id: 'x', kind: 'arrow', from: ['0', '0'], to: ['0', '8*T'] };
    const m = translateShape(s, 2, 1);
    expect(m.from).toEqual(['2', '1']);
    expect(m.to).toEqual(['2', '8*T']);
    expect(isPlainNumber('-3.5')).toBe(true);
    expect(isPlainNumber('8*T')).toBe(false);
  });

  it('拖手柄:终点、半径、面的顶点', () => {
    const arrow: ShapeEntry = { ...base, id: 'a', kind: 'arrow', from: ['0', '0'], to: ['0', '8*T'] };
    const arrowSpec = compileShapes([{ ...arrow, to: ['0', '24'] }], evalScalar, []).specs[0];
    expect(setHandle(arrow, arrowSpec, 'to', [0, 30]).to).toEqual(['0', '30']);

    const circle: ShapeEntry = { ...base, id: 'c', kind: 'circle', center: ['0', '0'], radius: '24' };
    const cSpec = compileShapes([circle], evalScalar, []).specs[0];
    expect(shapeHandles(cSpec).map((h) => h.part)).toEqual(['center', 'radius']);
    expect(setHandle(circle, cSpec, 'radius', [3, 4]).radius).toBe('5');

    const tri: ShapeEntry = { ...base, id: 't', kind: 'polygon', points: [['0', '0'], ['4', '0'], ['0', '3']] };
    const tSpec = compileShapes([tri], evalScalar, []).specs[0];
    expect(setHandle(tri, tSpec, 'v1', [5, 1]).points).toEqual([['0', '0'], ['5', '1'], ['0', '3']]);
    expect(() => setHandle(tri, tSpec, 'nope', [0, 0])).toThrow(/未知手柄/);
  });

  it('复制:新 id、偏移', () => {
    const p: ShapeEntry = { ...base, id: 'p', kind: 'point', at: ['1', '1'] };
    const d = duplicateShape(p, [2, -2], 3);
    expect(d.id).not.toBe('p');
    expect(d.at).toEqual(['3', '-1']);
  });
});

describe('框选 / 点更好点中', () => {
  const frame = { view: { x: [0, 10] as [number, number], y: [0, 10] as [number, number] }, width: 1100, height: 1100 };

  it('完全框住才选:框住 Mathville 点不会带上从原点出发的箭头', () => {
    const { specs } = compileShapes(FRAME3, evalScalar, []);
    expect(shapesInRect(specs, { x: [-2, 2], y: [-2, 2] })).toEqual(['o']);
    expect(shapesInRect(specs, { x: [-30, 30], y: [-30, 30] })).toEqual(['o', 'andy', 'betsy', 'ring', 'between', 'q']);
    // 方框方向反着拉也一样
    expect(shapesInRect(specs, { x: [2, -2], y: [2, -2] })).toEqual(['o']);
  });

  it('圆的范围按外接正方形', () => {
    const { specs } = compileShapes([{ ...base, id: 'c', kind: 'circle', center: ['1', '1'], radius: '2' }], evalScalar, []);
    expect(specExtent(specs[0])).toEqual({ x: [-1, 3], y: [-1, 3] });
  });

  it('点的标签也算点中这个点;离点 12px 内算点中', () => {
    const { specs } = compileShapes([{ ...base, id: 'o', kind: 'point', at: ['5', '5'], text: 'Mathville' }], evalScalar, []);
    const c = dataToPx([5, 5], frame);
    expect(hitTest(specs, [c[0] + 11, c[1]], frame, null)).toEqual({ id: 'o', part: null });
    expect(hitTest(specs, [c[0] + 40, c[1] - 15], frame, null)).toEqual({ id: 'o', part: null }); // 标签上
    expect(hitTest(specs, [c[0] - 40, c[1] + 15], frame, null)).toBeNull(); // 左下空白
  });
});
