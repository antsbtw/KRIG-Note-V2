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
    expect(m[0].content).toMatch(/只写中文/);
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
    ['互关 #蓝V互关', /话题/], ['Followed back, nice to meet you!', /不是中文/],
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
