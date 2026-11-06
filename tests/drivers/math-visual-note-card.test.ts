/**
 * math-visual 说明卡片(2026-11-06)

 * 纯文字 ↔ doc 的互转已搬到 note-card 公共组件,测试见 tests/capabilities/note-card.test.ts。
 * 用户:「标签应该允许多行,最好能表达 note 中的各种 block 格式……文字、公式、列表、图形,它们是互相转换的。」
 */
import { describe, it, expect } from 'vitest';
import { compileShapes } from '@drivers/text-editing-driver/blocks/math-visual/shapes';
import type { NoteDoc, ShapeEntry } from '@drivers/text-editing-driver/blocks/math-visual/types';
import { evalScalar } from '@capabilities/math-rendering/compute/evaluator';
import {
  labelLayout, labelOriginPx, labelSizePx, setCardSize, shapeLabelBox, DEFAULT_NOTE_WIDTH,
} from '@capabilities/math-rendering/compute/shape-geometry';

const base = { color: '#2D7FF9', style: 'solid' as const, lineWidth: 2.5 };

const DOC: NoteDoc = {
  format: 'pm-doc-json',
  version: '0.1',
  payload: {
    type: 'doc',
    content: [
      { type: 'paragraph', attrs: { isTitle: false }, content: [{ type: 'text', text: 'Andy 已知' }] },
      {
        type: 'bulletList',
        content: [
          { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: '1:30 出发,向北' }] }] },
          {
            type: 'listItem',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: '路程 ' }, { type: 'mathInline', attrs: { latex: 'd=8t' } }] }],
          },
        ],
      },
    ],
  },
};

describe('math-visual 用卡片内容', () => {
  it('编译时把卡片内容交给渲染;文字对象有卡片就不算「内容是空的」', () => {
    const shapes: ShapeEntry[] = [
      { ...base, id: 'a', kind: 'arrow', from: ['0', '0'], to: ['0', '24'], note: DOC, noteWidth: 260 },
      { ...base, id: 't', kind: 'text', at: ['5', '5'], text: '', note: DOC },
    ];
    const { specs, errors } = compileShapes(shapes, evalScalar, []);
    expect(errors).toEqual({});
    expect(specs[0]).toMatchObject({ note: DOC.payload.content, noteWidth: 260 });
    expect(specs[1]).toMatchObject({ kind: 'text', note: DOC.payload.content });
  });
});

describe('卡片位置与大小(渲染与命中共用)', () => {
  const note = DOC.payload.content as never;

  it('文字对象的卡片以位置为中心', () => {
    const l = labelLayout({ kind: 'text', id: 't', color: '#000', at: [1, 2], text: '', note });
    expect(l).toMatchObject({ at: [1, 2], dir: null });
  });

  it('卡片还没画好按 宽 × 一行 估;画好后用实际尺寸', () => {
    const spec = { kind: 'point' as const, id: 'p-size', color: '#000', at: [0, 0] as [number, number], note };
    const l = labelLayout(spec)!;
    expect(labelSizePx(spec, l)).toEqual([DEFAULT_NOTE_WIDTH, 24]);
    setCardSize('p-size', 200, 90);
    expect(labelSizePx(spec, l)).toEqual([200, 90]);
    const box = shapeLabelBox(spec, () => [100, 100])!;
    // 点的标签在东北:卡片左下角贴着锚点右上方
    expect(box.x1 - box.x0).toBeCloseTo(206);
    expect(box.y1).toBeLessThan(100);
  });

  it('对齐:东 = 左对齐,西 = 右对齐,北 = 底对齐', () => {
    const at: [number, number] = [0, 0];
    const mk = (dir: 'e' | 'w' | 'n') => ({ at, dir, distance: 0, size: 15, text: '' });
    expect(labelOriginPx([100, 100], mk('e'), 50, 20)).toEqual([100, 90]);
    expect(labelOriginPx([100, 100], mk('w'), 50, 20)).toEqual([50, 90]);
    expect(labelOriginPx([100, 100], mk('n'), 50, 20)).toEqual([75, 80]);
  });
});

describe('改卡片宽度时的对齐(补偿「哪边不动」用)', () => {
  it('点的标签在东北 → 左贴锚点(0);文字卡片居中(0.5);没有标签 → null', async () => {
    const { shapeLabelAlignX } = await import('@capabilities/math-rendering/compute/shape-geometry');
    const note = DOC.payload.content as never;
    expect(shapeLabelAlignX({ kind: 'point', id: 'p', color: '#000', at: [0, 0], note })).toBe(0);
    expect(shapeLabelAlignX({ kind: 'text', id: 't', color: '#000', at: [0, 0], text: '', note })).toBe(0.5);
    expect(shapeLabelAlignX({ kind: 'point', id: 'q', color: '#000', at: [0, 0] })).toBeNull();
    // 朝西的箭头:标签在箭头尖西边 → 右贴锚点(1)
    expect(shapeLabelAlignX({ kind: 'arrow', id: 'a', color: '#000', from: [0, 0], to: [-5, 0], note })).toBe(1);
  });
});
