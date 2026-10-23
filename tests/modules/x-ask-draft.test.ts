/**
 * ⭐ 求关留言 Gemma 草拟(2026-10-21)—— 用户:「建议这里跳出一个Gemma草拟的答复吧。如果不满意我再修改,如何?」
 */
import { describe, it, expect } from 'vitest';
import { buildAskDraftPrompt, cleanAskDraft } from '@modules/x/x-ask-draft';
import { replySourceOf } from '@modules/x/x-ask-run';

describe('提示词', () => {
  it('范例(他的帖子 + 我的留言)全带上、这次的帖子在、规矩在', () => {
    const m = buildAskDraftPrompt({
      examples: [{ tweet: '#蓝V互关 交朋友', reply: '已关,互关互助!' }, { tweet: '浇一个', reply: '活人来啦,互浇一个?' }],
      tweet: '玩X做好三件事情 #蓝v互关', person: { name: 'Jesse', bio: '我们的目标是星辰大海' },
    });
    expect(m[0].content).toMatch(/默认写中文,他的要求\(下面的长期要求或点评\)指定了别的语言就用那种语言/);
    expect(m[0].content).toMatch(/不要 @/);
    expect(m[1].content).toContain('已关,互关互助!');
    expect(m[1].content).toContain('活人来啦,互浇一个?');
    expect(m[1].content).toContain('玩X做好三件事情');
    expect(m[1].content).toContain('星辰大海');
    expect(m[1].content.trim().endsWith('我的留言:')).toBe(true);
  });
  it('还没有范例时也能拼(不编范例)', () => {
    const m = buildAskDraftPrompt({ examples: [], tweet: 'x', person: {} });
    expect(m[1].content).not.toContain('例 1');
  });
});

describe('草稿收拾 + 校验', () => {
  it('去引号 / 前缀,只留第一行', () => {
    expect(cleanAskDraft('「说得对,互关一个!」\n解释:……')).toEqual({ text: '说得对,互关一个!' });
    expect(cleanAskDraft('我的留言:已关,常来常往')).toEqual({ text: '已关,常来常往' });
  });
  it.each([
    ['', /空/], ['好'.repeat(61), /太长/], ['已关 @abc', /@/], ['看这个 https://t.co/x', /链接/],
    ['互关 #蓝V互关', /话题/], 
  ])('不合格:%s', (raw, re) => {
    const r = cleanAskDraft(raw);
    expect('problem' in r && r.problem).toMatch(re);
  });
});

describe('发出去算谁写的', () => {
  it('一字不差 = ai;改过 / 没用草稿 = human', () => {
    expect(replySourceOf('已关,互关互助!', ' 已关,互关互助! ')).toBe('ai');
    expect(replySourceOf('已关,互关互助!', '已关,互关互助!😂')).toBe('human');
    expect(replySourceOf(undefined, '自己写的')).toBe('human');
  });
});

describe('互动口吻(2026-10-22)', () => {
  it('不求关、不提互关;范例标「回复」', () => {
    const m = buildAskDraftPrompt({ examples: [{ tweet: 'a', reply: '确实' }], tweet: '今天 A 股大跌', person: {}, mode: 'engage' });
    expect(m[0].content).toMatch(/不要求关注、不要提「互关」/);
    expect(m[0].content).not.toMatch(/求互关/);
    expect(m[1].content).toMatch(/我以前亲手写的回复/);
  });
});

describe('对话上文进提示词(2026-10-22)', () => {
  it('有上下文就附上「从原帖开始」那一段', () => {
    const m = buildAskDraftPrompt({ examples: [], tweet: '互相帮助互关互赞', person: {}, mode: 'engage', context: '[原帖] @x:蓝V互关接龙\n我:已关' });
    expect(m[1].content).toMatch(/这条帖子所在的对话\(从原帖开始\):\n\[原帖\] @x:蓝V互关接龙/);
  });
});

describe('⭐ 点评(用户 10-22:「增加一个我对AI回复提出要求的窗口(点评)」)', () => {
  it('长期要求进系统提示、写明优先于范例口吻;没有就不出现', () => {
    const m = buildAskDraftPrompt({ examples: [], tweet: 'x', person: {}, rules: ['别说教', '多用问句'] });
    expect(m[0].content).toMatch(/他的长期要求\(一定照做,和上面的口吻冲突时以这里为准\):\n1\. 别说教\n2\. 多用问句/);
    expect(buildAskDraftPrompt({ examples: [], tweet: 'x', person: {} })[0].content).not.toMatch(/他的长期要求\(/);
  });
  it('按点评改:带上一版 + 点评,结尾要「改好的留言」;模型回的前缀会被剥掉', () => {
    const m = buildAskDraftPrompt({ examples: [], tweet: '今天想上3000', person: {}, revise: { previous: '加油!', note: '问他一句怎么涨的' } });
    expect(m[1].content).toMatch(/上一版留言:加油!\n他对上一版的点评\(照着改\):问他一句怎么涨的\n\n改好的留言:$/);
    expect(cleanAskDraft('改好的留言:你是怎么涨这么快的?')).toEqual({ text: '你是怎么涨这么快的?' });
  });
});

describe('⭐ 外语(用户 10-22:「让它用英文回复,怎么都是中文?」)', () => {
  it('英文草稿不再被拒;英文按词算长短(62 个字母不算长),太长才拒', () => {
    expect(cleanAskDraft('That look on his face is priceless, he totally forgot how to dog!')).toEqual({ text: 'That look on his face is priceless, he totally forgot how to dog!' });
    expect(cleanAskDraft(Array.from({ length: 50 }, () => 'word').join(' '))).toEqual({ problem: '太长了(50 个词)' });
    expect(cleanAskDraft('好'.repeat(61))).toEqual({ problem: '太长了(61 字)' });
  });
});
