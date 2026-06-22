// @vitest-environment jsdom
/**
 * L5-G6c 阶段 B1.1 — svg-to-shapedef 导入器
 *
 * 验收(phaseB-prompt B1.1 / §4):
 *  1. d 归一化(SVG1=b):H/V→L、S→C、T→Q、相对→绝对,输出空格分隔绝对子集
 *     (parseSvgPathD 只认 M/L/A/Q/C/Z 空格分隔)。
 *  2. parseSvgToShapeDef:正常 svg → geometry.kind:'svg' + svgPath + viewBox + magnets + textBox 缺省整框。
 *  3. fail loud:渐变/位图/文字/无 path / 不支持命令 → warn + null(不静默吞)。
 *  4. viewBox 缺失 → 由 bbox 估。
 *
 * jsdom 环境(DOMParser);normalizePathD/bboxOf 纯逻辑也一并测。
 */
import { describe, it, expect, vi } from 'vitest';
import { parseSvgToShapeDef, normalizePathD } from '@capabilities/shape-library/shapes/svg-to-shapedef';
import { evaluateShape } from '@capabilities/shape-library/shapes/renderers';

const META = { id: 'krig.basic.probe', category: 'basic' as const, name: 'Probe' };

describe('L5-G6c B1.1 — normalizePathD(d 归一化)', () => {
  it('绝对 M/L/Z 透传(空格分隔)', () => {
    expect(normalizePathD('M 0 0 L 10 0 L 10 10 Z')).toBe('M 0 0 L 10 0 L 10 10 Z');
  });

  it('逗号分隔 + 粘连负号 → 空格分隔', () => {
    expect(normalizePathD('M0,0L10,10')).toBe('M 0 0 L 10 10');
  });

  it('H/V → L(绝对)', () => {
    // M0 0 H10 V10 → M 0 0 L 10 0 L 10 10
    expect(normalizePathD('M0 0 H10 V10')).toBe('M 0 0 L 10 0 L 10 10');
  });

  it('相对 l/h/v → 绝对 L', () => {
    // m0 0 l10 0 → M 0 0 L 10 0;再 v10(相对)→ L 10 10
    expect(normalizePathD('m0 0 l10 0 v10')).toBe('M 0 0 L 10 0 L 10 10');
  });

  it('S → C(反射上一段控制点)', () => {
    // 上段 C 第二控制点 (10,10),终点 (10,0);S 反射 → 第一控制点 = 2*(10,0)-(10,10) = (10,-10)
    const out = normalizePathD('M0 0 C0 10 10 10 10 0 S20 -10 20 0');
    expect(out).toBe('M 0 0 C 0 10 10 10 10 0 C 10 -10 20 -10 20 0');
    expect((out!.match(/C /g) ?? []).length).toBe(2); // S 转成第二段 C
  });

  it('T → Q(反射)', () => {
    const out = normalizePathD('M0 0 Q5 10 10 0 T20 0');
    expect((out!.match(/Q /g) ?? []).length).toBe(2);
  });

  it('A 弧:rot + flags + 终点保留', () => {
    const out = normalizePathD('M0 0 A5 5 0 0 1 10 0');
    expect(out).toBe('M 0 0 A 5 5 0 0 1 10 0');
  });

  it('不支持命令(无)→ 空 d 返 null', () => {
    expect(normalizePathD('')).toBeNull();
  });
});

