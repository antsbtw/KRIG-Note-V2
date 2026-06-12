/**
 * transformDocToArticleDoc — note doc → 「X Article 兼容 doc」结构转换
 *
 * 守的约束(X Articles 2026-06-12 总指挥拍板,见
 *  docs/tasks/2026-06-12-x-articles-prompt.md + 格式矩阵 A-3):
 *  - ① 原生映射:paragraph/heading/list/blockquote/image + bold·italic·strike·link mark 原样
 *  - ② 文本降级:underline/highlight/字色/thought 丢格式留字;行内 code → 反引号;
 *       callout→引用+emoji;toggle 展开;task→☐☑;多列拍平;audio/file/noteLink→文字
 *  - ③ 内嵌图:codeBlock/mathBlock/mermaid/mathVisual → image(media://)(mediaMap 命中);
 *       未命中(渲图失败/不渲)→ 降级文本(代码```围栏 / 公式$$)
 *  - ★ table 例外:原样保留(呈现态真实可调,发布时才截图)
 *  - mathInline → $latex$ 文本(本期不成图)
 */
import { describe, it, expect } from 'vitest';
import { Schema } from 'prosemirror-model';
import {
  transformDocToArticleDoc,
  blockMediaKey,
  isVisualBlock,
  type ArticleMediaMap,
} from '@drivers/text-editing-driver/serializers/doc-to-article-doc';

// 最小 schema:覆盖被测节点 + marks。结构对齐 note schema 关键约束(content/group)。
const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    text: { group: 'inline' },
    paragraph: {
      content: 'inline*',
      group: 'block',
      attrs: { isTitle: { default: false }, level: { default: null } },
      toDOM: () => ['p', 0],
    },
    heading: {
      content: 'inline*',
      group: 'block',
      attrs: { level: { default: 1 } },
      toDOM: () => ['h1', 0],
    },
    hardBreak: { inline: true, group: 'inline', selectable: false, toDOM: () => ['br'] },
    mathInline: { inline: true, group: 'inline', atom: true, attrs: { latex: { default: '' } }, toDOM: () => ['span'] },
    noteLink: { inline: true, group: 'inline', atom: true, attrs: { noteId: { default: '' }, label: { default: '' } }, toDOM: () => ['span'] },
    image: {
      group: 'block',
      atom: true,
      content: 'block?',
      attrs: { src: { default: '' }, alt: { default: '' } },
      toDOM: () => ['img'],
    },
    mathBlock: { content: 'text*', group: 'block', code: true, marks: '', attrs: { latex: { default: '' } }, toDOM: () => ['div', 0] },
    mathVisual: { group: 'block', atom: true, attrs: { thumbnail: { default: '' } }, toDOM: () => ['div'] },
    codeBlock: { content: 'text*', group: 'block', code: true, marks: '', attrs: { language: { default: '' } }, toDOM: () => ['pre', ['code', 0]] },
    blockquote: { content: 'block+', group: 'block', toDOM: () => ['blockquote', 0] },
    callout: { content: 'block+', group: 'block', attrs: { emoji: { default: '💡' } }, toDOM: () => ['div', 0] },
    toggleList: { content: 'block+', group: 'block', attrs: { open: { default: true } }, toDOM: () => ['div', 0] },
    bulletList: { content: 'listItem+', group: 'block', toDOM: () => ['ul', 0] },
    orderedList: { content: 'listItem+', group: 'block', attrs: { start: { default: 1 } }, toDOM: () => ['ol', 0] },
    listItem: { content: 'block+', group: 'listItem', attrs: { indent: { default: 0 } }, toDOM: () => ['li', 0] },
    taskList: { content: 'taskItem+', group: 'block', toDOM: () => ['ul', 0] },
    taskItem: { content: 'block+', group: 'taskItem', attrs: { checked: { default: false } }, toDOM: () => ['li', 0] },
    columnList: { content: 'column+', group: 'block', toDOM: () => ['div', 0] },
    column: { content: 'block+', group: 'column', toDOM: () => ['div', 0] },
    audioBlock: { group: 'block', atom: true, attrs: { title: { default: 'Audio' } }, toDOM: () => ['div'] },
    htmlBlock: { group: 'block', atom: true, attrs: { title: { default: '' } }, toDOM: () => ['div'] },
    fileBlock: { group: 'block', atom: true, attrs: { filename: { default: 'File' } }, toDOM: () => ['div'] },
    externalRef: { group: 'block', atom: true, attrs: { href: { default: '' }, title: { default: '' } }, toDOM: () => ['div'] },
    horizontalRule: { group: 'block', atom: true, toDOM: () => ['hr'] },
    table: { content: 'tableRow+', group: 'block', isolating: true, toDOM: () => ['table', 0] },
    tableRow: { content: 'tableCell+', toDOM: () => ['tr', 0] },
    tableCell: { content: 'block+', isolating: true, attrs: { colwidth: { default: null } }, toDOM: () => ['td', 0] },
  },
  marks: {
    bold: { toDOM: () => ['strong', 0] },
    italic: { toDOM: () => ['em', 0] },
    strike: { toDOM: () => ['s', 0] },
    underline: { toDOM: () => ['u', 0] },
    code: { excludes: '_', toDOM: () => ['code', 0] },
    highlight: { toDOM: () => ['mark', 0] },
    textStyle: { attrs: { color: { default: null } }, toDOM: () => ['span', 0] },
    thought: { attrs: { thoughtId: { default: '' } }, toDOM: () => ['span', 0] },
    link: { attrs: { href: { default: '' } }, toDOM: () => ['a', 0] },
  },
});

