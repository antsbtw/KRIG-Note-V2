// @vitest-environment jsdom
/**
 * L5-G6c 阶段 C2 — Basic 最小集 7 def + geometry svg 离线验收
 *
 * 验收(phaseC-prompt §6 代码层):
 *  1. 7 个最小集 def 按新范式落地(geometry.kind / textBox / textGrows / arrow handles)。
 *  2. parametric def evaluate 出可渲染 d + magnets + textBox(无 NaN);text kind 走文字层(evaluate null)。
 *  3. arrow px handle 不变形(拉长 w 箭头三角 headLenPx 恒定)。
 *  4. svg shape(star)经导入器解析 + evaluate 缩放正确(真机 SVG 链路 — B 欠条)。
 *
 * 直接读 definitions/ 真 def 文件(端到端贴近 bootstrap 加载),jsdom 供 svg DOMParser。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { evaluateShape, evaluateHandles } from '@capabilities/shape-library/shapes/renderers';
import { parseSvgToShapeDef } from '@capabilities/shape-library/shapes/svg-to-shapedef';
import type { ShapeDef } from '@capabilities/shape-library/types';

const DEFS = path.resolve(__dirname, '../../src/capabilities/shape-library/shapes/definitions');
function loadDef(rel: string): ShapeDef {
  return JSON.parse(readFileSync(path.join(DEFS, rel), 'utf-8'));
}

const PARAMETRIC = [
  'basic/rect.json',
  'basic/roundRect.json',
  'basic/ellipse.json',
  'arrow/right.json',
  'line/straight.json',
  'line/elbow.json',
];

describe('L5-G6c C2 — Basic 最小集 parametric def', () => {
  it.each(PARAMETRIC)('%s evaluate 出可渲染 d + 有限 magnets', (rel) => {
    const def = loadDef(rel);
    expect(def.geometry.kind).toBe('parametric');
    const out = evaluateShape(def, { width: 200, height: 120 });
    expect(out).not.toBeNull();
    expect(out!.d.length).toBeGreaterThan(0);
    expect(/NaN|Infinity/.test(out!.d)).toBe(false);
    for (const m of out!.magnets) {
      expect(Number.isFinite(m.x) && Number.isFinite(m.y)).toBe(true);
    }
    if (out!.textBox) {
      const { l, t, r, b } = out!.textBox;
      expect([l, t, r, b].every(Number.isFinite)).toBe(true);
    }
  });

  it('文字框 krig.basic.text:geometry.kind text + textGrows + evaluate null(走文字层)', () => {
    const def = loadDef('basic/text.json');
    expect(def.id).toBe('krig.basic.text');
    expect(def.geometry.kind).toBe('text');
    expect(def.textGrows).toBe(true);
    expect(evaluateShape(def, { width: 120, height: 40 })).toBeNull();
  });

  it('arrow px handle 不变形:拉长 w,箭头三角(w - x1 = headLenPx)恒定', () => {
    const def = loadDef('arrow/right.json');
    const h1 = evaluateHandles(def, { width: 200, height: 100 })[0];
    const h2 = evaluateHandles(def, { width: 500, height: 100 })[0];
    expect(200 - h1.x).toBe(40); // headLenPx default
    expect(500 - h2.x).toBe(40); // 不变形:三角宽恒定
  });

  it('roundRect 带圆角 handle(可调)', () => {
    const def = loadDef('basic/roundRect.json');
    expect(def.handles?.length).toBeGreaterThan(0);
    const hs = evaluateHandles(def, { width: 200, height: 200 });
    expect(hs.length).toBeGreaterThan(0);
  });
});

describe('L5-G6c C2/C-D3 — geometry svg shape(star)真机 SVG 链路', () => {
  it('star.svg 经导入器 → geometry.kind svg + evaluate 缩放出可渲染 d', () => {
    const svg = readFileSync(path.join(DEFS, 'geometry/star.svg'), 'utf-8');
    const def = parseSvgToShapeDef(svg, { id: 'krig.geometry.star', category: 'geometry', name: 'star' });
    expect(def).not.toBeNull();
    expect(def!.geometry.kind).toBe('svg');
    expect(def!.category).toBe('geometry');
    // H 命令归一化为 L
    expect(def!.geometry.svgPath).not.toMatch(/\bH\b/);
    const out = evaluateShape(def!, { width: 200, height: 200 });
    expect(out!.d.length).toBeGreaterThan(0);
    expect(/NaN|Infinity/.test(out!.d)).toBe(false);
  });
});
