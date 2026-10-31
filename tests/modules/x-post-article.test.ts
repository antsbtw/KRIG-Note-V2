/**
 * X 文章(第⑥期,2026-10-30):note → 一步一步填进 X 文章编辑器
 * 样本照用户 10-30 那篇「不确定性越来越大的今天…」的结构排(标题 / 链接 / 下划线 / 小标题 / 列表 / Mermaid / 图 / 引用 / 分栏)
 */
import { describe, it, expect } from 'vitest';
import { articleDraft, articleProblem } from '../../src/modules/x/x-post-article';
import { composePost, fillBlock, type PmNode } from '../../src/modules/x/x-post-compose';

type Mark = { type: string; attrs?: Record<string, unknown> };
const t = (text: string, ...marks: Mark[]): PmNode => ({ type: 'text', text, ...(marks.length ? { marks } : {}) });
const p = (...c: PmNode[]): PmNode => ({ type: 'paragraph', content: c });
const title = (s: string): PmNode => ({ type: 'paragraph', attrs: { isTitle: true }, content: [t(s)] });
const h = (level: number, s: string): PmNode => ({ type: 'heading', attrs: { level }, content: [t(s)] });
const li = (...c: PmNode[]): PmNode => ({ type: 'listItem', content: [p(...c)] });
const img = (n: string, caption?: string): PmNode => ({ type: 'image', attrs: { src: `media://images/${n}.png` }, content: caption ? [p(t(caption))] : [] });
const cols = (...c: PmNode[][]): PmNode => ({ type: 'columnList', content: c.map((x) => ({ type: 'column', content: x })) });
const mermaid = (attrs: Record<string, unknown> = {}): PmNode => ({ type: 'codeBlock', attrs: { language: 'mermaid', ...attrs }, content: [t('flowchart TD\nA-->B')] });
const link = (href: string): Mark => ({ type: 'link', attrs: { href } });

const note: PmNode[] = [
  title('不确定性越来越大的今天,如何确保您无阻碍翻墙?'),
  p(t('昨天那篇《'), t('10月这波 GFW 封锁', link('https://x.com/a/status/1')), t('》很多人看了。')),
  p(t('先说结论:'), t('没有人能保证', { type: 'bold' }, { type: 'underline' }), t('。')),
  h(2, '准备工作(一次搞定)'),
  { type: 'orderedList', content: [li(t('装好 OBox MyCloud')), li(t('准备一个云账号'))] },
  { type: 'bulletList', content: [li(t('AWS', { type: 'bold' }), t('--必须绑定信用卡'))] },
  h(2, '具体的流程如下:'),
  mermaid({ xImage: 'media://images/m.png' }),
  h(2, '第一步:VPS的准备的四种方法'),
  img('ant'),
  { type: 'blockquote', content: [p(t('1、打开自己有的vps的terminal;', { type: 'italic' }))] },
  cols([img('s1', '截图一')], [img('s2', '截图二')]),
  h(2, '额外的教程'),
  p(t('《6分钟搭建自己的住宅IP节点》', link('https://x.com/a/status/2'))),
];

