/**
 * L5-G6c 阶段 A4 — formula-eval px/ratio 区分(箭头不变形地基)
 *
 * 验收(prompt A3 / L5G6c §3.5):
 *  1. ratio param 乘 refDim;px param 绝对不乘。
 *  2. 同一公式 px vs ratio 求值结果不同。
 *  3. 拉长场景:箭头头部用 px → w 变大时头部尺寸不变(只箭身变长 = 不变形)。
 *     用 ratio 则头部随 w 等比放大(= 变形,反证)。
 *  4. 无 unit / 未知 param 兜底当 ratio(兼容老 def)。
 *
 * 纯 buildEnv + scaleParam,node 直测(D3:本阶段只验地基,真箭头 def 留阶段 C)。
 */
import { describe, it, expect } from 'vitest';
import { buildEnv, scaleParam, evaluateHandles } from '@capabilities/shape-library/shapes/renderers';
import type { ShapeDef } from '@capabilities/shape-library/types';

/** 同名 param,一个 ratio 一个 px,验证 scaleParam 区分 */
function arrowLike(headLenUnit: 'px' | 'ratio', headLenVal: number): ShapeDef {
  return {
    id: 'test.arrow',
    category: 'arrow',
    name: 'Arrow-like',
    geometry: { kind: 'parametric' },
    viewBox: { w: 100, h: 100 },
    aspect: 'variable',
    params: {
      headLen: { type: 'number', default: headLenVal, unit: headLenUnit },
    },
    source: 'builtin',
  };
}

describe('L5-G6c A4 — px/ratio scaleParam 区分', () => {
  it('ratio param 乘 refDim;px param 绝对不乘', () => {
    const W = 200;
    const ratioEnv = buildEnv(arrowLike('ratio', 0.3), W, 100);
    const pxEnv = buildEnv(arrowLike('px', 30), W, 100);

    // ratio: 0.3 × 200 = 60
    expect(scaleParam('headLen', W, ratioEnv)).toBe(60);
    // px: 30 绝对,不乘 200
    expect(scaleParam('headLen', W, pxEnv)).toBe(30);
  });

  it('同一公式 px vs ratio 求值结果不同', () => {
    const W = 200;
    const ratioHL = scaleParam('headLen', W, buildEnv(arrowLike('ratio', 0.3), W, 100));
    const pxHL = scaleParam('headLen', W, buildEnv(arrowLike('px', 30), W, 100));
    expect(ratioHL).not.toBe(pxHL); // 60 ≠ 30
  });

  it('拉长不变形:px 箭头头部 w 变大时尺寸不变(只箭身变长)', () => {
    const def = arrowLike('px', 30);
    // 箭身 = w - hL;箭头三角宽 = hL
    const small = buildEnv(def, 100, 100);
    const large = buildEnv(def, 400, 100);
    const hlSmall = scaleParam('headLen', small.w, small);
    const hlLarge = scaleParam('headLen', large.w, large);
    // 头部 px 固定不变(不变形核心)
    expect(hlSmall).toBe(30);
    expect(hlLarge).toBe(30);
    // 箭身随 w 变长
    expect(large.w - hlLarge).toBeGreaterThan(small.w - hlSmall);
    expect(large.w - hlLarge).toBe(370);
  });

  it('反证:ratio 箭头头部随 w 等比放大(= 变形)', () => {
    const def = arrowLike('ratio', 0.3);
    const small = buildEnv(def, 100, 100);
    const large = buildEnv(def, 400, 100);
    const hlSmall = scaleParam('headLen', small.w, small); // 30
    const hlLarge = scaleParam('headLen', large.w, large); // 120
    expect(hlLarge).toBeGreaterThan(hlSmall); // 头部放大 = 变形根源
    expect(hlLarge / hlSmall).toBeCloseTo(large.w / small.w); // 等比
  });

  it('无 unit param 兜底当 ratio(兼容老 def)', () => {
    const def: ShapeDef = {
      id: 'test.nounit',
      category: 'basic',
      name: 'No unit',
      geometry: { kind: 'parametric' },
      viewBox: { w: 100, h: 100 },
      aspect: 'variable',
      params: { k: { type: 'number', default: 0.5 } }, // 无 unit
      source: 'builtin',
    };
    const env = buildEnv(def, 200, 100);
    expect(scaleParam('k', 200, env)).toBe(100); // 当 ratio: 0.5 × 200
  });

  it('未知 param → scaleParam 抛错(fail loud,不静默)', () => {
    const env = buildEnv(arrowLike('px', 30), 100, 100);
    expect(() => scaleParam('missing', 100, env)).toThrow(/unknown param/);
  });
});

describe('L5-G6c B2.1 — evaluateHandles(param 拖点位置求值)', () => {
  /** 箭头:headLenPx px + handle from='w - headLenPx'(箭身/箭头分界 x),axis x */
  function arrowWithHandle(): ShapeDef {
    return {
      id: 'krig.basic.probe_arrow',
      category: 'basic',
      name: 'Probe Arrow',
      geometry: { kind: 'parametric' },
      viewBox: { w: 100, h: 100 },
      aspect: 'variable',
      params: { headLenPx: { type: 'number', default: 30, min: 10, max: 80, unit: 'px' } },
      guides: [{ name: 'x1', op: '+-', args: ['w', 0, 'headLenPx'] }],
      path: [{ cmd: 'M', x: 0, y: 0 }, { cmd: 'L', x: 'w', y: 'vc' }, { cmd: 'Z' }],
      handles: [{ param: 'headLenPx', axis: 'x', from: 'x1', unit: 'px' }],
      source: 'builtin',
    };
  }

  it('handle from 公式求值出 shape-local x;cross-axis 取中心', () => {
    const def = arrowWithHandle();
    // w=200 → x1 = 200 - 30 = 170;axis x → y = h/2 = 50
    const hs = evaluateHandles(def, { width: 200, height: 100 });
    expect(hs).toHaveLength(1);
    expect(hs[0]).toMatchObject({ index: 0, param: 'headLenPx', axis: 'x', unit: 'px' });
    expect(hs[0].x).toBe(170);
    expect(hs[0].y).toBe(50);
  });

  it('px handle 不变形:整体拉长 w,handle x 随箭身分界右移、与右边距恒定 headLenPx', () => {
    const def = arrowWithHandle();
    const small = evaluateHandles(def, { width: 100, height: 100 })[0];
    const large = evaluateHandles(def, { width: 400, height: 100 })[0];
    // 箭头三角宽 = w - x1 = headLenPx 恒定 30(不变形核心)
    expect(100 - small.x).toBe(30);
    expect(400 - large.x).toBe(30);
  });

  it('无 handles / svg / text → 空数组', () => {
    const noHandle: ShapeDef = {
      id: 'k.basic.rect', category: 'basic', name: 'r',
      geometry: { kind: 'parametric' }, viewBox: { w: 1, h: 1 }, aspect: 'variable',
      path: [{ cmd: 'M', x: 0, y: 0 }], source: 'builtin',
    };
    expect(evaluateHandles(noHandle, { width: 10, height: 10 })).toEqual([]);
    const svg: ShapeDef = { ...noHandle, geometry: { kind: 'svg', svgPath: 'M 0 0' } };
    expect(evaluateHandles(svg, { width: 10, height: 10 })).toEqual([]);
  });
});
