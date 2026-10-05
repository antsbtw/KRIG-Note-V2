/**
 * ⭐⭐⭐ **载荷自己说自己是什么** —— 采集只有一个入口
 *
 * 用户 2026-10-05 的订正(原话):
 * 「不管采什么,都是采集页面的内容,而不应该增加一个采人的名单。
 * 　跳转到那个页面,就采集那个页面,这就是输出的意义。
 * 　**输出要自行判断**,把输出的内容结构化而已。」
 *
 * ⚠️⚠️ 我原先的设计让**人**告诉采集器「这页上是什么」(两个按钮,
 * 按钮决定用哪个解析器)。可端点名里就写着 `Followers` / `SearchTimeline` ——
 * 信息本来就在数据里,我却造了第二个真源,还把「保持两边一致」变成人的活。
 * ⭐ 这正是 `project-x-collect-panel-scraped-homepage` 的形状:
 * 「我在哪一页」有两个说法,就一定有一天它们不一致(那次爬了 30 分钟首页)。
 *
 * ⭐ 判据:**同一次采集里混着推文和用户的响应,也要各归其位**。
 */
import { describe, it, expect } from 'vitest';
import { dispatchPayloads } from '@modules/x/x-payload-dispatch';

const TWEET_URL = 'https://x.com/i/api/graphql/aa/SearchTimeline?variables=%7B%7D';
const USER_URL = 'https://x.com/i/api/graphql/bb/Followers?variables=%7B%7D';
const NOISE_URL = 'https://video.twimg.com/seg-3.m4s';

const tweetPayload = JSON.stringify({ data: { search_by_raw_query: {
  search_timeline: { timeline: { instructions: [{ type: 'TimelineAddEntries', entries: [{
    entryId: 'tweet-1',
    content: { itemContent: { tweet_results: { result: {
      rest_id: '111',
      core: { user_results: { result: {
        rest_id: '9', core: { screen_name: 'alice', name: 'Alice' }, legacy: {},
      } } },
      legacy: { full_text: '一条推文', created_at: 'Fri Oct 03 10:00:00 +0000 2026' },
    } } } },
  }] }] } } } } });

const userPayload = JSON.stringify({ data: { user: { result: { timeline: { timeline: {
  instructions: [{ type: 'TimelineAddEntries', entries: [{
    entryId: 'user-1',
    content: { itemContent: { user_results: { result: {
      rest_id: '901',
      core: { screen_name: 'bob', name: 'Bob' },
      legacy: { description: 'bio', followers_count: 12 },
    } } } },
  }] }],
} } } } } });

describe('载荷自己说自己是什么', () => {
  it('⭐⭐⭐ 推文响应 → 推文账;用户响应 → 用户账', () => {
    const r = dispatchPayloads([
      { url: TWEET_URL, text: tweetPayload },
      { url: USER_URL, text: userPayload },
    ]);
    expect(r.tweets.length).toBe(1);
    expect(r.users.length).toBe(1);
    expect(r.users[0].items[0].handle).toBe('bob');
  });

  it('⭐⭐⭐ 一次采集里混着两种,各归其位(不互相污染)', () => {
    /**
     * ⚠️⚠️ 这是**单入口的关键判据**:人流名单页上也会有别的时间线请求,
     * 搜索页也可能夹着用户卡片。按「人选的类型」分流就一定会丢一边。
     */
    const r = dispatchPayloads([
      { url: USER_URL, text: userPayload },
      { url: TWEET_URL, text: tweetPayload },
      { url: USER_URL, text: userPayload },
      { url: NOISE_URL, text: 'not json' },
    ]);
    expect(r.users.length).toBe(2);
    expect(r.tweets.length).toBe(1);
    /** ⭐ 噪音既不算推文也不算用户,但要**记下来**不是悄悄丢 */
    expect(r.ignored).toBe(1);
  });

  it('⭐⭐ 只有用户、没有推文时,不许报「一条推文都没解出来」', () => {
    /**
     * ⚠️⚠️ 这正是改这版的起因之一:followers 页喂给推文解析器 →
     * 0 条 + 报「可能结构变了」,**误导性告警比报错还坏**
     * (它把人指向「X 改版了」这个错方向)。
     */
    const r = dispatchPayloads([{ url: USER_URL, text: userPayload }]);
    expect(r.tweets).toHaveLength(0);
    expect(r.users).toHaveLength(1);
    /** ⭐ 结论要说「这页装的是用户」,不是「推文解析失败」 */
    expect(r.kind).toBe('users');
    expect(r.problems.join(' ')).not.toContain('结构');
  });

  it('⭐⭐ kind 由数据算:只有推文=tweets,混着=mixed,什么都没有=empty', () => {
    expect(dispatchPayloads([{ url: TWEET_URL, text: tweetPayload }]).kind).toBe('tweets');
    expect(dispatchPayloads([
      { url: TWEET_URL, text: tweetPayload }, { url: USER_URL, text: userPayload },
    ]).kind).toBe('mixed');
    expect(dispatchPayloads([]).kind).toBe('empty');
    /** ⭐ 只有噪音也是 empty —— 但 ignored 要记着,别看着像「页面没数据」 */
    const n = dispatchPayloads([{ url: NOISE_URL, text: 'x' }]);
    expect(n.kind).toBe('empty');
    expect(n.ignored).toBe(1);
  });

  it('⭐⭐⭐ 20 个响应一个人都没解出来 = empty,不是 users', () => {
    /**
     * ⚠️⚠️ 这条是**注入验证逼出来的**:把 kind 的判据从「解出了东西没有」
     * 改成「有几个响应」,前面六条**全绿** —— 因为我的样本里
     * 「有 Followers 响应」和「解出了人」永远同时成立,
     * 那个区别**压根没被测到**。
     * ⭐ 正是 `feedback-check-sample-contains-phenomenon`:
     * 别拿不含某现象的样本论证该现象。
     *
     * ⭐⭐ 而这正是最该挡住的那种假成功:载荷收到了、结构变了解不出,
     * 报成 `users` 就等于说「这页是人流、采到了」。
     */
    const empty = JSON.stringify({ data: { user: { result: { timeline: { timeline: {
      instructions: [{ type: 'TimelineAddEntries', entries: [] }],
    } } } } } });
    const r = dispatchPayloads(Array.from({ length: 20 }, () => ({ url: USER_URL, text: empty })));
    expect(r.users.length).toBe(20);
    expect(r.users.every((a) => a.items.length === 0)).toBe(true);
    expect(r.kind, '有响应但一个都没解出来 → empty').toBe('empty');
  });

  it('⭐⭐⭐ 用户的名次跨响应连续 —— 不是每个响应从 0 重来', () => {
    /**
     * ⚠️ `seq` 是增量采集的命根子(「新人全落在 seq 0-10」那条实测判据)。
     * 每个响应各自从 0 编号的话,去重后名次全是乱的。
     */
    const r = dispatchPayloads([
      { url: USER_URL, text: userPayload },
      { url: USER_URL, text: userPayload },
    ]);
    expect(r.users[0].items[0].seq).toBe(0);
    expect(r.users[1].items[0].seq).toBe(1);
  });

  it('⭐⭐ 载荷读不懂要进 problems,不许静默丢', () => {
    /**
     * ⚠️ 「这个载荷读不懂」与「这个载荷是空的」是两件事,
     * 混起来就查不动(推文那边正是这么踩过)。
     */
    const r = dispatchPayloads([{ url: USER_URL, text: '{ 坏的 json' }]);
    expect(r.problems.length).toBeGreaterThan(0);
  });
});
