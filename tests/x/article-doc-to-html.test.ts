/**
 * articleDocToHtml — Article 兼容 doc → X 支持的干净 HTML(发布走剪贴板 paste)
 *
 * 守的约束(X Articles 2026-06-12,实测 X 认富文本粘贴):
 *  - 干净语义标签:h1-h3 / p / strong·em·s·a / ul·ol·li / blockquote / img / table
 *  - 无 app 私有 attrs / class(不复用 note toDOM)
 *  - heading level > 3 夹到 h3(X 最低标题级)
 *  - 文本/属性 HTML 转义
 *  - img src=media://(总指挥拍板)
 */
import { describe, it, expect } from 'vitest';
import { Schema } from 'prosemirror-model';
import { articleDocToHtml } from '@drivers/text-editing-driver/serializers/article-doc-to-html';

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    text: { group: 'inline' },
    paragraph: { content: 'inline*', group: 'block', toDOM: () => ['p', 0] },
    heading: { content: 'inline*', group: 'block', attrs: { level: { default: 1 } }, toDOM: () => ['h1', 0] },
    hardBreak: { inline: true, group: 'inline', toDOM: () => ['br'] },
    image: { group: 'block', atom: true, attrs: { src: { default: '' }, alt: { default: '' } }, toDOM: () => ['img'] },
    blockquote: { content: 'block+', group: 'block', toDOM: () => ['blockquote', 0] },
    bulletList: { content: 'listItem+', group: 'block', toDOM: () => ['ul', 0] },
    orderedList: { content: 'listItem+', group: 'block', attrs: { start: { default: 1 } }, toDOM: () => ['ol', 0] },
    listItem: { content: 'block+', group: 'listItem', toDOM: () => ['li', 0] },
    table: { content: 'tableRow+', group: 'block', toDOM: () => ['table', 0] },
    tableRow: { content: 'tableCell+', toDOM: () => ['tr', 0] },
    tableCell: { content: 'block+', toDOM: () => ['td', 0] },
  },
  marks: {
    bold: { toDOM: () => ['strong', 0] },
    italic: { toDOM: () => ['em', 0] },
    strike: { toDOM: () => ['s', 0] },
    link: { attrs: { href: { default: '' } }, toDOM: () => ['a', 0] },
  },
});
const N = schema.nodes;
const Mk = schema.marks;
const doc = (...b: ReturnType<Schema['node']>[]) => schema.node('doc', null, b);

describe('articleDocToHtml', () => {
  it('paragraph → <p>,heading level 映射 <hN>', () => {
    const html = articleDocToHtml(doc(
      N.paragraph.create(null, schema.text('hi')),
      N.heading.create({ level: 2 }, schema.text('标题')),
    ));
    expect(html).toBe('<p>hi</p><h2>标题</h2>');
  });

  it('heading level > 2 夹到 h2（★ 实测 X Article 只有 Heading=h1 / Subheading=h2，无 h3）', () => {
    const html = articleDocToHtml(doc(N.heading.create({ level: 5 }, schema.text('深'))));
    expect(html).toBe('<h2>深</h2>');
  });

  it('heading level 1 → h1（Heading 大标题）', () => {
    const html = articleDocToHtml(doc(N.heading.create({ level: 1 }, schema.text('大'))));
    expect(html).toBe('<h1>大</h1>');
  });

  it('bold/italic/strike/link → 语义标签', () => {
    const html = articleDocToHtml(doc(N.paragraph.create(null, [
      schema.text('B', [Mk.bold.create()]),
      schema.text('I', [Mk.italic.create()]),
      schema.text('S', [Mk.strike.create()]),
      schema.text('L', [Mk.link.create({ href: 'https://x.com' })]),
    ])));
    expect(html).toBe('<p><strong>B</strong><em>I</em><s>S</s><a href="https://x.com">L</a></p>');
  });

  it('list → ul/ol/li;ordered start 保留', () => {
    const html = articleDocToHtml(doc(
      N.bulletList.create(null, [N.listItem.create(null, [N.paragraph.create(null, schema.text('a'))])]),
      N.orderedList.create({ start: 3 }, [N.listItem.create(null, [N.paragraph.create(null, schema.text('b'))])]),
    ));
    expect(html).toContain('<ul><li><p>a</p></li></ul>');
    expect(html).toContain('<ol start="3"><li><p>b</p></li></ol>');
  });

  it('blockquote 递归', () => {
    const html = articleDocToHtml(doc(
      N.blockquote.create(null, [N.paragraph.create(null, schema.text('q'))]),
    ));
    expect(html).toBe('<blockquote><p>q</p></blockquote>');
  });

  it('image → <img src=media://>', () => {
    const html = articleDocToHtml(doc(N.image.create({ src: 'media://x', alt: '图' })));
    expect(html).toBe('<img src="media://x" alt="图">');
  });

  it('table → 干净 <table>', () => {
    const html = articleDocToHtml(doc(
      N.table.create(null, [
        N.tableRow.create(null, [
          N.tableCell.create(null, [N.paragraph.create(null, schema.text('A'))]),
          N.tableCell.create(null, [N.paragraph.create(null, schema.text('B'))]),
        ]),
      ]),
    ));
    expect(html).toBe('<table><tr><td><p>A</p></td><td><p>B</p></td></tr></table>');
  });

  it('HTML 转义文本与属性', () => {
    const html = articleDocToHtml(doc(
      N.paragraph.create(null, schema.text('<script>&"')),
      N.paragraph.create(null, [schema.text('x', [Mk.link.create({ href: 'https://a.com?b=1&c="2"' })])]),
    ));
    expect(html).toContain('&lt;script&gt;&amp;&quot;');
    expect(html).toContain('href="https://a.com?b=1&amp;c=&quot;2&quot;"');
  });

  it('hardBreak → <br>;空段落 → <p><br></p>', () => {
    const html = articleDocToHtml(doc(
      N.paragraph.create(null, [schema.text('a'), N.hardBreak.create(), schema.text('b')]),
      N.paragraph.create(),
    ));
    expect(html).toBe('<p>a<br>b</p><p><br></p>');
  });
});
