/**
 * ⭐⭐ 他的朋友圈 —— 从推文现算(2026-10-10)
 * 用户:「主要是观察这个用户主要和哪些用户互动，找到它的朋友圈。」
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { computeCircle, looksChinese, CIRCLE_WEIGHTS } from '@modules/x/x-friend-circle';

const read = (p: string): string => readFileSync(join(process.cwd(), p), 'utf8');

describe('computeCircle', () => {
  it('⭐⭐ 四种他对别人的互动 + 别人回复他,分别计数,按权重排', () => {
    const his = [
      { author_rest_id: 'me', in_reply_to_user_id: 'a', in_reply_to_user: 'alice', mention_ids: ['a', 'b'], mentions: ['alice', 'bob'] },
      { author_rest_id: 'me', quoted_author_id: 'c' },
      { author_rest_id: 'me', retweet_of_author_id: 'b' },
    ];
    const toHim = [{ author_rest_id: 'd', author_handle: 'dan', in_reply_to_user_id: 'me' }];
    const c = computeCircle('me', his, toHim);
    const by = Object.fromEntries(c.map((e) => [e.id, e]));
    expect(by.a).toMatchObject({ reply: 1, mention: 0, handleSeen: 'alice', score: CIRCLE_WEIGHTS.reply });
    expect(by.b).toMatchObject({ mention: 1, retweet: 1, handleSeen: 'bob', score: 2 });
    expect(by.c).toMatchObject({ quote: 1, score: 2 });
    expect(by.d).toMatchObject({ theyReply: 1, handleSeen: 'dan', score: 3 });
    expect(c[0].score).toBeGreaterThanOrEqual(c[c.length - 1].score);
  });

  it('⭐⭐⭐ 排除他自己:回复自己的串推、提及自己都不算朋友', () => {
    const c = computeCircle('me', [{ author_rest_id: 'me', in_reply_to_user_id: 'me', mention_ids: ['me'] }], []);
    expect(c).toEqual([]);
  });

  it('⭐ 回复时 X 自动把被回复者放进提及 —— 不重复算成「提及」', () => {
    const c = computeCircle('me', [{ author_rest_id: 'me', in_reply_to_user_id: 'a', mention_ids: ['a'] }], []);
    expect(c[0]).toMatchObject({ id: 'a', reply: 1, mention: 0 });
  });

  it('⭐⭐ 转发外层的「RT @原作者」自动提及 —— 不重复算成「提及」(真机:提及 11 转发 11 恒等)', () => {
    const c = computeCircle('me', [{ author_rest_id: 'me', retweet_of_author_id: 'a', mention_ids: ['a'] }], []);
    expect(c[0]).toMatchObject({ id: 'a', retweet: 1, mention: 0 });
  });

  it('只算他自己发的;别人回复别人的不算「回复他」', () => {
    const c = computeCircle('me',
      [{ author_rest_id: 'x', in_reply_to_user_id: 'a' }],
      [{ author_rest_id: 'd', in_reply_to_user_id: 'z' }]);
    expect(c).toEqual([]);
  });
});

describe('looksChinese', () => {
  it('中文判中文;日文(≥2 个假名)不算;装饰性的「の」不误伤', () => {
    expect(looksChinese('李老师', '投稿私信')).toBe(true);
    expect(looksChinese('マルクロス', '恐竜公式声優')).toBe(false);
    expect(looksChinese('希望の凿痕', '互关必回')).toBe(true);
    expect(looksChinese('Bob', 'hello')).toBe(false);
  });
});

describe('接线', () => {
  it('⭐ 查询:他的推文按 author_rest_id;回复他的按 in_reply_to_user_id 且排除他自己', () => {
    const REPO = read('src/modules/x/x-people-repo.ts');
    const fn = REPO.slice(REPO.indexOf('export async function readFriendCircle'));
    expect(fn).toMatch(/FROM x_tweet WHERE author_rest_id = \$id;/);
    expect(fn).toMatch(/WHERE in_reply_to_user_id = \$id AND author_rest_id != \$id/);
    expect(fn).toMatch(/FROM x_author WHERE rest_id IN \$ids/);
  });
  it('⭐ friendCircle:契约 + handler;人卡调用;渲染端不引 main 侧的 repo', () => {
    expect(read('src/modules/x/x-data-types.ts')).toMatch(/op: 'friendCircle'/);
    expect(read('src/modules/x/x-data-ipc.ts')).toMatch(/case 'friendCircle':/);
    const PAGE = read('src/modules/x/XOpsPeople.tsx');
    expect(PAGE).toMatch(/op: 'friendCircle', restId, limit: 30/);
    expect(PAGE).not.toContain("from './x-people-repo'");
  });
});

describe('⭐ 采集结果落留痕 + 页数上限可设(2026-10-10)', () => {
  it('每个标签页的页数 / 条数 / 停因都落留痕', () => {
    const PAGE = read('src/modules/x/XOpsPeople.tsx');
    /** 2026-10-12 起每次尝试都记,重试那次带「[第 2 次]」前缀 */
    expect(PAGE).toMatch(/op: 'logPersonCollect',[\s\S]{0,300}stopReason: `\$\{attempt > 1 \? '\[第 2 次\] ' : ''\}\$\{why\}`/);
    expect(read('src/modules/x/x-data-ipc.ts')).toMatch(/case 'logPersonCollect':[\s\S]{0,400}event: 'x-person-collect'/);
  });
  it('当场采的页数上限读设置(默认 30,用户可调)', async () => {
    const { SETTING_DEFS } = await import('@modules/x/x-ops-settings');
    expect(SETTING_DEFS.find((d) => d.key === 'collect.live_page_cap')?.default).toBe(30);
    expect(read('src/modules/x/XOpsPeople.tsx')).toMatch(/settingsRef\.current\?\.\['collect\.live_page_cap'\] \?\? LIVE_PAGE_CAP/);
  });
});

describe('⭐⭐ 第一次翻页就 403 → 重载这一页再试一次(2026-10-12)', () => {
  /** 真机:帖子页那条响应只被页面钩子收到、CDP 没收到 → 翻页模板没鉴权头 → 403,只翻 1 页就停 */
  const PAGE = read('src/modules/x/XOpsPeople.tsx');
  const fn = PAGE.slice(PAGE.indexOf('const collectTweets'), PAGE.indexOf('/** ⭐ 选时间范围的小框'));
  it('最多两次;只在「第一轮就 403」时重试;第一次采到的照样存', () => {
    expect(fn).toMatch(/for \(let attempt = 1; attempt <= 2; attempt \+= 1\)/);
    expect(fn).toMatch(/const authFail = \/HTTP 403\/\.test\(why\) && \(run\.paging\?\.rounds \?\? 0\) <= 1;/);
    expect(fn).toMatch(/if \(authFail && attempt === 1 && !cancelCollect\.current\) continue;/);
    /** 存库在判断重试之前 —— 第一次的推文不丢 */
    expect(fn.indexOf("op: 'saveTweets'")).toBeLessThan(fn.indexOf('if (authFail && attempt === 1'));
  });
});

describe('⭐ 采集进度也落留痕(2026-10-12)', () => {
  it('每条进度消息(翻到第几页 / 歇 / 限流)都写 x-person-progress', () => {
    const PAGE = read('src/modules/x/XOpsPeople.tsx');
    expect(PAGE).toMatch(/onProgress: \(m\) => \{[\s\S]{0,400}op: 'logPersonProgress'/);
    expect(read('src/modules/x/x-data-ipc.ts')).toMatch(/case 'logPersonProgress':[\s\S]{0,200}event: 'x-person-progress'/);
  });
});