describe('L5-G6c B1.1 — parseSvgToShapeDef', () => {
  it('正常 svg(viewBox + 1 path)→ geometry.kind:svg + svgPath + magnets + textBox 缺省', () => {
    const svg = '<svg viewBox="0 0 100 80"><path d="M0 0 H100 V80 H0 Z"/></svg>';
    const def = parseSvgToShapeDef(svg, META);
    expect(def).not.toBeNull();
    expect(def!.geometry.kind).toBe('svg');
    expect(def!.geometry.svgPath).toContain('L 100 0'); // H100 归一化
    expect(def!.viewBox).toEqual({ w: 100, h: 80 });
    expect(def!.magnets).toHaveLength(4); // N/S/E/W
    expect(def!.textBox).toBeUndefined(); // 缺省整框(evaluate/NodeRenderer 兜底)
    expect(def!.source).toBe('imported');
  });

  it('多 path 合并成一条 d', () => {
    const svg = '<svg viewBox="0 0 100 100"><path d="M0 0 L10 0"/><path d="M0 10 L10 10"/></svg>';
    const def = parseSvgToShapeDef(svg, META);
    expect(def!.geometry.svgPath).toBe('M 0 0 L 10 0 M 0 10 L 10 10');
  });

  it('无 viewBox → 由 bbox 估', () => {
    const svg = '<svg><path d="M0 0 L50 0 L50 40 Z"/></svg>';
    const def = parseSvgToShapeDef(svg, META);
    expect(def!.viewBox.w).toBeGreaterThan(0);
    expect(def!.viewBox.h).toBeGreaterThan(0);
  });

  it('fail loud:渐变 → warn + null', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const svg = '<svg viewBox="0 0 10 10"><defs><linearGradient id="g"/></defs><path d="M0 0 L10 10"/></svg>';
    expect(parseSvgToShapeDef(svg, META)).toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('fail loud:无 path → warn + null', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const svg = '<svg viewBox="0 0 10 10"><rect width="10" height="10"/></svg>';
    expect(parseSvgToShapeDef(svg, META)).toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('fail loud:位图 <image> → warn + null', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const svg = '<svg viewBox="0 0 10 10"><image href="x.png"/><path d="M0 0 L10 10"/></svg>';
    expect(parseSvgToShapeDef(svg, META)).toBeNull();
    warn.mockRestore();
  });

  it('sidecar 覆盖 textBox/magnets', () => {
    const svg = '<svg viewBox="0 0 100 100"><path d="M0 0 H100 V100 Z"/></svg>';
    const def = parseSvgToShapeDef(svg, { ...META, textBox: { l: 5, t: 5, r: 95, b: 95 }, magnets: [{ id: 'C', x: 0.5, y: 0.5 }] });
    expect(def!.textBox).toEqual({ l: 5, t: 5, r: 95, b: 95 });
    expect(def!.magnets).toHaveLength(1);
  });
});

describe('L5-G6c B1.2 — evaluateShape(svg kind)缩放到节点尺寸', () => {
  it('svgPath 从 viewBox 空间缩放到 target 尺寸 + magnets×尺寸', () => {
    const svg = '<svg viewBox="0 0 100 50"><path d="M0 0 L100 0 L100 50 Z"/></svg>';
    const def = parseSvgToShapeDef(svg, META)!;
    // 节点渲染 200×100 = viewBox 2×2 倍
    const out = evaluateShape(def, { width: 200, height: 100 });
    expect(out).not.toBeNull();
    // L100 0 → ×2 = L 200 0;L100 50 → L 200 100
    expect(out!.d).toBe('M 0 0 L 200 0 L 200 100 Z');
    // magnets E = (1,0.5) → (200, 50)
    const e = out!.magnets.find((m) => m.id === 'E')!;
    expect(e).toEqual({ id: 'E', x: 200, y: 50 });
    expect(/NaN|Infinity/.test(out!.d)).toBe(false);
  });

  it('svgPath 空 / viewBox 退化 → null(fail safe)', () => {
    const def = parseSvgToShapeDef('<svg viewBox="0 0 10 10"><path d="M0 0 L10 10"/></svg>', META)!;
    // 人为破坏 viewBox
    const broken = { ...def, geometry: { ...def.geometry, viewBox: { w: 0, h: 0 } } };
    expect(evaluateShape(broken, { width: 100, height: 100 })).toBeNull();
  });
});
