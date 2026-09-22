/**
 * ⭐⭐⭐ 「像人一样把页面读完」—— 用户 2026-09-22 定的采集形态。
 *
 * > 「不管长文短文,如果折叠起来就应该 show all,然后获取完整的内容,就像人一样,
 * >   但是现在却是分的零碎,却无法获取完整的内容。」
 *
 * ── 此前的病:载荷优先、DOM 缺席 ──
 * ① 折叠的推只渲染开头 → 读到截断版,而且不知道
 * ② **页面已加载就没有载荷可截** —— 实测同一 URL 采到 0 条:
 *    前两趟 10 个载荷(新导航触发),第三趟只有 2 个杂项载荷,
 *    而页面上 4 篇长文卡片明明摆在那儿
 *
 * ⭐ 现在:每轮滚动后**先点开 Show more,再从 DOM 读**,与载荷合并。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mergeDomTweets } from '../../src/platform/main/x/x-timeline-harvester';
import type { HarvestedTweet } from '../../src/platform/main/x/x-timeline-harvester';

const mk = (o: Partial<HarvestedTweet>): HarvestedTweet => ({
  tweetId: 't1', authorHandle: 'a', text: '', metrics: {}, self: {},
  hasMedia: false, isLongText: false, isArticle: false, ...o,
} as HarvestedTweet);

describe('⭐⭐ 合并:text 只许变长(这条防的是真实发生过的数据损坏)', () => {
  it('⚠️⚠️ DOM 摘要**绝不许**盖掉载荷里的长文正文', () => {
    /**
     * ⚠️ 2026-09-22 实测事故:重采把 16081 字正文覆盖成 267 字。
     * DOM 路径同样有这个风险 —— 列表页卡片上只显示标题+摘要。
     */
    const out = new Map([['t1', mk({ text: '正文'.repeat(4000) })]]);
    mergeDomTweets([{ tweetId: 't1', text: '标题 + 一小段摘要' }], out);
    expect(out.get('t1')!.text.length,
      'DOM 摘要盖掉了载荷的长文正文 —— 这正是 16081→267 那次事故的形态')
      .toBe(8000);
  });

  it('⭐⭐ 展开后的全文**要**顶掉载荷的截断版', () => {
    const out = new Map([['t1', mk({ text: '这是开头…' })]]);
    mergeDomTweets([{ tweetId: 't1', text: '这是开头,后面还有很长的正文'.repeat(20) }], out);
    expect(out.get('t1')!.text.length,
      '展开后的全文没顶掉截断版 —— 点开了等于白点')
      .toBeGreaterThan(100);
  });

  it('⭐ 新条目直接进表(页面已加载、没载荷可截时,这是唯一来源)', () => {
    const out = new Map<string, HarvestedTweet>();
    mergeDomTweets([{ tweetId: 't9', authorHandle: 'bob', text: 'hi' }], out);
    expect(out.size, 'DOM 读到的新推没进表 —— 「页面上有但采到 0 条」就是这么来的').toBe(1);
    expect(out.get('t9')!.fromDom, '没标 fromDom —— 下游会误信它的 has_media').toBe(true);
  });

  it('⚠️ 空值不许覆盖非空', () => {
    const out = new Map([['t1', mk({ tweetUrl: 'https://x.com/a/status/1', lang: 'zh' })]]);
    mergeDomTweets([{ tweetId: 't1', tweetUrl: '', lang: '' }], out);
    expect(out.get('t1')!.tweetUrl, '空值覆盖了非空 —— 一趟浅采抹掉已采全的字段')
      .toBe('https://x.com/a/status/1');
    expect(out.get('t1')!.lang).toBe('zh');
  });

  it('⭐ 载荷缺的字段由 DOM 补上', () => {
    const out = new Map([['t1', mk({ text: 'x' })]]);
    mergeDomTweets([{ tweetId: 't1', tweetUrl: 'https://x.com/a/status/1' }], out);
    expect(out.get('t1')!.tweetUrl, 'DOM 有而载荷没有的字段没补上')
      .toBe('https://x.com/a/status/1');
  });

  it('⚠️ 已有条目不许被改成 fromDom(它决定 has_media 可不可信)', () => {
    const out = new Map([['t1', mk({ text: 'x', fromDom: undefined })]]);
    mergeDomTweets([{ tweetId: 't1', text: 'xy' }], out);
    expect(out.get('t1')!.fromDom,
      '载荷来源的条目被标成 fromDom —— 下游会当成「has_media 不可信」而丢掉')
      .toBeUndefined();
  });

  it('⚠️ 没有 tweetId 的一律丢掉,不许造出空壳行', () => {
    const out = new Map<string, HarvestedTweet>();
    mergeDomTweets([{ text: '没有 id' }, { tweetId: '', text: 'x' }], out);
    expect(out.size, '造出了没有 id 的行 —— 会污染库').toBe(0);
  });
});