const N = schema.nodes;
const M = schema.marks;
function doc(...blocks: ReturnType<Schema['node']>[]) {
  return schema.node('doc', null, blocks);
}
function transform(d: ReturnType<Schema['node']>, mediaMap?: ArticleMediaMap) {
  return transformDocToArticleDoc(d, schema, mediaMap ? { mediaMap } : {});
}

describe('① 原生映射', () => {
  it('paragraph / heading 原样保留(level 保留)', () => {
    const out = transform(doc(
      N.paragraph.create(null, schema.text('hello')),
      N.heading.create({ level: 2 }, schema.text('章节')),
    ));
    expect(out.child(0).type.name).toBe('paragraph');
    expect(out.child(0).textContent).toBe('hello');
    expect(out.child(1).type.name).toBe('heading');
    expect(out.child(1).attrs.level).toBe(2);
  });

  it('bold/italic/strike/link mark 保留', () => {
    const out = transform(doc(
      N.paragraph.create(null, [
        schema.text('B', [M.bold.create()]),
        schema.text('I', [M.italic.create()]),
        schema.text('L', [M.link.create({ href: 'https://x.com' })]),
      ]),
    ));
    const p = out.child(0);
    expect(p.child(0).marks.map((m) => m.type.name)).toEqual(['bold']);
    expect(p.child(2).marks[0].type.name).toBe('link');
    expect(p.child(2).marks[0].attrs.href).toBe('https://x.com');
  });

  it('blockquote / list 递归保留', () => {
    const out = transform(doc(
      N.blockquote.create(null, [N.paragraph.create(null, schema.text('引用'))]),
      N.bulletList.create(null, [N.listItem.create(null, [N.paragraph.create(null, schema.text('项'))])]),
    ));
    expect(out.child(0).type.name).toBe('blockquote');
    expect(out.child(0).textContent).toBe('引用');
    expect(out.child(1).type.name).toBe('bulletList');
    expect(out.child(1).textContent).toBe('项');
  });

  it('image 原样(含 src)', () => {
    const out = transform(doc(N.image.create({ src: 'media://abc', alt: 'x' })));
    expect(out.child(0).type.name).toBe('image');
    expect(out.child(0).attrs.src).toBe('media://abc');
  });
});

describe('② 文本降级:marks', () => {
  it('underline/highlight/字色/thought 丢格式留字', () => {
    const out = transform(doc(
      N.paragraph.create(null, [
        schema.text('U', [M.underline.create()]),
        schema.text('H', [M.highlight.create()]),
        schema.text('C', [M.textStyle.create({ color: 'red' })]),
        schema.text('T', [M.thought.create({ thoughtId: 't1' })]),
      ]),
    ));
    const p = out.child(0);
    expect(p.textContent).toBe('UHCT');
    p.forEach((c) => expect(c.marks).toHaveLength(0));
  });

  it('行内 code → 反引号包裹文字', () => {
    const out = transform(doc(N.paragraph.create(null, [schema.text('foo', [M.code.create()])])));
    expect(out.child(0).textContent).toBe('`foo`');
    expect(out.child(0).child(0).marks).toHaveLength(0);
  });

  it('underline+bold 混:丢 underline 留 bold', () => {
    const out = transform(doc(N.paragraph.create(null, [
      schema.text('x', [M.bold.create(), M.underline.create()]),
    ])));
    expect(out.child(0).child(0).marks.map((m) => m.type.name)).toEqual(['bold']);
  });
});

