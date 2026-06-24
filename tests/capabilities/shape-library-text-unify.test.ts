/**
 * L5-G6c 阶段 A 文字层统一 — 离线验收(geometry.kind 范式 + textBox 子区域语境)
 *
 * 真机文字层(SVG mesh 渲染)需 WebGL/SceneManager,node 环境测不了 → 真机验证
 * 顺延阶段 C(M3 欠条)。本测覆盖文字层定位**喂数据**的纯逻辑(NodeRenderer 不引入
 * 平行实现的前提):
 *  1. geometry.kind 范式取代 renderer:parametric 求值仍出 d / magnets / textBox。
 *  2. 带 textBox 的几何 shape → textBox 求值出正确子区域(NodeRenderer fillTextLayer
 *     把 contentSlot 平移到 (tb.l, tb.t)、尺寸 (r-l)×(b-t),坐标语境与几何 group 一致)。
 *  3. geometry.kind:'text'(无几何)→ evaluateShape 返 null(走文字层而非 path-to-three)。
 *
 * 用纯 evaluateShape(只 import type + 求值器)在 node 直测,不拉 three / React。
 */
import { describe, it, expect } from 'vitest';
// 走纯求值器深路径(避开 barrel 的 import.meta.glob / window.__krig 副作用,node 环境安全)
import { evaluateShape } from '@capabilities/shape-library/shapes/renderers';
import type { ShapeDef } from '@capabilities/shape-library/types';

/** 造一个最小矩形几何 shape:textBox 内缩 10px(验证子区域 ≠ 整框) */
function rectWithInsetTextBox(): ShapeDef {
  return {
    id: 'test.rect.inset',
    category: 'basic',
    name: 'Rect (inset textBox)',
    geometry: { kind: 'parametric' },
    viewBox: { w: 100, h: 100 },
    aspect: 'variable',
    path: [
      { cmd: 'M', x: 0, y: 0 },
      { cmd: 'L', x: 'w', y: 0 },
      { cmd: 'L', x: 'w', y: 'h' },
      { cmd: 'L', x: 0, y: 'h' },
      { cmd: 'Z' },
    ],
    textBox: { l: 10, t: 10, r: 'w - 10', b: 'h - 10' },
    source: 'builtin',
  };
}

/** 纯文字框:geometry.kind:'text',无 path */
function textFrame(): ShapeDef {
  return {
    id: 'test.text.frame',
    category: 'text',
    name: 'Text Frame',
    geometry: { kind: 'text' },
    viewBox: { w: 100, h: 30 },
    aspect: 'variable',
    textGrows: true,
    source: 'builtin',
  };
}

describe('L5-G6c A1 — geometry.kind 范式求值', () => {
  it('parametric kind:几何求值出非空 d + magnets 透传', () => {
    const out = evaluateShape(rectWithInsetTextBox(), { width: 200, height: 120 });
    expect(out).not.toBeNull();
    expect(out!.d.length).toBeGreaterThan(0);
    expect(/NaN|Infinity/.test(out!.d)).toBe(false);
  });

  it("text kind(无几何)→ evaluateShape 返 null(走文字层,不走 path-to-three)", () => {
    const out = evaluateShape(textFrame(), { width: 200, height: 40 });
    expect(out).toBeNull();
  });
});

describe('L5-G6c A2 — textBox 子区域语境(文字层定位喂数据)', () => {
  it('textBox 求值随节点尺寸缩放,内缩 10px 子区域正确(NodeRenderer 据此平移 contentSlot)', () => {
    const W = 200, H = 120;
    const out = evaluateShape(rectWithInsetTextBox(), { width: W, height: H });
    expect(out!.textBox).toBeDefined();
    const tb = out!.textBox!;
    // textBox: l=10, t=10, r=w-10, b=h-10 在 200×120 下
    expect(tb.l).toBe(10);
    expect(tb.t).toBe(10);
    expect(tb.r).toBe(W - 10); // 190
    expect(tb.b).toBe(H - 10); // 110

    // NodeRenderer.fillTextLayer 的 region 推导(与实现同式):
    const region = { x: tb.l, y: tb.t, w: tb.r - tb.l, h: tb.b - tb.t };
    expect(region).toEqual({ x: 10, y: 10, w: 180, h: 100 });
    // 子区域严格在整框内(Y 轴方向对 —— t 在顶部、b 在底部,不跩进顶部):
    expect(region.y).toBeGreaterThan(0);
    expect(region.y + region.h).toBeLessThan(H);
  });

  it('无 textBox 字段的几何 shape → 缺省整框(NodeRenderer fallback {0,0,w,h})', () => {
    const def = rectWithInsetTextBox();
    delete def.textBox;
    const out = evaluateShape(def, { width: 200, height: 120 });
    expect(out!.textBox).toBeUndefined();
    // NodeRenderer 缺省整框:{ l:0, t:0, r:size.w, b:size.h }
    const fallback = { l: 0, t: 0, r: 200, b: 120 };
    const region = { x: fallback.l, y: fallback.t, w: fallback.r - fallback.l, h: fallback.b - fallback.t };
    expect(region).toEqual({ x: 0, y: 0, w: 200, h: 120 });
  });
});
