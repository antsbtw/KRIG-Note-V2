/**
 * math-visual 说明卡片(2026-11-06)
 * 用户:「标签应该允许多行,最好能表达 note 中的各种 block 格式……文字、公式、列表、图形,它们是互相转换的。」
 */
import { describe, it, expect } from 'vitest';
import {
  noteContent, noteDocFromText, plainTextOfNote, compileShapes,
} from '@drivers/text-editing-driver/blocks/math-visual/shapes';
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

describe('纯文字 ↔ 卡片内容', () => {
  it('纯文字 → doc:一行一段,带 version,首段不是标题', () => {
    const d = noteDocFromText('甲\n乙');
    expect(d.version).toBe('0.1'); // 缺 version 编辑器静默空白(记忆:嵌 note 编辑器三坑)
    expect(d.payload.content).toHaveLength(2);
    expect(d.payload.content[0].attrs).toEqual({ isTitle: false });
    expect(plainTextOfNote(d)).toBe('甲\n乙');
  });

  it('doc → 纯文字:列表逐行、行内公式取 LaTeX', () => {
    expect(plainTextOfNote(DOC)).toBe('Andy 已知\n1:30 出发,向北\n路程 d=8t');
  });

  it('只有一个空段落 = 没有卡片(退回单行显示)', () => {
    expect(noteContent(noteDocFromText(''))).toBeNull();
    expect(noteContent(undefined)).toBeNull();
    expect(noteContent(DOC)).toHaveLength(2);
  });

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
