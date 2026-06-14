/**
 * buildArticlePlan — note doc → 「X Article 原生 Insert 驱动计划」纯逻辑层(终态发布,2026-06-13)。
 *
 * 守的约束(总指挥实测 Insert 菜单后定终态,见 docs/tasks/2026-06-13-x-articles-native-insert-impl-prompt.md §0):
 *  - mathBlock → latex step(裸 latex)/ codeBlock → code step(语言+源码)/ table → table step(markdown)
 *  - tweetBlock → posts step(tweetUrl)/ horizontalRule → divider step
 *  - 连续可粘贴块(段落/标题/列表/图)→ 批量一个 html step(复用整篇 HTML 路降级)
 *  - isTitle 首块 → title 字段,不进正文
 *  - 文档顺序穿插保持;Mermaid/mathVisual 在 mediaMap → media step,否则降级
 *
 * 全离线:无 view / DOM / IPC。驱动器 main 侧 DOM 交互不在此测(待实机)。
 */
import { describe, it, expect } from 'vitest';
import { Schema } from 'prosemirror-model';
import { blockMediaKey } from '@drivers/text-editing-driver/serializers/doc-to-article-doc';
import {
  buildArticlePlan,
  type ArticleInsertStep,
} from '@drivers/text-editing-driver/serializers/note-to-article-plan';

// 最小 schema(对齐 tests/x/doc-to-article-doc.test.ts 同款,补 tweetBlock / tableHeader)。
const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    text: { group: 'inline' },
    paragraph: {
      content: 'inline*',
      group: 'block',
      attrs: { isTitle: { default: false } },
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
    image: {
      group: 'block',
      atom: true,
      content: 'block?',
      attrs: { src: { default: '' }, alt: { default: '' } },
      toDOM: () => ['img'],
    },
    mathBlock: {
      content: 'text*',
      group: 'block',
      code: true,
      marks: '',
      attrs: { latex: { default: '' } },
      toDOM: () => ['div', 0],
    },
    mathVisual: { group: 'block', atom: true, attrs: { thumbnail: { default: '' } }, toDOM: () => ['div'] },
    codeBlock: {
      content: 'text*',
      group: 'block',
      code: true,
      marks: '',
      attrs: { language: { default: '' } },
      toDOM: () => ['pre', ['code', 0]],
    },
    bulletList: { content: 'listItem+', group: 'block', toDOM: () => ['ul', 0] },
    listItem: { content: 'block+', group: 'listItem', toDOM: () => ['li', 0] },
    blockquote: { content: 'block+', group: 'block', toDOM: () => ['blockquote', 0] },
    callout: { content: 'block+', group: 'block', attrs: { emoji: { default: '💡' } }, toDOM: () => ['div', 0] },
    horizontalRule: { group: 'block', atom: true, toDOM: () => ['hr'] },
    tweetBlock: {
      content: 'block',
      group: 'block',
      attrs: { tweetUrl: { default: null }, authorName: { default: '' }, text: { default: '' } },
      toDOM: () => ['div', 0],
    },
    table: { content: 'tableRow+', group: 'block', isolating: true, toDOM: () => ['table', 0] },
    tableRow: { content: '(tableCell | tableHeader)+', toDOM: () => ['tr', 0] },
    tableCell: { content: 'block+', isolating: true, toDOM: () => ['td', 0] },
    tableHeader: { content: 'block+', isolating: true, toDOM: () => ['th', 0] },
  },
  marks: {
    bold: { toDOM: () => ['strong', 0] },
    italic: { toDOM: () => ['em', 0] },
    strike: { toDOM: () => ['s', 0] },
    code: { excludes: '_', toDOM: () => ['code', 0] },
    link: { attrs: { href: { default: '' } }, toDOM: () => ['a', 0] },
  },
});

// ─── 构造 helpers ────────────────────────────────────────────────────
const t = (text: string) => schema.text(text);
const para = (text: string) => schema.node('paragraph', null, text ? [t(text)] : []);
const title = (text: string) => schema.node('paragraph', { isTitle: true }, [t(text)]);
const heading = (level: number, text: string) => schema.node('heading', { level }, [t(text)]);
const mathBlock = (latex: string) => schema.node('mathBlock', null, latex ? [t(latex)] : []);
const codeBlock = (language: string, code: string) =>
  schema.node('codeBlock', { language }, code ? [t(code)] : []);
const tweetBlock = (tweetUrl: string) =>
  schema.node('tweetBlock', { tweetUrl }, [schema.node('paragraph', null, [])]);
