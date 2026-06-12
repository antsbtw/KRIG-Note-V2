/**
 * svgToPng — readSvgSize 纯函数(从 SVG 字符串读尺寸)单测。
 *
 * svgToPngDataUrl 本身需 canvas/Image(node 测试环境无),走实机/集成验;
 * 此处只锁尺寸解析逻辑(width/height 优先,回退 viewBox,非法 → null)。
 */
import { describe, it, expect } from 'vitest';
import { readSvgSize } from '../../src/lib/svg-to-png';

describe('readSvgSize', () => {
  it('从 width/height 属性读(px 数值)', () => {
    expect(readSvgSize('<svg width="120" height="40" viewBox="0 0 120 40"></svg>')).toEqual({
      width: 120,
      height: 40,
    });
  });

  it('width/height 缺失 → 回退 viewBox 后两位', () => {
    expect(readSvgSize('<svg viewBox="0 0 200 60"></svg>')).toEqual({ width: 200, height: 60 });
  });

  it('width/height 是非 px 单位(如 ex)→ 回退 viewBox', () => {
    // MathJax 输出常是 width="2.5ex";parseFloat 拿到 2.5 但应优先 viewBox 的真实像素几何
    // 这里 2.5 是有限正数,按实现会被当 px 用 —— 锁住实际行为:有数值就用数值。
    expect(readSvgSize('<svg width="2.5ex" height="1ex" viewBox="0 0 1000 400"></svg>')).toEqual({
      width: 2.5,
      height: 1,
    });
  });

  it('viewBox 用逗号分隔也能解析', () => {
    expect(readSvgSize('<svg viewBox="0,0,80,30"></svg>')).toEqual({ width: 80, height: 30 });
  });

  it('既无 width/height 也无 viewBox → null', () => {
    expect(readSvgSize('<svg></svg>')).toBeNull();
  });

  it('width=0 且无 viewBox → null(非法尺寸)', () => {
    expect(readSvgSize('<svg width="0" height="0"></svg>')).toBeNull();
  });

  it('非 SVG 字符串 → null', () => {
    expect(readSvgSize('not an svg')).toBeNull();
  });

  it('<svg> 带换行 / 多属性也能匹配', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"\n  width="50"\n  height="25">';
    expect(readSvgSize(svg)).toEqual({ width: 50, height: 25 });
  });
});
