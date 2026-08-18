/**
 * @vitest-environment jsdom
 *
 * mathBlock 剪贴板往返 —— 「复制公式块粘贴后变成空公式 + 代码块」的回归钉。
 *
 * bug:math-block 的 toDOM 内层用 <pre> 装 LaTeX 源码。粘贴时 DOMParser 自顶向下走,
 * 外层 div.krig-math-block 命中 mathBlock 规则后进内容区找 text*,而内层 <pre> 命中了
 * code-block 的 `tag: 'pre'` 规则、解析成**块级** codeBlock。mathBlock 的 content 是
 * text*(只收 inline)装不下块 → PM 就地关掉 mathBlock、把 codeBlock 提为兄弟节点 →
 * 公式源码整个被 codeBlock 拿走,mathBlock 剩空壳。
 *
 * 与节点注册顺序无关,是结构性冲突:toDOM 产出的 DOM 被自己 schema 里另一条规则截胡。
 *
 * 本测直接用两个 block 的真实 NodeSpec 建最小 schema —— 不 import spec.ts 是为了避开
 * node-view 模块级 `new IntersectionObserver`(jsdom 无此 API);NodeSpec 结构在此复刻,
 * 与源文件同步靠 assertSpecShapeInSync 一节钉住。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Schema, DOMSerializer, DOMParser as PMDOMParser } from 'prosemirror-model';

const LATEX = 'f(x+l) = f(x)';

/** 复刻 math-block/spec.ts 的 NodeSpec 关键部分 */
const mathBlockNodeSpec = {
  content: 'text*',
  group: 'block',
  code: true,
  defining: true,
  marks: '',
  attrs: { id: { default: null }, color: { default: null }, bgColor: { default: null } },
  parseDOM: [{ tag: 'div.krig-math-block', preserveWhitespace: 'full' as const }],
  toDOM() {
    return ['div', { class: 'krig-math-block' }, ['div', { class: 'krig-math-block__code' }, 0]] as const;
  },
};

/** 复刻 code-block/spec.ts —— 截胡方 */
const codeBlockNodeSpec = {
  content: 'text*',
  marks: '',
  group: 'block',
  code: true,
  defining: true,
  attrs: { id: { default: null }, language: { default: '' } },
  parseDOM: [{ tag: 'pre', preserveWhitespace: 'full' as const }],
  toDOM() {
    return ['pre', { class: 'krig-code-block' }, ['code', {}, 0]] as const;
  },
};

function makeSchema(): Schema {
  return new Schema({
    nodes: {
      doc: { content: 'block+' },
      paragraph: { content: 'inline*', group: 'block', toDOM: () => ['p', 0] as const },
      text: { group: 'inline' },
      codeBlock: codeBlockNodeSpec,
      mathBlock: mathBlockNodeSpec,
    },
  });
}

/** 走 PM 的剪贴板序列化 → 反序列化 */
function clipboardRoundTrip(schema: Schema, doc: ReturnType<Schema['node']>) {
  const holder = document.createElement('div');
  holder.appendChild(
    DOMSerializer.fromSchema(schema).serializeFragment(doc.content, { document }),
  );
  return {
    html: holder.innerHTML,
    parsed: PMDOMParser.fromSchema(schema).parse(holder),
  };
}

describe('mathBlock 剪贴板往返', () => {
  it('公式块复制粘贴后仍是 mathBlock,LaTeX 源码不丢', () => {
    const schema = makeSchema();
    const doc = schema.node('doc', null, [
      schema.nodes.mathBlock.create(null, schema.text(LATEX)),
    ]);

    const { parsed } = clipboardRoundTrip(schema, doc);

    expect(parsed.childCount).toBe(1);
    expect(parsed.firstChild?.type.name).toBe('mathBlock');
    expect(parsed.firstChild?.textContent).toBe(LATEX);
  });

  it('不产出寄生 codeBlock —— 源码被截胡时正是多出这个兄弟节点', () => {
    const schema = makeSchema();
    const doc = schema.node('doc', null, [
      schema.nodes.mathBlock.create(null, schema.text(LATEX)),
    ]);

    const { parsed } = clipboardRoundTrip(schema, doc);

    const names: string[] = [];
    parsed.forEach((n) => names.push(n.type.name));
    expect(names).not.toContain('codeBlock');
  });

  it('剪贴板 HTML 内层不得是 <pre>(会命中 codeBlock 的 tag 规则)', () => {
    const schema = makeSchema();
    const doc = schema.node('doc', null, [
      schema.nodes.mathBlock.create(null, schema.text(LATEX)),
    ]);

    const { html } = clipboardRoundTrip(schema, doc);

    expect(html).toContain('krig-math-block');
    expect(html).not.toContain('<pre');
  });

  it('真 codeBlock 不受影响,仍正常往返', () => {
    const schema = makeSchema();
    const doc = schema.node('doc', null, [
      schema.nodes.codeBlock.create(null, schema.text('const a = 1;')),
    ]);

    const { parsed } = clipboardRoundTrip(schema, doc);

    expect(parsed.firstChild?.type.name).toBe('codeBlock');
    expect(parsed.firstChild?.textContent).toBe('const a = 1;');
  });

  it('源文件 toDOM 内层确实不是 <pre> —— 防本测复刻的 spec 与源文件脱钩', () => {
    const specPath = path.resolve(
      __dirname,
      '../../src/drivers/text-editing-driver/blocks/math-block/spec.ts',
    );
    const src = readFileSync(specPath, 'utf-8');
    const toDOMBody = src.slice(src.indexOf('toDOM(node)'));
    // 只看 return 那一行,注释里提到 <pre> 是解释历史,不算违规
    const returnLine = toDOMBody.split('\n').find((l) => l.includes('return ['));
    expect(returnLine).toBeTruthy();
    expect(returnLine).not.toContain("'pre'");
  });
});
