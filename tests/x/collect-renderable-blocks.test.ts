/**
 * collectRenderableBlocks — X 截图收集「装不下纯文本」的 block(公式/代码/Mermaid)
 *
 * 守的约束(X 截图 2026-06,总指挥拍板):
 *  - 收 mathBlock(kind=math)、codeBlock(kind=code;language=mermaid → kind=mermaid)
 *  - **不收** mathInline(行内公式降级文本,留 TODO)
 *  - 递归进 container(blockquote / list)收里面的公式/代码
 *  - 顺序 = 文档出现先后(与 4 图额度「取前 4」对齐)
 *  - atom 是 node.toJSON()(atomsToSvg 直接消费形态);source 是源码(latex/code)
 */
import { describe, it, expect } from 'vitest';
import { Schema, Slice } from 'prosemirror-model';
import {
  collectRenderableBlocksFromDoc,
  collectRenderableBlocksFromSlice,
} from '@drivers/text-editing-driver/serializers/collect-renderable-blocks';

// 最小 schema:覆盖 paragraph / mathBlock / codeBlock / mathInline / blockquote / bulletList
const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    text: { group: 'inline' },
    paragraph: { content: 'inline*', group: 'block', toDOM: () => ['p', 0] },
    mathBlock: { content: 'text*', group: 'block', code: true, marks: '', toDOM: () => ['div', 0] },
    codeBlock: {
      content: 'text*',
      group: 'block',
      code: true,
      marks: '',
      attrs: { language: { default: '' } },
      toDOM: () => ['pre', ['code', 0]],
    },
    mathInline: {
      inline: true,
      group: 'inline',
      atom: true,
      attrs: { latex: { default: '' } },
      toDOM: () => ['span'],
    },
    blockquote: { content: 'block+', group: 'block', toDOM: () => ['blockquote', 0] },
    bulletList: { content: 'block+', group: 'block', toDOM: () => ['ul', 0] },
  },
  marks: {},
});

const { paragraph, mathBlock, codeBlock, mathInline, blockquote, bulletList } = schema.nodes;

describe('collectRenderableBlocksFromDoc', () => {
  it('收 mathBlock(kind=math)+ source 是 latex', () => {
    const doc = schema.node('doc', null, [
      paragraph.create(null, schema.text('前文')),
      mathBlock.create(null, schema.text('\\int_0^1 x dx')),
    ]);
    const out = collectRenderableBlocksFromDoc(doc);
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe('math');
    expect(out[0].source).toBe('\\int_0^1 x dx');
    expect((out[0].atom as { type: string }).type).toBe('mathBlock');
  });

  it('普通代码块 kind=code;Mermaid 代码块 kind=mermaid', () => {
    const doc = schema.node('doc', null, [
      codeBlock.create({ language: 'js' }, schema.text('const a = 1;')),
      codeBlock.create({ language: 'mermaid' }, schema.text('graph TD; A-->B')),
    ]);
    const out = collectRenderableBlocksFromDoc(doc);
    expect(out.map((b) => b.kind)).toEqual(['code', 'mermaid']);
    expect(out[1].source).toBe('graph TD; A-->B');
    expect(out[1].language).toBe('mermaid');
  });

  it('mathInline 行内公式不收(降级文本)', () => {
    const doc = schema.node('doc', null, [
      paragraph.create(null, [schema.text('看 '), mathInline.create({ latex: 'x^2' })]),
    ]);
    expect(collectRenderableBlocksFromDoc(doc)).toHaveLength(0);
  });

  it('递归进 blockquote / bulletList 收里面的公式与代码', () => {
    const doc = schema.node('doc', null, [
      blockquote.create(null, [mathBlock.create(null, schema.text('E=mc^2'))]),
      bulletList.create(null, [
        paragraph.create(null, schema.text('item')),
        codeBlock.create({ language: '' }, schema.text('code in list')),
      ]),
    ]);
    const out = collectRenderableBlocksFromDoc(doc);
    expect(out.map((b) => b.kind)).toEqual(['math', 'code']);
    expect(out[0].source).toBe('E=mc^2');
    expect(out[1].source).toBe('code in list');
  });

  it('顺序 = 文档出现先后', () => {
    const doc = schema.node('doc', null, [
      codeBlock.create({ language: 'js' }, schema.text('first')),
      mathBlock.create(null, schema.text('second')),
      codeBlock.create({ language: 'py' }, schema.text('third')),
    ]);
    const out = collectRenderableBlocksFromDoc(doc);
    expect(out.map((b) => b.source)).toEqual(['first', 'second', 'third']);
  });

  it('无公式/代码 → 空数组', () => {
    const doc = schema.node('doc', null, [paragraph.create(null, schema.text('纯文字'))]);
    expect(collectRenderableBlocksFromDoc(doc)).toEqual([]);
  });
});

describe('collectRenderableBlocksFromSlice', () => {
  it('从 slice 收(与选区同源)', () => {
    const doc = schema.node('doc', null, [
      paragraph.create(null, schema.text('a')),
      mathBlock.create(null, schema.text('\\alpha')),
      codeBlock.create({ language: 'mermaid' }, schema.text('flowchart LR')),
    ]);
    // 取整篇内容作 slice(openStart/openEnd=0)
    const slice = new Slice(doc.content, 0, 0);
    const out = collectRenderableBlocksFromSlice(slice);
    expect(out.map((b) => b.kind)).toEqual(['math', 'mermaid']);
  });

  it('空 slice → 空数组', () => {
    expect(collectRenderableBlocksFromSlice(Slice.empty)).toEqual([]);
  });
});
