/**
 * note → 推文 排版(发推第①期,2026-10-27)—— 设计 docs/10-business-design/x/x-posting-design.md §3
 *
 * 钉三件事:每种块转成什么样 / 建议哪种发法 / 推串在哪断。
 */
import { describe, it, expect } from 'vitest';
import { composePost, type PmNode } from '../../src/modules/x/x-post-compose';

const t = (text: string, marks?: PmNode['marks']): PmNode => ({ type: 'text', text, marks });
const p = (...c: (string | PmNode)[]): PmNode => ({ type: 'paragraph', content: c.map((x) => (typeof x === 'string' ? t(x) : x)) });
const title = (s: string): PmNode => ({ type: 'paragraph', attrs: { isTitle: true }, content: [t(s)] });
const h = (s: string, level = 2): PmNode => ({ type: 'heading', attrs: { level }, content: [t(s)] });
const li = (s: string, indent = 0): PmNode => ({ type: 'listItem', attrs: { indent }, content: [p(s)] });
const img = (src: string, alt = ''): PmNode => ({ type: 'image', attrs: { src, alt } });
const hr: PmNode = { type: 'horizontalRule' };

const single = (nodes: PmNode[]) => composePost(nodes).options.find((o) => o.form === 'single')!.posts[0];
const thread = (nodes: PmNode[]) => composePost(nodes).options.find((o) => o.form === 'thread')!.posts;