const hr = () => schema.node('horizontalRule', null, []);
const image = (src: string) => schema.node('image', { src }, []);
const tableNode = (rows: string[][]) =>
  schema.node(
    'table',
    null,
    rows.map((cells, r) =>
      schema.node(
        'tableRow',
        null,
        cells.map((c) =>
          schema.node(r === 0 ? 'tableHeader' : 'tableCell', null, [
            schema.node('paragraph', null, c ? [t(c)] : []),
          ]),
        ),
      ),
    ),
  );
const doc = (...blocks: ReturnType<Schema['node']>[]) => schema.node('doc', null, blocks);

// ─── 测试 ────────────────────────────────────────────────────────────

describe('buildArticlePlan — 标题抽取', () => {
  it('isTitle 首块 → title 字段,不进正文', () => {
    const plan = buildArticlePlan(doc(title('我的文章'), para('正文')), schema);
    expect(plan.title).toBe('我的文章');
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0].kind).toBe('html');
    expect((plan.steps[0] as { html: string }).html).not.toContain('我的文章');
    expect((plan.steps[0] as { html: string }).html).toContain('正文');
  });

  it('无 isTitle 首块 → title 空,首块进正文', () => {
    const plan = buildArticlePlan(doc(para('普通开头')), schema);
    expect(plan.title).toBe('');
    expect(plan.steps[0].kind).toBe('html');
  });
});

describe('buildArticlePlan — 各 block → 对应原生 step', () => {
  it('mathBlock → latex step(裸 latex,无 $ 包裹)', () => {
    const plan = buildArticlePlan(doc(title('t'), mathBlock('E = mc^2')), schema);
    expect(plan.steps).toEqual<ArticleInsertStep[]>([{ kind: 'latex', latex: 'E = mc^2' }]);
  });

  it('codeBlock → code step(语言 + 源码)', () => {
    const plan = buildArticlePlan(doc(title('t'), codeBlock('python', 'print(1)')), schema);
    expect(plan.steps).toEqual<ArticleInsertStep[]>([
      { kind: 'code', language: 'python', code: 'print(1)' },
    ]);
  });

  it('table → table step(走 X 原生网格;实机:<table> 富文本粘贴 X 不认)', () => {
    const plan = buildArticlePlan(doc(title('t'), tableNode([['A', 'B'], ['1', '2']])), schema);
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0].kind).toBe('table');
    const md = (plan.steps[0] as { markdown: string }).markdown;
    expect(md).toContain('| A | B |');
    expect(md).toContain('| 1 | 2 |');
  });

  it('tweetBlock → posts step(tweetUrl)', () => {
    const url = 'https://x.com/a/status/123';
    const plan = buildArticlePlan(doc(title('t'), tweetBlock(url)), schema);
    expect(plan.steps).toEqual<ArticleInsertStep[]>([{ kind: 'posts', tweetUrl: url }]);
  });

  it('horizontalRule → divider step', () => {
    const plan = buildArticlePlan(doc(title('t'), hr()), schema);
    expect(plan.steps).toEqual<ArticleInsertStep[]>([{ kind: 'divider' }]);
  });
});

describe('buildArticlePlan — 连续可粘贴块批量成一个 html step', () => {
  it('连续标题/段落/列表 → 合并为单个 html step', () => {
    const list = schema.node('bulletList', null, [
      schema.node('listItem', null, [para('项一')]),
      schema.node('listItem', null, [para('项二')]),
    ]);
    const plan = buildArticlePlan(doc(title('t'), heading(2, '小标题'), para('段落'), list), schema);
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0].kind).toBe('html');
    const html = (plan.steps[0] as { html: string }).html;
    expect(html).toContain('<h2>小标题</h2>');
    expect(html).toContain('<p>段落</p>');
    expect(html).toContain('<li>');
  });

  it('普通 image → media step(总指挥实测 <img> 粘不进 X,走 Media 喂文件)', () => {
    const plan = buildArticlePlan(
      doc(title('t'), para('图前'), image('media://images/x.png')),
      schema,
    );
    // 段落「图前」→ html step;image → 独立 media step(不再塞进 html 的 <img>)
    expect(plan.steps.map((s) => s.kind)).toEqual(['html', 'media']);
    const mediaStep = plan.steps[1] as { kind: 'media'; mediaUrl: string };
    expect(mediaStep.mediaUrl).toBe('media://images/x.png');
    // html step 不再含 <img>/media:// URL(图已切走)
    expect((plan.steps[0] as { html: string }).html).not.toContain('media://');
    expect((plan.steps[0] as { html: string }).html).not.toContain('<img');
  });

  it('image 的 caption 文字 → 并入 media step 的 alt(不丢内容)', () => {
    const imgWithCaption = schema.node('image', { src: 'media://a.png' }, [
      schema.node('paragraph', null, [t('图说明')]),
    ]);
    const plan = buildArticlePlan(doc(title('t'), imgWithCaption), schema);
    const mediaStep = plan.steps.find((s) => s.kind === 'media') as { alt?: string };
    expect(mediaStep.alt).toBe('图说明');
  });
});

