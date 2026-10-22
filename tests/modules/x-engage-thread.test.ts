/**
 * ⭐ 互动卡的来龙去脉:找到原帖,排成一条线(2026-10-22 用户:「最好办法是找到这个互动帖子的原帖。」)
 */
import { describe, it, expect } from 'vitest';
import { buildThread, threadForPrompt } from '@modules/x/x-engage-thread-model';

const row = (id: string, author: string, at: string, parent?: string, text = `t${id}`) =>
  ({ tweet_id: id, author_rest_id: author, author_handle: author.toLowerCase(), text, created_at: at, in_reply_to: parent, conversation_id: 'R' });

describe('找原帖', () => {
  const rows = [
    row('R', 'OTHER', '2026-10-17T00:00:00Z', undefined, '原帖:蓝V互关接龙'),
    row('A', 'ME', '2026-10-17T01:00:00Z', 'R', '已关,互关互助'),
    row('B', 'HIM', '2026-10-18T00:00:00Z', 'A', '@antsBTW 互相帮助互关互赞'),
    row('C', 'ME', '2026-10-19T00:00:00Z', 'B', '好的'),
    row('X', 'OTHER2', '2026-10-18T05:00:00Z', 'R', '别人的回复'),
  ];
  it('原帖 → 我第 1 轮 → 他第 2 轮(要回的这条);之后我们的来回单列;别人的旁支不进', () => {
    const t = buildThread('B', rows, 'ME', 'HIM');
    expect(t.chain.map((x) => [x.id, x.who, x.isRoot, x.isTarget])).toEqual([
      ['R', 'other', true, false], ['A', 'me', false, false], ['B', 'him', false, true],
    ]);
    expect(t.gapAbove).toBe(false);
    expect(t.later.map((x) => x.id)).toEqual(['C']);
  });
  it('上一层库里没有 → gapAbove(界面写「再往上没找到原帖」,主进程据此去详情页补采)', () => {
    const t = buildThread('B', rows.filter((r) => r.tweet_id !== 'A'), 'ME', 'HIM');
    expect(t.gapAbove).toBe(true);
    expect(t.chain.map((x) => x.id)).toEqual(['B']);
  });
  it('给 Gemma 的上下文:标原帖 / 要回的这条 / 我 他 别人', () => {
    const s = threadForPrompt(buildThread('B', rows, 'ME', 'HIM'));
    expect(s.split('\n')).toEqual(['[原帖] @other:原帖:蓝V互关接龙', '我:已关,互关互助', '[要回的这条] 他:@antsBTW 互相帮助互关互赞', '我:好的']);
  });
});
