/**
 * note → 推文 排版(发推第①期,2026-10-27)—— 设计 docs/10-business-design/x/x-posting-design.md §3
 *
 * 钉三件事:每种块转成什么样 / 建议哪种发法 / 推串在哪断。
 */
import { describe, it, expect } from 'vitest';
import { composePost, fillBlock, fillProblem, imageSections, needsImage, type PmNode } from '../../src/modules/x/x-post-compose';

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
  it('换行 / note 链接', () => {
    const r = composePost([p('a', { type: 'hardBreak' }, 'b', { type: 'noteLink', attrs: { label: '另一篇' } })]);
    expect(r.options[0].posts[0].text).toBe('a\nb另一篇');
  });
  it('⭐ 带行内公式的段落整段转成图(用户 10-28 选),正文不留这段字;列表里的行内公式仍按源码并提示', () => {
    const math = { type: 'mathInline', attrs: { latex: 'x^2' } };
    const r = single([p('前言'), p('能量 ', math, ' 守恒')]);
    expect(r.text).toBe('前言');
    expect(r.media).toMatchObject([{ kind: 'render', what: 'inlineMath' }]);
    const li = composePost([{ type: 'bulletList', content: [{ type: 'listItem', content: [p('项 ', math)] }] }]);
    expect(li.options[0].posts[0].text).toContain('$x^2$');
    expect(li.warnings.join()).toContain('行内公式');
  });
  it('图片进附图,alt 取 alt 或图片说明', () => {
    const r = single([p('看图'), img('media://a.png', '猫'), { type: 'image', attrs: { src: 'media://b.png' }, content: [p('狗')] }]);
    expect(r.text).toBe('看图');
    expect(r.media).toEqual([{ kind: 'image', src: 'media://a.png', alt: '猫' }, { kind: 'image', src: 'media://b.png', alt: '狗' }]);
  });
  it('公式 / 长代码 / Mermaid / 表格 / SVG 图转成图(正文不留源码);短代码发字', () => {
    const r = composePost([
      p('公式如下'),
      { type: 'mathBlock', attrs: { latex: 'E=mc^2' } },
      { type: 'codeBlock', attrs: { language: 'ts' }, content: [t('let a = 1')] },
      { type: 'codeBlock', attrs: { language: 'ts' }, content: [t('a\nb\nc\nd')] },
      { type: 'codeBlock', attrs: { language: 'mermaid' }, content: [t('graph TD')] },
      { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [p('A')] }] }] },
      img('media://images/x.svg'),
    ]);
    const post = r.options[0].posts[0];
    expect(post.text).toBe('公式如下\n\nlet a = 1');
    expect(post.media.map((m) => (m.kind === 'render' ? m.what : m.kind))).toEqual(['math', 'code', 'mermaid', 'table', 'svg']);
  });
  it('⭐ 短代码界线:3 行以内且 80 字以内发字,多一点就转图', () => {
    const code = (s: string) => ({ type: 'codeBlock', attrs: { language: 'sh' }, content: [t(s)] });
    expect(needsImage(code('a\nb\nc'))).toBeNull();
    expect(needsImage(code('a\nb\nc\nd'))).toBe('code');
    expect(needsImage(code('x'.repeat(80)))).toBeNull();
    expect(needsImage(code('x'.repeat(81)))).toBe('code');
  });
  it('⭐ 转好的(attrs.xImage)当一张图附上;转不出来的(xImageError)挡住并说原因', () => {
    const ok = single([p('看'), { type: 'mathBlock', attrs: { latex: 'E', xImage: 'media://images/r1.png' } }]);
    expect(ok.media).toEqual([{ kind: 'image', src: 'media://images/r1.png', alt: '公式(转成的图)', fromBlock: 'math' }]);
    expect(fillProblem(ok.media)).toBeNull();
    const bad = composePost([p('看'), { type: 'table', attrs: { xImageError: '表格是空的' }, content: [] }]);
    const m = bad.options[0].posts[0].media;
    expect(fillProblem(m)).toBe('表格没转成图:表格是空的');
    expect(bad.warnings.join()).toContain('表格没转成图');
  });
  it('⭐ 10-29 一图一条:转成的图各占一条,前面挨着的字跟它一条;多于 1 张单条推不能发', () => {
    const shot = (type: string, n: number, extra: Record<string, unknown> = {}, content?: PmNode[]): PmNode =>
      ({ type, attrs: { ...extra, xImage: `media://images/s${n}.png` }, content });
    const doc: PmNode[] = [
      p('质能方程如下:'), shot('mathBlock', 1, { latex: 'E=mc^2' }),
      p('能量 ', { type: 'mathInline', attrs: { latex: 'E' } }, ' 守恒'),
      p('安装:'), { type: 'codeBlock', attrs: { language: 'sh' }, content: [t('npm install krig')] },
      shot('codeBlock', 2, { language: 'ts' }, [t('a\nb\nc\nd')]),
      shot('codeBlock', 3, { language: 'mermaid' }, [t('graph TD')]),
      img('media://images/cat.png'), p('完'),
    ];
    const posts = thread(doc);
    expect(posts.map((x) => [x.text.replace(/ ?\d+\/\d+$/, ''), x.media.length])).toEqual([
      ['质能方程如下:', 1],
      ['', 1],
      ['安装:\n\nnpm install krig', 1],
      ['', 1],
      ['完', 1],
    ]);
    const r = composePost(doc);
    expect(r.options.find((o) => o.form === 'single')!.why).toContain('一图一条');
    expect(r.suggested).toBe('thread');
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
  it('五种发法都列出来;没有要转图的块时「整篇转图」不给并写明原因', () => {
    const r = composePost([p('a')]);
    expect(r.options.map((o) => o.form)).toEqual(['single', 'thread', 'longPost', 'article', 'image']);
    const img2 = r.options.find((o) => o.form === 'image')!;
    expect(img2.available).toBe(false);
    expect(img2.why).toContain('不到 2 个');
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
    expect(posts.map((x) => x.text)).toEqual(['a 1/2', 'b 2/2']);
  });
  it('小标题那节塞得进这条就接着写,不硬开新条', () => {
    expect(thread([p('前言'), h('第一节'), p('正文')])).toHaveLength(1);
  });
  it('小标题那节塞不下 → 小标题带着正文开新的一条(不落在上一条末尾)', () => {
    const posts = thread([p('甲'.repeat(100)), h('第一节'), p('乙'.repeat(60))]);
    expect(posts).toHaveLength(2);
    expect(posts[1].text.startsWith('第一节')).toBe(true);
  });
  it('⭐ 10-28 真机:299 字带 5 个小标题,排 2 条不是 6 条', () => {
    const doc = [
      h('格式测试:VPS 入门', 1),
      h('什么是 VPS'), p('VPS 是一台租来的服务器,按月付费,便宜但要自己维护。详见 https://x.com/antsBTW'),
      h('优点'), p('• 价格低'), p('• 可以装任何软件'), p('• 有独立 IP'),
      h('上手步骤'), p('1. 选服务商'), p('2. 装系统'), p('3. 配防火墙'),
      h('今天的进度'), p('☑ 买好服务器'), p('☐ 装好代理'),
      p('「先能用,再求快。」'), p('有问题欢迎留言 @antsBTW #VPS 🚀'),
    ];
    const r = composePost(doc);
    expect(r.weight).toBeGreaterThan(280);
    expect(thread(doc)).toHaveLength(2);
  });
  it('一段太长按句号断,不在句子中间断', () => {
    const sentence = '这'.repeat(60) + '。';
    const posts = thread([p(sentence.repeat(4))]);
    expect(posts.length).toBe(2);
    posts.forEach((x) => expect(x.text.replace(/ ?\d+\/\d+$/, '').endsWith('。')).toBe(true));
  });
  it('一句话本身超长:只能硬断,并提示', () => {
    /** 300 个汉字 = 600 加权;每条最多 274(留 6 给「 1/3」)→ 3 条 */
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

describe('推串:能不能填进 X(10-28)', () => {
  it('⭐ 一句话 + 6 张图 → 2 条(4 + 2);页码跟在正文后同一行(用户 10-28 选的);只有图的那条正文就是「2/2」', () => {
    const posts = thread([p('什么是VPS?'), ...[1, 2, 3, 4, 5, 6].map((n) => img(`media://images/${n}.png`))]);
    expect(posts.map((x) => x.media.length)).toEqual([4, 2]);
    expect(posts.map((x) => x.text)).toEqual(['什么是VPS? 1/2', '2/2']);
  });
  it('⭐ fillBlock:推串现在能填;某条要转图 → 说是第几条;长推还不能填', async () => {
    const { fillBlock } = await import('../../src/modules/x/x-post-compose');
    const opt = (nodes: PmNode[], form: string) => composePost(nodes).options.find((o) => o.form === form)!;
    expect(fillBlock(opt([p('甲'.repeat(200)), p('乙'.repeat(200))], 'thread'))).toBeNull();
    expect(fillBlock(opt([p('甲'.repeat(100)), hr, p('乙'), { type: 'mathBlock', content: [t('E=mc^2')] }], 'thread'))).toContain('第 2 条');
    expect(fillBlock(opt([p('短')], 'longPost'))).toContain('第⑤期');
  });
});

describe('⭐ 10-29 整篇转图 + 分条', () => {
  const math = (latex: string, attrs: Record<string, unknown> = {}): PmNode => ({ type: 'mathBlock', attrs: { latex, ...attrs } });
  const opt = (nodes: PmNode[]) => composePost(nodes).options.find((o) => o.form === 'image')!;

  it('只有 1 个要转图的块:不给这个选项', () => {
    expect(opt([p('a'), math('x')]).available).toBe(false);
  });
  it('按小标题 / 分隔线切节,一节一条;正文是这节开头;还没画好就是占位、不能填', () => {
    const o = opt([p('开头一段'), math('a'), h('第二节'), p('说明'), math('b'), hr, p('收尾')]);
    expect(o.available).toBe(true);
    expect(o.posts.map((x) => x.text)).toEqual(['开头一段 1/3', '第二节 2/3', '收尾 3/3']);
    expect(o.posts.every((x) => x.media.length === 1 && x.media[0].kind === 'render')).toBe(true);
    expect(fillBlock(o)).toContain('还没转成图');
  });
  it('每节第一个块标了 xSectionImage → 那条带这张图,能填;标了 xSectionImageError → 原因给人看', () => {
    const ok = opt([p('甲', ), math('a'), h('乙'), math('b')].map((n, i) => (i === 0 || i === 2 ? { ...n, attrs: { ...(n.attrs ?? {}), xSectionImage: `media://images/s${i}.png` } } : n)));
    expect(ok.posts.map((x) => x.media[0])).toEqual([
      { kind: 'image', src: 'media://images/s0.png', alt: '甲', fromBlock: 'section' },
      { kind: 'image', src: 'media://images/s2.png', alt: '乙', fromBlock: 'section' },
    ]);
    expect(fillBlock(ok)).toBeNull();
    const bad = opt([{ ...p('甲'), attrs: { xSectionImageError: '画坏了' } }, math('a'), math('b')]);
    expect(fillBlock(bad)).toContain('画坏了');
  });
  it('一节字太多 / 块太多也切;开头太长截断', () => {
    const long = '长'.repeat(200);
    const o = opt([p(long), p(long), math('a'), math('b')]);
    expect(o.posts.length).toBe(2);
    expect(o.posts[0].text).toBe(`${'长'.repeat(60)}… 1/2`);
    expect(imageSections(Array.from({ length: 10 }, () => p('x')))).toEqual([[0, 1, 2, 3, 4, 5, 6, 7], [8, 9]]);
  });
});