describe('② 文本降级:inline 节点', () => {
  it('mathInline → $latex$ 文本', () => {
    const out = transform(doc(N.paragraph.create(null, [
      schema.text('看 '),
      N.mathInline.create({ latex: 'x^2' }),
    ])));
    expect(out.child(0).textContent).toBe('看 $x^2$');
  });
  it('noteLink → 纯 label', () => {
    const out = transform(doc(N.paragraph.create(null, [N.noteLink.create({ label: '别的笔记' })])));
    expect(out.child(0).textContent).toBe('别的笔记');
  });
  it('hardBreak 保留', () => {
    const out = transform(doc(N.paragraph.create(null, [schema.text('a'), N.hardBreak.create(), schema.text('b')])));
    expect(out.child(0).child(1).type.name).toBe('hardBreak');
  });
});

describe('② 文本降级:容器块', () => {
  it('callout → blockquote + emoji 前缀', () => {
    const out = transform(doc(
      N.callout.create({ emoji: '🔥' }, [N.paragraph.create(null, schema.text('提示'))]),
    ));
    expect(out.child(0).type.name).toBe('blockquote');
    expect(out.child(0).textContent).toBe('🔥 提示');
  });

  it('toggleList → 展开为顺序块', () => {
    const out = transform(doc(
      N.toggleList.create(null, [
        N.paragraph.create(null, schema.text('标题')),
        N.paragraph.create(null, schema.text('正文')),
      ]),
    ));
    expect(out.childCount).toBe(2);
    expect(out.child(0).textContent).toBe('标题');
    expect(out.child(1).textContent).toBe('正文');
  });

  it('taskList → bulletList + ☐/☑ 前缀', () => {
    const out = transform(doc(
      N.taskList.create(null, [
        N.taskItem.create({ checked: true }, [N.paragraph.create(null, schema.text('done'))]),
        N.taskItem.create({ checked: false }, [N.paragraph.create(null, schema.text('todo'))]),
      ]),
    ));
    expect(out.child(0).type.name).toBe('bulletList');
    expect(out.child(0).child(0).textContent).toBe('☑ done');
    expect(out.child(0).child(1).textContent).toBe('☐ todo');
  });

  it('columnList → 拍平为顺序段落', () => {
    const out = transform(doc(
      N.columnList.create(null, [
        N.column.create(null, [N.paragraph.create(null, schema.text('col1'))]),
        N.column.create(null, [N.paragraph.create(null, schema.text('col2'))]),
      ]),
    ));
    expect(out.childCount).toBe(2);
    expect(out.child(0).textContent).toBe('col1');
    expect(out.child(1).textContent).toBe('col2');
  });
});

describe('② 文本降级:媒体/文件块', () => {
  it('audioBlock → 🔊 文字', () => {
    const out = transform(doc(N.audioBlock.create({ title: '播客' })));
    expect(out.child(0).textContent).toBe('🔊 播客');
  });
  it('fileBlock → 📎 文字', () => {
    const out = transform(doc(N.fileBlock.create({ filename: 'a.pdf' })));
    expect(out.child(0).textContent).toBe('📎 a.pdf');
  });
  it('externalRef(url)→ 链接段落', () => {
    const out = transform(doc(N.externalRef.create({ href: 'https://e.com', title: 'E' })));
    expect(out.child(0).child(0).marks[0].type.name).toBe('link');
    expect(out.child(0).child(0).marks[0].attrs.href).toBe('https://e.com');
  });
  it('htmlBlock → 标题 + 提示文字', () => {
    const out = transform(doc(N.htmlBlock.create({ title: '图表' })));
    expect(out.child(0).textContent).toContain('图表');
    expect(out.child(0).textContent).toContain('本期不支持');
  });
});