describe('buildArticlePlan — 文档顺序穿插保持', () => {
  it('段落+公式+段落+代码 → html,latex,html,code 按序', () => {
    const plan = buildArticlePlan(
      doc(title('t'), para('引言'), mathBlock('a^2'), para('中间'), codeBlock('js', 'x=1')),
      schema,
    );
    expect(plan.steps.map((s) => s.kind)).toEqual(['html', 'latex', 'html', 'code']);
  });
});

describe('buildArticlePlan — mediaMap 兜底(Mermaid/mathVisual → media step)', () => {
  it('mermaid 代码块在 mediaMap → media step(走图)', () => {
    const mermaid = codeBlock('mermaid', 'graph TD; A-->B');
    const mediaMap = new Map<string, string>([[blockMediaKey(mermaid), 'media://images/m.png']]);
    const plan = buildArticlePlan(doc(title('t'), mermaid), schema, { mediaMap });
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0].kind).toBe('media');
    expect((plan.steps[0] as { mediaUrl: string }).mediaUrl).toBe('media://images/m.png');
  });

  it('mermaid 不在 mediaMap → 降级 code step 并标 degraded', () => {
    const plan = buildArticlePlan(doc(title('t'), codeBlock('mermaid', 'graph TD; A-->B')), schema);
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0].kind).toBe('code');
    expect((plan.steps[0] as { degraded?: boolean }).degraded).toBe(true);
  });
});

describe('buildArticlePlan — 嵌套拍平(X 不支持深嵌套)', () => {
  it('blockquote 内嵌图 → 图提到顶层 media step(不留在 html)', () => {
    const quoteWithImage = schema.node('blockquote', null, [
      para('引用文字'),
      image('media://images/in-quote.png'),
    ]);
    const plan = buildArticlePlan(doc(title('t'), quoteWithImage), schema);
    // 图被拍平提出来成独立 media step
    const mediaSteps = plan.steps.filter((s) => s.kind === 'media');
    expect(mediaSteps).toHaveLength(1);
    expect((mediaSteps[0] as { mediaUrl: string }).mediaUrl).toBe('media://images/in-quote.png');
    // html step 里不应再含该图 src
    const htmlSteps = plan.steps.filter((s) => s.kind === 'html') as { html: string }[];
    expect(htmlSteps.every((s) => !s.html.includes('in-quote.png'))).toBe(true);
  });

  it('callout 内嵌代码块 → 代码提到顶层 code step', () => {
    const calloutWithCode = schema.node('callout', null, [
      para('提示'),
      codeBlock('js', 'x=1'),
    ]);
    const plan = buildArticlePlan(doc(title('t'), calloutWithCode), schema);
    expect(plan.steps.some((s) => s.kind === 'code')).toBe(true);
  });

  it('纯文本 blockquote(无 native 块)→ 整体走 html,不拍平', () => {
    const plainQuote = schema.node('blockquote', null, [para('纯引用')]);
    const plan = buildArticlePlan(doc(title('t'), plainQuote), schema);
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0].kind).toBe('html');
    expect((plan.steps[0] as { html: string }).html).toContain('blockquote');
  });
});

describe('buildArticlePlan — 发布前预检 warnings', () => {
  it('行内公式(mathInline)→ warnings 提示不支持行内公式', () => {
    const paraWithInlineMath = schema.node('paragraph', null, [
      t('勾股 '),
      schema.node('mathInline', { latex: 'a^2+b^2=c^2' }),
      t(' 完'),
    ]);
    const plan = buildArticlePlan(doc(title('t'), paraWithInlineMath), schema);
    expect(plan.warnings.some((w) => w.includes('行内公式'))).toBe(true);
  });

  it('无行内公式 → 不提示', () => {
    const plan = buildArticlePlan(doc(title('t'), para('纯文字')), schema);
    expect(plan.warnings.some((w) => w.includes('行内公式'))).toBe(false);
  });
});

describe('buildArticlePlan — 空/退化', () => {
  it('空公式块 → 跳过', () => {
    const plan = buildArticlePlan(doc(title('t'), mathBlock('')), schema);
    expect(plan.steps).toHaveLength(0);
  });
  it('空源码代码块 → 跳过', () => {
    const plan = buildArticlePlan(doc(title('t'), codeBlock('js', '')), schema);
    expect(plan.steps).toHaveLength(0);
  });
  it('只有标题 → 空 steps', () => {
    const plan = buildArticlePlan(doc(title('只有标题')), schema);
    expect(plan.title).toBe('只有标题');
    expect(plan.steps).toHaveLength(0);
  });
});