describe('X 文章:note → 步骤', () => {
  const a = articleDraft(note);

  it('标题进标题栏,正文不重复', () => {
    expect(a.title).toBe('不确定性越来越大的今天,如何确保您无阻碍翻墙?');
    expect(JSON.stringify(a.steps)).not.toContain('如何确保您无阻碍翻墙');
  });

  it('顺序和种类:字粘贴 / 小标题单独一步 / 流程图转图 / 图片 / 引用 / 分栏转图', () => {
    expect(a.steps.map((s) => (s.k === 'media' ? `media:${s.m.kind === 'image' ? s.m.fromBlock ?? 'img' : s.m.kind === 'render' ? s.m.what : s.m.kind}` : s.k))).toEqual([
      'html', 'heading', 'html', 'heading', 'media:mermaid', 'heading', 'media:img', 'html', 'media:columns', 'heading', 'html',
    ]);
  });

  it('富文本:链接 / 粗体保留;下划线去掉、说一句', () => {
    const first = a.steps[0];
    expect(first.k).toBe('html');
    if (first.k !== 'html') return;
    expect(first.html).toContain('<a href="https://x.com/a/status/1">10月这波 GFW 封锁</a>');
    expect(first.html).toContain('<strong>没有人能保证</strong>');
    expect(first.html).not.toContain('<u>');
    expect(a.warnings.join()).toContain('下划线');
  });

  it('列表:有序 / 无序各成一个,和小标题后的段落粘在同一步', () => {
    const s = a.steps[2];
    if (s.k !== 'html') throw new Error('第 3 步应是 html');
    expect(s.html).toMatch(/^<ol><li>装好 OBox MyCloud<\/li><li>准备一个云账号<\/li><\/ol><ul><li><strong>AWS<\/strong>--必须绑定信用卡<\/li><\/ul>$/);
  });

  it('小标题:正文里最大一级 → Heading(这篇全是 H2,都是 Heading)', () => {
    expect(a.steps.filter((s) => s.k === 'heading').map((s) => (s.k === 'heading' ? s.level : 0))).toEqual([1, 1, 1, 1]);
    const mixed = articleDraft([title('T'), h(2, '大'), h(3, '小'), p(t('x'))]);
    expect(mixed.steps.filter((s) => s.k === 'heading').map((s) => (s.k === 'heading' ? s.level : 0))).toEqual([1, 2]);
  });

  it('引用:斜体保留,包成 blockquote', () => {
    const s = a.steps[7];
    expect(s.k === 'html' && s.html).toBe('<blockquote><p><em>1、打开自己有的vps的terminal;</em></p></blockquote>');
  });

  it('默认封面:第一张普通图片(不是转成的图)', () => {
    expect(a.coverDefault).toBe('media://images/ant.png');
  });

  it('分栏还没拼好图 → 占位,不能填;拼好了就能填', () => {
    expect(articleProblem(a)).toContain('分栏还没转成图');
    const done = articleDraft(note.map((n) => (n.type === 'columnList' ? { ...n, attrs: { xImage: 'media://images/c.png' } } : n)));
    expect(articleProblem(done)).toBeNull();
  });

  it('公式 / 代码 / 表格走 X 自己的(不转图)', () => {
    const b = articleDraft([
      title('T'),
      { type: 'mathBlock', attrs: { latex: 'E=mc^2' } },
      { type: 'codeBlock', attrs: { language: 'ts' }, content: [t('const a = 1;\n')] },
      { type: 'table', content: [
        { type: 'tableRow', content: [{ type: 'tableHeader', content: [p(t('名'))] }, { type: 'tableHeader', content: [p(t('值|'))] }] },
        { type: 'tableRow', content: [{ type: 'tableCell', content: [p(t('a'))] }, { type: 'tableCell', content: [p(t('1'))] }] },
      ] },
    ]);
    expect(b.steps).toEqual([
      { k: 'latex', latex: 'E=mc^2' },
      { k: 'code', language: 'ts', code: 'const a = 1;' },
      { k: 'table', markdown: '| 名 | 值\\| |\n| --- | --- |\n| a | 1 |', rows: 2, cols: 2 },
    ]);
  });

  it('带行内公式的段落 → 整段转图;引用里有图 → 拆开、说一句', () => {
    const b = articleDraft([title('T'), p(t('能量 '), { type: 'mathInline', attrs: { latex: 'E' } }), { type: 'blockquote', content: [p(t('看图')), img('q')] }]);
    expect(b.steps.map((s) => s.k === 'media' ? `media:${s.m.kind === 'render' ? s.m.what : 'img'}` : s.k)).toEqual(['media:inlineMath', 'html', 'media:img']);
    expect(b.warnings.join()).toContain('不能嵌套');
  });

  it('没标题:说一句;空正文挡住', () => {
    expect(articleDraft([p(t('只有字'))]).warnings.join()).toContain('没有标题');
    expect(articleProblem(articleDraft([title('T')]))).toBe('正文是空的');
  });

  it('composePost 的 X 文章选项带着步骤,fillBlock 用同一个判断', () => {
    const opt = composePost(note).options.find((o) => o.form === 'article')!;
    expect(opt.article?.steps.length).toBe(a.steps.length);
    expect(fillBlock(opt)).toContain('分栏还没转成图');
  });
});