describe('⚠️ 接线:展开必须真的发生,且顺序不能反', () => {
  const strip = (s: string) =>
    s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  const harvester = strip(readFileSync(
    join(process.cwd(), 'src/platform/main/x/x-timeline-harvester.ts'), 'utf-8'));
  const script = strip(readFileSync(
    join(process.cwd(), 'src/platform/main/tweet-fetcher/extract-script.ts'), 'utf-8'));

  it('⭐⭐ 共享脚本里要有 expandTweetText', () => {
    expect(script, '没有展开函数 —— 折叠的推永远只拿到开头')
      .toMatch(/function expandTweetText/);
    /** ⚠️ 必须认 X 的正式按钮,不能只靠文案(文案会随语言变) */
    expect(script, '没认 X 的正式展开按钮 testid')
      .toMatch(/tweet-text-show-more-link/);
  });

  it('⚠️⚠️ 兜底匹配绝不能点到 a 标签(那是外链,会导航走)', () => {
    const i = script.indexOf('function expandTweetText');
    const seg = script.slice(i, i + 1600);
    expect(seg.length, '切出来是空的').toBeGreaterThan(200);
    expect(seg, '兜底没排除 a 标签 —— 点到外链会离开页面,整趟采集报废')
      .toMatch(/tagName === 'A'|closest\('a'\)/);
  });

  it('⭐⭐ 采集循环里要真的调展开 + 读 DOM', () => {
    expect(harvester, '采集没调展开 —— 等于没做')
      .toMatch(/expandTweetText\(art\)/);
    expect(harvester, '读了 DOM 却没合并进累计表')
      .toMatch(/mergeDomTweets\(/);
  });

  it('⚠️⚠️ 顺序:先展开,后读文本', () => {
    /** ⚠️ 顺序反了就还是读到截断版,而且现象一模一样(看不出来) */
    const i = harvester.indexOf('expandTweetText(art)');
    const j = harvester.indexOf('scrapeTweetArticle(art)', i > 0 ? i : 0);
    expect(i, '找不到展开调用').toBeGreaterThan(0);
    expect(j, '找不到读取调用').toBeGreaterThan(0);
    expect(i < j, '先读后展开 —— 读到的还是截断版,而且看不出来').toBe(true);
  });

  it('⚠️ DOM 读出来的文本不许再截断', () => {
    /**
     * ⚠️⚠️ 锚点必须是 **DOM 读取那段脚本**,不是 `mergeDomTweets(` ——
     * 后者第一处出现是**函数定义**(在文件前部),切出来的是 import 区,
     * 注入真违规时纹丝不动(2026-09-22 实测:这条守卫连着假绿两次)。
     * ⭐ 用 `scrapeTweetArticle(art)` 当锚:它只在 DOM 读取脚本里出现。
     */
    const i = harvester.indexOf('scrapeTweetArticle(art)');
    expect(i, '找不到 DOM 读取脚本').toBeGreaterThan(0);
    const blk = harvester.slice(i, i + 1200);
    /**
     * ⚠️ 2026-09-22 这条守卫**自己假绿过一次**:原来写
     * `/text:\s*\(?d\.text[^,]*slice\(0,\s*280\)/`,而实际写法是
     * `(d.text || '').slice(0, 280)` —— `[^,]*` 跨不过 `slice(0, 280)` 里的逗号,
     * 注入真违规时纹丝不动。
     * ⭐ 改成:**这一段里根本不许出现对 text 的 slice 截断**。
     */
    expect(blk, '切出来是空的').toBeTruthy();
    expect(blk.includes('slice(0, 280)') || blk.includes('slice(0,280)'),
      'DOM 文本被截到 280 字 —— 展开了也白展开(x-capture-monitor 就是这么丢正文的)')
      .toBe(false);
  });

  it('⭐ 展开了几条要报出来(0 有两义:没折叠 vs 按钮没找到)', () => {
    expect(harvester, '展开数没进报告').toMatch(/domExpanded/);
  });
});
