/**
 * math-visual 全屏撤销 / 重做 + 图层顺序(2026-11-06)
 * 用户:「cmd+Z 的取消操作没有生效吗?还有一个图层的上下层关系没有。」
 */
import { describe, it, expect } from 'vitest';
import { EditHistory, historyKey } from '@drivers/text-editing-driver/blocks/math-visual/edit-history';
import { reorderShapes } from '@drivers/text-editing-driver/blocks/math-visual/shapes';
import type { MathVisualData, ShapeEntry } from '@drivers/text-editing-driver/blocks/math-visual/types';
import { DEFAULT_CANVAS_CONFIG } from '@drivers/text-editing-driver/blocks/math-visual/types';

const pt = (id: string, x: string): ShapeEntry => ({ id, kind: 'point', at: [x, '0'], color: '#2D7FF9', style: 'solid', lineWidth: 2 });
const mk = (shapes: ShapeEntry[], extra: Partial<MathVisualData> = {}): MathVisualData => ({
  functions: [], domain: [-5, 5], range: [-5, 5], parameters: [], annotations: [],
  canvas: DEFAULT_CANVAS_CONFIG, shapes, toolMode: 'move', ...extra,
});

describe('EditHistory', () => {
  it('撤销回到上一步,重做再回来', () => {
    const h = new EditHistory();
    const a = mk([]);
    const b = mk([pt('p', '1')]);
    const c = mk([pt('p', '1'), pt('q', '2')]);
    h.record(a, b, 0);
    h.record(b, c, 1000);
    expect(h.undo(c)?.shapes).toEqual(b.shapes);
    expect(h.undo(b)?.shapes).toEqual(a.shapes);
    expect(h.undo(a)).toBeNull();
    expect(h.redo(a)?.shapes).toEqual(b.shapes);
  });

  it('600ms 内连续改动合并成一步(逐字输入)', () => {
    const h = new EditHistory();
    const s0 = mk([pt('p', '1')]);
    const s1 = mk([pt('p', '12')]);
    const s2 = mk([pt('p', '123')]);
    h.record(s0, s1, 0);
    h.record(s1, s2, 200);
    expect(h.undo(s2)?.shapes).toEqual(s0.shapes);
    expect(h.canUndo).toBe(false);
  });

  it('缩放平移 / 切工具不算编辑;撤销时视图保持当前', () => {
    const h = new EditHistory();
    const a = mk([]);
    const zoomed = mk([], { domain: [0, 30], range: [0, 30], toolMode: 'shape' });
    h.record(a, zoomed, 0);
    expect(h.canUndo).toBe(false);
    const added = mk([pt('p', '1')], { domain: [0, 30], range: [0, 30] });
    h.record(zoomed, added, 1000);
    const back = h.undo(mk([pt('p', '1')], { domain: [10, 20], range: [10, 20] }));
    expect(back?.shapes).toEqual([]);
    expect(back?.domain).toEqual([10, 20]);
    expect(historyKey(a)).toBe(historyKey(zoomed));
  });

  it('撤销后再改:重做历史清空', () => {
    const h = new EditHistory();
    const a = mk([]);
    const b = mk([pt('p', '1')]);
    h.record(a, b, 0);
    h.undo(b);
    h.record(a, mk([pt('q', '9')]), 5000);
    expect(h.canRedo).toBe(false);
  });
});

describe('reorderShapes(数组越靠后越在上面)', () => {
  const L = ['a', 'b', 'c', 'd'].map((id) => ({ id }));
  const ids = (l: { id: string }[]) => l.map((x) => x.id).join('');

  it('置顶 / 置底', () => {
    expect(ids(reorderShapes(L, ['b'], 'front'))).toBe('acdb');
    expect(ids(reorderShapes(L, ['c'], 'back'))).toBe('cabd');
  });
  it('上移 / 下移一层,到头不动', () => {
    expect(ids(reorderShapes(L, ['b'], 'forward'))).toBe('acbd');
    expect(ids(reorderShapes(L, ['b'], 'backward'))).toBe('bacd');
    expect(ids(reorderShapes(L, ['d'], 'forward'))).toBe('abcd');
    expect(ids(reorderShapes(L, ['a'], 'backward'))).toBe('abcd');
  });
  it('多选整组移动,组内相对顺序不变', () => {
    expect(ids(reorderShapes(L, ['a', 'c'], 'front'))).toBe('bdac');
    expect(ids(reorderShapes(L, ['a', 'b'], 'forward'))).toBe('cabd');
    expect(ids(reorderShapes(L, ['c', 'd'], 'forward'))).toBe('abcd');
  });
  it('没选 → 原样', () => {
    expect(reorderShapes(L, [], 'front')).toBe(L);
  });
});
