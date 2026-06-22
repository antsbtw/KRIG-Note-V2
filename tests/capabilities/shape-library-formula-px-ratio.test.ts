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
import { buildEnv, scaleParam } from '@capabilities/shape-library/shapes/renderers';
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