describe('③ 内嵌图:视觉块', () => {
  it('mediaMap 命中 → 替换成 image(media://)', () => {
    const code = N.codeBlock.create({ language: 'js' }, schema.text('const a=1'));
    const math = N.mathBlock.create(null, schema.text('E=mc^2'));
    const mediaMap: ArticleMediaMap = new Map([
      [blockMediaKey(code), 'media://code-img'],
      [blockMediaKey(math), 'media://math-img'],
    ]);
    const out = transform(doc(code, math), mediaMap);
    expect(out.child(0).type.name).toBe('image');
    expect(out.child(0).attrs.src).toBe('media://code-img');
    expect(out.child(1).type.name).toBe('image');
    expect(out.child(1).attrs.src).toBe('media://math-img');
  });

  it('mediaMap 未命中 → codeBlock 降级 ``` 围栏文本', () => {
    const out = transform(doc(N.codeBlock.create({ language: 'py' }, schema.text('print(1)'))));
    expect(out.child(0).type.name).toBe('paragraph');
    expect(out.child(0).textContent).toContain('```py');
    expect(out.child(0).textContent).toContain('print(1)');
  });

  it('mediaMap 未命中 → mathBlock 降级 $$ 文本', () => {
    const out = transform(doc(N.mathBlock.create(null, schema.text('\\alpha'))));
    expect(out.child(0).textContent).toBe('$$\\alpha$$');
  });

  it('mermaid codeBlock 命中 mediaMap(同 key) → image', () => {
    const mer = N.codeBlock.create({ language: 'mermaid' }, schema.text('graph TD'));
    const mediaMap: ArticleMediaMap = new Map([[blockMediaKey(mer), 'media://mer']]);
    const out = transform(doc(mer), mediaMap);
    expect(out.child(0).type.name).toBe('image');
  });

  it('isVisualBlock 识别 math/code/mathVisual,不识别 table/paragraph', () => {
    expect(isVisualBlock(N.mathBlock.create(null, schema.text('x')))).toBe(true);
    expect(isVisualBlock(N.codeBlock.create(null, schema.text('x')))).toBe(true);
    expect(isVisualBlock(N.mathVisual.create())).toBe(true);
    expect(isVisualBlock(N.paragraph.create(null, schema.text('x')))).toBe(false);
    expect(isVisualBlock(N.table.create(null, [
      N.tableRow.create(null, [N.tableCell.create(null, [N.paragraph.create()])]),
    ]))).toBe(false);
  });
});

describe('★ table 例外', () => {
  it('table 原样保留(不转图、不改结构)', () => {
    const table = N.table.create(null, [
      N.tableRow.create(null, [
        N.tableCell.create({ colwidth: [120] }, [N.paragraph.create(null, schema.text('A'))]),
        N.tableCell.create(null, [N.paragraph.create(null, schema.text('B'))]),
      ]),
    ]);
    const out = transform(doc(table));
    expect(out.child(0).type.name).toBe('table');
    expect(out.child(0).child(0).child(0).attrs.colwidth).toEqual([120]);
    expect(out.child(0).textContent).toBe('AB');
  });
});

describe('边界', () => {
  it('isTitle 段落保留 isTitle 标记(调用方决定是否剥离做标题字段)', () => {
    const out = transform(doc(N.paragraph.create({ isTitle: true }, schema.text('文档标题'))));
    expect(out.child(0).attrs.isTitle).toBe(true);
  });
  it('空 doc → 单空段落(满足 content=block+)', () => {
    const out = transform(schema.node('doc', null, [N.paragraph.create()]));
    expect(out.childCount).toBe(1);
    expect(out.child(0).type.name).toBe('paragraph');
  });
  it('horizontalRule 保留', () => {
    const out = transform(doc(N.horizontalRule.create()));
    expect(out.child(0).type.name).toBe('horizontalRule');
  });
  it('不改原 doc(产物是新节点)', () => {
    const original = doc(N.callout.create({ emoji: '💡' }, [N.paragraph.create(null, schema.text('x'))]));
    const out = transform(original);
    expect(original.child(0).type.name).toBe('callout'); // 原 doc 不变
    expect(out.child(0).type.name).toBe('blockquote'); // 产物已转
  });
});
