/**
 * ⭐⭐ **打包送 Claude / 解析回来** —— 流水线第 ④ 步(用户 2026-09-26)。
 *
 * ⚠️ 这一层刻意做成**纯函数**:prompt 格式是学习环节的主战场,
 * 改 prompt 比训练模型快得多 —— 放在能力层里改一次要连 webview 一起跑,没法迭代。
 *
 * ⚠️⚠️ 解析器是**最危险的一环**:Claude 改了排版若静默返回空数组,
 * 现象是「点了没反应」—— 本仓最贵的一类 bug。所以 fail loud 要钉死。
 */
import { describe, it, expect } from 'vitest';
import {
  buildAdvicePrompt, parseAdviceResponse, type AdviceItem,
} from '@shared/types/x-claude-advice';
import { PRODUCT_FACTS, MAX_REPLY_CHARS, verifyGeneratedReply } from '@shared/types/x-reply-facts';

const LINK = 'https://otun.example/trial?ref=abc&lang=zh&v=6';

const item = (over: Partial<AdviceItem> = {}): AdviceItem => ({
  tweetId: '1234567890123456789',
  authorHandle: 'someone',
  text: '求推荐能在中国用的VPN，试了三个都连不上',
  lang: 'zh',
  ...over,
});

describe('⭐⭐ 打包:语境要全部进 prompt', () => {
  it('⭐⭐ bio / 粉丝 / 上文 / 正文 都进去了', () => {
    const p = buildAdvicePrompt([item({
      bio: 'ZZ我的简介',
      followersCount: 42,
      followingCount: 999,
      context: [
        { text: 'ZZ楼上第一条', authorHandle: 'aa' },
        { text: 'ZZ楼上第二条', authorHandle: 'bb' },
      ],
      aiReason: 'ZZ前一步的理由',
    })], { link: LINK });
    for (const must of ['ZZ我的简介', '42', '999', 'ZZ楼上第一条', 'ZZ楼上第二条',
      'ZZ前一步的理由', '求推荐能在中国用的VPN']) {
      expect(p, `「${must}」没进 prompt —— 模型看不到这份语境`).toContain(must);
    }
  });

  it('⭐⭐ 上文三态要分得开(有/本来没有/没抓到)', () => {
    /**
     * ⚠️ 合成一种的话,模型分不清「这楼没上文」和「我们没抓到」——
     * 后者该让它更保守,前者不该。
     */
    const withCtx = buildAdvicePrompt([item({ context: [{ text: 'ZZ上文' }] })], { link: LINK });
    const missing = buildAdvicePrompt([item({ contextMissing: true })], { link: LINK });
    const standalone = buildAdvicePrompt([item()], { link: LINK });

    expect(withCtx).toContain('ZZ上文');
    expect(missing, '没说清是「没抓到」').toMatch(/上文没抓到/);
    expect(standalone, '没说清是「本来就没有上文」').toMatch(/独立推文/);
    expect(
      standalone,
      '独立推被说成了「没抓到」—— 模型会平白变保守',
    ).not.toMatch(/没抓到/);
  });

  it('⚠️ 没采到的资料要**明说没采到**,不能留空', () => {
    /** 留空 → 模型当成「这人没写简介」,而实际是「我们没采到」 */
    const p = buildAdvicePrompt([item()], { link: LINK });
    expect(p, 'bio 没采到却留了空 —— 模型会误当成「简介是空的」').toMatch(/简介：（未采到）/);
    expect(p, '账号资料没采到却留了空').toMatch(/账号：（未采到）/);
  });

  it('⭐⭐ 事实清单与 Gemma 那套**同源**(改口径两边一起变)', () => {
    const custom = { ...PRODUCT_FACTS, productName: 'ZZ产品', trial: 'ZZ试用14天' };
    const p = buildAdvicePrompt([item()], { link: LINK, facts: custom });
    expect(p, '没用传进来的口径 —— 面板改了对 Claude 这条路无效').toContain('ZZ产品');
    expect(p).toContain('ZZ试用14天');
    expect(p, '默认产品名还在 —— 有写死的残留').not.toContain(PRODUCT_FACTS.productName);
  });

  it('⭐ forbidden 逐条进 prompt(显式列出比「不要瞎说」有效得多)', () => {
    const p = buildAdvicePrompt([item()], { link: LINK });
    for (const f of PRODUCT_FACTS.forbidden) {
      expect(p, `禁止项「${f}」没进 prompt`).toContain(f);
    }
  });

  it('⭐ 链接必须原样出现且要求逐字照抄', () => {
    const p = buildAdvicePrompt([item()], { link: LINK });
    expect(p, '链接没进 prompt —— 模型会自己编一个').toContain(LINK);
    expect(p, '没要求逐字照抄 —— 改了 ref 就永远归不了因').toMatch(/原样照抄/);
  });

  it('⚠️ 字数上限与发推校验同一个数,不各写各的', () => {
    const p = buildAdvicePrompt([item()], { link: LINK, maxChars: MAX_REPLY_CHARS });
    expect(p).toContain(String(MAX_REPLY_CHARS));
  });

  it('⭐ 整批一次发:每条都编号,便于模型横向比较', () => {
    const p = buildAdvicePrompt([item({ tweetId: '111111111111' }),
      item({ tweetId: '222222222222', authorHandle: 'bbb' })], { link: LINK });
    expect(p).toMatch(/### 1\./);
    expect(p).toMatch(/### 2\./);
    expect(p, '没要求横向比较 —— 那正是整批发的唯一好处').toMatch(/优先回/);
  });
});

describe('⭐⭐ 解析:宽进严出', () => {
  const GOOD = `
[1] id=1234567890123456789 建议=回复 把握=高
理由：他明确在找能用的工具
正文：试试这个吧，注册送 7 天流量 ${LINK}

[2] id=9876543210987654321 建议=不回 把握=中
理由：这楼在聊游戏，不相关
正文：—

这批里第 1 条最值得优先回，他问得很具体。
`;

  it('⭐⭐ 正常格式全解出来', () => {
    const r = parseAdviceResponse(GOOD);
    expect(r.advices, '没解出两条').toHaveLength(2);
    expect(r.advices[0].tweetId).toBe('1234567890123456789');
    expect(r.advices[0].shouldReply).toBe(true);
    expect(r.advices[0].confidence).toBe('high');
    expect(r.advices[0].text, '正文没解出来').toContain(LINK);
    expect(r.advices[1].shouldReply).toBe(false);
    expect(r.advices[1].text, '建议不回时正文该是空串').toBe('');
  });

  it('⭐ 排版飘了也要吃下来(代码块包裹 / 全角冒号)', () => {
    const messy = '```\n[1] id：1234567890123456789 建议：回复 把握：低\n'
      + '理由：测试\n正文：随手回一句 ' + LINK + '\n```';
    const r = parseAdviceResponse(messy);
    expect(r.advices, '全角冒号/代码块包裹就解不出来了').toHaveLength(1);
    expect(r.advices[0].confidence).toBe('low');
  });

  it('⭐⭐ 解析不出来要**留痕**,不能静默返回空', () => {
    /**
     * ⚠️ 这是本文件最要紧的一条:Claude 改了格式若静默返回空数组,
     * 现象是「点了没反应」—— 本仓最贵的一类 bug。
     */
    const r = parseAdviceResponse('我觉得这几条都可以回复，你看着办吧。');
    expect(r.advices, '这段根本不是建议格式，却解出了东西').toHaveLength(0);
    expect(r.unparsed.length, '解不出来却什么都没留下 —— 格式变了没人知道')
      .toBeGreaterThan(0);
  });

  it('⚠️ 空回答也要报,不能当成「没有建议」', () => {
    const r = parseAdviceResponse('');
    expect(r.advices).toHaveLength(0);
    expect(r.unparsed.length, '空回答被当成了「一条建议都没有」').toBeGreaterThan(0);
  });

  it('⚠️ 缺字段的块进 unparsed,不许瞎猜补全', () => {
    const r = parseAdviceResponse('[1] id=1234567890123456789\n理由：忘了写建议');
    expect(r.advices, '缺「建议」字段却硬解了出来').toHaveLength(0);
    expect(r.unparsed.length).toBeGreaterThan(0);
  });

  it('⭐ 总结句抓得到(给人看的「哪几条优先」)', () => {
    const r = parseAdviceResponse(GOOD);
    expect(r.summary, '总结句丢了').toMatch(/优先回/);
  });
});

describe('⭐⭐ 校验与 Gemma 那套共用(业务资产不许有两份)', () => {
  it('⭐⭐ Claude 写的正文同样要过 verifyGeneratedReply', () => {
    /**
     * ⚠️ 链接被改写最隐蔽:发出去看不出来,但那次点击永远归不了因。
     * 这条不能靠模型自觉 —— Claude 也一样。
     */
    const r = parseAdviceResponse(`[1] id=1234567890123456789 建议=回复 把握=高
理由：t
正文：试试这个 https://otun.example/trial?ref=CHANGED&lang=zh&v=6`);
    const bad = r.advices[0];
    expect(
      verifyGeneratedReply(bad.text, LINK),
      'Claude 改了 ref 却没被拦下 —— 统计资产被破坏且看不出来',
    ).toBe('link_altered');
  });

  it('⭐ 最高级承诺同样要拦(外语实测踩过)', () => {
    expect(verifyGeneratedReply(`这是最好的选择 ${LINK}`, LINK)).toBe('superlative');
  });

  it('⭐ 合规的正文要放行(别把守卫写成恒失败)', () => {
    expect(verifyGeneratedReply(`试试这个吧 ${LINK}`, LINK)).toBeNull();
  });
});