describe('每种块转成什么样', () => {
  it('段落之间空一行;粗体 / 斜体 / 行内代码去标记留字', () => {
    const r = single([p(t('重要', [{ type: 'bold' }]), '的', t('事', [{ type: 'italic' }])), p(t('x=1', [{ type: 'code' }]))]);
    expect(r.text).toBe('重要的事\n\nx=1');
  });
  it('标题 / 小标题单独一行', () => {
    expect(single([title('论文笔记'), h('第一节'), p('正文')]).text).toBe('论文笔记\n\n第一节\n\n正文');
  });
  it('无序列表 • ,有序列表从 start 起编号,列表项之间不空行;缩进两格', () => {
    const r = single([
      { type: 'bulletList', content: [li('甲'), li('乙', 1)] },
      { type: 'orderedList', attrs: { start: 3 }, content: [li('丙'), li('丁')] },
    ]);
    expect(r.text).toBe('• 甲\n  • 乙\n\n3. 丙\n4. 丁');
  });
  it('待办 ☐ / ☑', () => {
    const r = single([{ type: 'taskList', content: [
      { type: 'taskItem', attrs: { checked: true }, content: [p('买书')] },
      { type: 'taskItem', attrs: { checked: false }, content: [p('读书')] },
    ] }]);
    expect(r.text).toBe('☑ 买书\n☐ 读书');
  });
  it('引用用「」包起来(多段包整体)', () => {
    expect(single([{ type: 'blockquote', content: [p('一句金句'), p('第二行')] }]).text).toBe('「一句金句\n第二行」');
  });
  it('链接:文字 + 空格 + 网址;文字就是网址时只留一份', () => {
    const link = (href: string) => [{ type: 'link', attrs: { href } }];
    expect(single([p('看', t('这篇', link('https://a.com/x')), '吧')]).text).toBe('看这篇 https://a.com/x 吧');
    expect(single([p(t('https://a.com', link('https://a.com')))]).text).toBe('https://a.com');
  });
  it('链接文字被粗体切成两段也只出一次网址', () => {
    const link = { type: 'link', attrs: { href: 'https://a.com' } };
    expect(single([p(t('这', [link, { type: 'bold' }]), t('篇', [link]))]).text).toBe('这篇 https://a.com');
  });
  it('换行 / note 链接 / 行内公式', () => {
    const r = composePost([p('a', { type: 'hardBreak' }, 'b', { type: 'noteLink', attrs: { label: '另一篇' } }, { type: 'mathInline', attrs: { latex: 'x^2' } })]);
    expect(r.options[0].posts[0].text).toBe('a\nb另一篇$x^2$');
    expect(r.warnings.join()).toContain('行内公式');
  });
  it('图片进附图,alt 取 alt 或图片说明', () => {
    const r = single([p('看图'), img('media://a.png', '猫'), { type: 'image', attrs: { src: 'media://b.png' }, content: [p('狗')] }]);
    expect(r.text).toBe('看图');
    expect(r.media).toEqual([{ kind: 'image', src: 'media://a.png', alt: '猫' }, { kind: 'image', src: 'media://b.png', alt: '狗' }]);
  });
  it('公式 / 代码 / Mermaid / 表格 转成图(正文不留源码),并提示', () => {
    const r = composePost([
      p('公式如下'),
      { type: 'mathBlock', attrs: { latex: 'E=mc^2' } },
      { type: 'codeBlock', attrs: { language: 'ts' }, content: [t('let a = 1')] },
      { type: 'codeBlock', attrs: { language: 'mermaid' }, content: [t('graph TD')] },
      { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [p('A')] }] }] },
    ]);
    const post = r.options[0].posts[0];
    expect(post.text).toBe('公式如下');
    expect(post.media.map((m) => (m.kind === 'render' ? m.what : m.kind))).toEqual(['math', 'code', 'mermaid', 'table']);
    expect(r.warnings.join()).toContain('转成图');
  });
  it('分隔线不出字', () => expect(single([p('a'), hr, p('b')]).text).toBe('a\n\nb'));
  it('提示框:图标 + 正文', () => {
    expect(single([{ type: 'callout', attrs: { emoji: '💡' }, content: [p('记住')] }]).text).toBe('💡 记住');
  });
  it('推文块 → 推文链接(X 会显示成引用卡片)', () => {
    expect(single([{ type: 'tweetBlock', attrs: { tweetUrl: 'https://x.com/a/status/1' }, content: [p('')] }]).text).toBe('https://x.com/a/status/1');
  });
  it('音频 / 文件 X 发不了:略过并提示,不静默', () => {
    const r = composePost([p('a'), { type: 'audioBlock', attrs: { src: 'media://a.mp3' } }, { type: 'fileBlock', attrs: { filename: 'x.pdf' } }]);
    expect(r.options[0].posts[0].text).toBe('a');
    expect(r.warnings.join()).toMatch(/音频.*文件|文件.*音频/);
  });
  it('认不出的块:有字就留字,并提示', () => {
    const r = composePost([{ type: 'weirdBlock', content: [t('留下')] }]);
    expect(r.options[0].posts[0].text).toBe('留下');
    expect(r.warnings.join()).toContain('weirdBlock');
  });
  it('空段落不产生多余空行', () => expect(single([p('a'), p(), p('b')]).text).toBe('a\n\nb'));
});

