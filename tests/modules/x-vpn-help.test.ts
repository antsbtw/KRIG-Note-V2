/**
 * ⭐⭐ 任务「VPN求助」纯逻辑(2026-10-23)
 * 用户 10-23 选:先帮忙再带链接 · 只回 24 小时内的 · Gemma 先判、我抽看推翻。
 */
import { describe, it, expect } from 'vitest';
import { matchesRecipe, buildJudgePrompt, buildVpnReplyPrompt, cleanVpnDraft, parseJudge, replyLangOf, vpnLink, VPN_FRESH_HOURS, VPN_RECIPES } from '@modules/x/x-vpn-help';

describe('判断', () => {
  it('一次一条、要对象;双向产品写进系统提示;有上一层就带上;人工例子带上', () => {
    const m = buildJudgePrompt({ text: 'any good vpn for china?', lang: 'en', parent: '在聊旅游', examples: [{ text: '求推荐梯子', verdict: 'accept' }, { text: '广告', verdict: 'reject' }] });
    expect(m[0].content).toMatch(/双向服务/);
    expect(m[0].content).toMatch(/输出单个 JSON 对象\(不是数组\)/);
    expect(m[1].content).toMatch(/上一层:在聊旅游/);
    expect(m[1].content).toMatch(/推文:求推荐梯子\n人工判断:值得回/);
    expect(m[1].content).toMatch(/这条推文\(lang=en\):any good vpn for china\?/);
  });
  it('⭐ 解析:对象里带前后废话也认;worth 不是布尔 / 没 JSON → 回原因(调用方记错重判,绝不当成「不值得」)', () => {
    expect(parseJudge('好的\n{"worth": true, "direction": "in", "reason": "海外想看国内剧", "translation": ""}')).toEqual({ verdict: { worth: true, direction: 'in', reason: '海外想看国内剧', translation: undefined } });
    expect(parseJudge('{"worth": "yes"}')).toEqual({ problem: '模型没给 worth(true/false)' });
    expect(parseJudge('我觉得值得')).toEqual({ problem: '模型没回 JSON 对象' });
    expect(parseJudge('{"worth": false, "direction": "sideways"}')).toMatchObject({ verdict: { worth: false, direction: 'none' } });
  });
});

describe('回复', () => {
  const now = new Date(2026, 9, 23);
  it('试用链接:落地页 + 账号_日期_配方 来源标识 + 语言参数', () => {
    expect(vpnLink('zh', 'antsBTW', '回国需求-中文', now)).toBe('https://situstechnologies.com/x?ref=tw_antsBTW_20261023_backzh&lang=zh&v=6');
    expect(vpnLink('en', 'antsBTW', 'VPN求助-英文', now)).toBe('https://situstechnologies.com/x?ref=tw_antsBTW_20261023_vpnen&lang=en&v=7');
    expect(replyLangOf('有好用的梯子吗')).toBe('zh');
    expect(replyLangOf('any vpn?')).toBe('en');
  });
  it('⭐ 先帮忙再带链接(用户 10-23 选);事实清单、链接逐字、长期要求、点评都进提示词', () => {
    const link = vpnLink('zh', 'me', 'VPN求助-中文', now);
    const m = buildVpnReplyPrompt({ tweet: '梯子又挂了', lang: 'zh', link, direction: 'out', examples: [], rules: ['别太像广告'], revise: { previous: '试试这个', note: '先说说怎么排查' } });
    expect(m[0].content).toMatch(/先针对他说的具体问题说一两句有用的话.*最后一句带上注册链接/);
    expect(m[0].content).toContain(`注册链接(逐字照抄,一个字都不能改):${link}`);
    expect(m[0].content).toMatch(/【严禁】编造价格/);
    expect(m[0].content).toMatch(/1\. 别太像广告/);
    expect(m[1].content).toMatch(/上一版回复:试试这个\n他对上一版的点评\(照着改\):先说说怎么排查\n\n改好的回复:$/);
  });
  it('⭐⭐ 校验:链接没带 / 被改 / @ / 最高级 / 话题标签 都不填;链接后紧贴的句号去掉', () => {
    const link = 'https://situstechnologies.com/x?ref=tw_me_20261023_vpnzh&lang=zh&v=6';
    expect(cleanVpnDraft(`先看看节点是不是被封了,换个协议试试。可以试试 OTun-M,注册送 7 天 10GB:${link}。`, link))
      .toEqual({ text: `先看看节点是不是被封了,换个协议试试。可以试试 OTun-M,注册送 7 天 10GB:${link}` });
    expect(cleanVpnDraft('换个协议试试', link)).toEqual({ problem: '没带试用链接' });
    expect(cleanVpnDraft(`试试 ${link.replace('vpnzh', 'vpn')}`, link)).toEqual({ problem: '链接被改动了(来源标识会丢)' });
    expect(cleanVpnDraft(`@abc 试试 ${link}`, link)).toEqual({ problem: '带了 @(X 会自动带上对方)' });
    expect(cleanVpnDraft(`这是最好的 ${link}`, link)).toEqual({ problem: '用了「最好 / 最快 / 保证」这类承诺' });
    expect(cleanVpnDraft(`试试 #VPN ${link}`, link)).toEqual({ problem: '带了话题标签' });
  });
  it('配方四条、新鲜度 24 小时(用户 10-23 选)', () => {
    expect(VPN_RECIPES).toEqual(['VPN求助-中文', 'VPN求助-英文', '回国需求-中文', '回国需求-英文']);
    expect(VPN_FRESH_HOURS).toBe(24);
  });
});

describe('⭐ 登记前先看这条自己命中配方没有(10-23 真机:被引用 / 上文的推文混进来,《部落冲突》、政治帖都成了求助帖)', () => {
  it('关键词任一 且 求助信号任一,不分大小写;没信号的配方只看关键词', () => {
    const kw = ['VPN', '梯子', 'clash']; const sig = ['求助', '怎么', '推荐'];
    expect(matchesRecipe('梯子又挂了,怎么办', kw, sig)).toBe(true);
    expect(matchesRecipe('求推荐一个好用的 vpn', kw, sig)).toBe(true);
    expect(matchesRecipe('Similar thing exists in Clash Of Clans', kw, sig)).toBe(false);
    expect(matchesRecipe('一位道士自创的治疗癌症方子', kw, sig)).toBe(false);
    expect(matchesRecipe('clash 配置分享', kw, [])).toBe(true);
  });
});