describe('建议哪种发法', () => {
  it('空内容:empty', () => expect(composePost([p(), p('  ')]).empty).toBe(true));
  it('280 以内只有文字 → 单条推', () => {
    const r = composePost([p('今天读了一篇论文')]);
    expect(r.suggested).toBe('single');
    expect(r.weight).toBe(16);
  });
  it('超 280、几段文字 → 推串', () => {
    const r = composePost([p('字'.repeat(100)), p('字'.repeat(100))]);
    expect(r.suggested).toBe('thread');
    expect(r.options.find((o) => o.form === 'single')!.available).toBe(false);
  });
  it('超 280 且有两个以上小标题 → X 文章', () => {
    const r = composePost([h('一'), p('字'.repeat(100)), h('二'), p('字'.repeat(100))]);
    expect(r.suggested).toBe('article');
  });
  it('超 280 且有表格 → X 文章', () => {
    const r = composePost([p('字'.repeat(150)), { type: 'table', content: [] }]);
    expect(r.suggested).toBe('article');
  });
  it('短,但有公式 → 单条推 + 转图附上', () => {
    const r = composePost([p('公式'), { type: 'mathBlock', attrs: { latex: 'a' } }]);
    expect(r.suggested).toBe('single');
    expect(r.reason).toContain('转成图');
  });
  it('图超过 4 张:单条推不可用', () => {
    const r = composePost([p('图'), ...[1, 2, 3, 4, 5].map((i) => img(`media://${i}.png`))]);
    expect(r.options.find((o) => o.form === 'single')!.available).toBe(false);
    expect(r.suggested).toBe('thread');
  });
  it('五种发法都列出来;「整段转图」这期还不能用并写明原因', () => {
    const r = composePost([p('a')]);
    expect(r.options.map((o) => o.form)).toEqual(['single', 'thread', 'longPost', 'article', 'image']);
    const img2 = r.options.find((o) => o.form === 'image')!;
    expect(img2.available).toBe(false);
    expect(img2.why).toBeTruthy();
  });
  it('长推写明要 Premium', () => {
    expect(composePost([p('a')]).options.find((o) => o.form === 'longPost')!.note).toContain('Premium');
  });
  it('X 文章:标题单拿出来', () => {
    const r = composePost([title('论文笔记'), p('正文')]);
    expect(r.title).toBe('论文笔记');
    expect(r.options.find((o) => o.form === 'article')!.posts[0].text).toBe('正文');
  });
});

describe('推串在哪断', () => {
  it('每条 ≤ 280,末尾标 i/N', () => {
    const posts = thread([p('甲'.repeat(100)), p('乙'.repeat(100)), p('丙'.repeat(100))]);
    expect(posts).toHaveLength(3);
    posts.forEach((x, i) => {
      expect(x.weight).toBeLessThanOrEqual(280);
      expect(x.text.endsWith(`${i + 1}/3`)).toBe(true);
    });
    expect(posts[0].text.startsWith('甲')).toBe(true);
  });
  it('放得下就合在一条里(不是一段一条)', () => {
    expect(thread([p('短一'), p('短二'), p('字'.repeat(135))])).toHaveLength(2);
  });
  it('分隔线强制断开', () => {
    const posts = thread([p('a'), hr, p('b')]);
    expect(posts.map((x) => x.text)).toEqual(['a\n\n1/2', 'b\n\n2/2']);
  });
  it('小标题开新的一条', () => {
    const posts = thread([p('前言'), h('第一节'), p('正文')]);
    expect(posts[1].text.startsWith('第一节')).toBe(true);
  });
  it('一段太长按句号断,不在句子中间断', () => {
    const sentence = '这'.repeat(60) + '。';
    const posts = thread([p(sentence.repeat(4))]);
    expect(posts.length).toBe(2);
    posts.forEach((x) => expect(x.text.replace(/\n\n\d+\/\d+$/, '').endsWith('。')).toBe(true));
  });
  it('一句话本身超长:只能硬断,并提示', () => {
    /** 300 个汉字 = 600 加权;每条最多 273(留 7 给「\n\n1/3」)→ 3 条 */
    const r = composePost([p('长'.repeat(300))]);
    const posts = r.options.find((o) => o.form === 'thread')!.posts;
    expect(posts.length).toBe(3);
    posts.forEach((x) => expect(x.weight).toBeLessThanOrEqual(280));
    expect(r.warnings.join()).toContain('句中');
  });
  it('图跟着它前面那段走;一条满 4 张就开下一条', () => {
    const posts = thread([p('第一段'), img('media://1.png'), hr, p('第二段'), ...[2, 3, 4, 5, 6].map((i) => img(`media://${i}.png`))]);
    expect(posts[0].media.map((m) => (m as { src: string }).src)).toEqual(['media://1.png']);
    expect(posts[1].media).toHaveLength(4);
    expect(posts[2].media.map((m) => (m as { src: string }).src)).toEqual(['media://6.png']);
  });
});
