/**
 * 守卫:通知页具名互动的解析。
 *
 * 用户 2026-09-03:「点赞多少次(名单),转发多少次(名单),回复多少次(名单)。
 *   只有能够区别出这些,才能够谈得上更新多少个呀?」「需要在 notification 中拿到」。
 *
 * 两个真实踩过的坑,本文件专门钉住:
 *  ① `timestamp_ms` **名不副实** —— 实测值是 ISO 字符串而非毫秒数。
 *     照名字 Number() → NaN → toISOString() 抛 RangeError(离线验证时当场炸)。
 *  ② twikit 只取 `fromUsers[0]` —— 「X and 2 others liked」实测 from_users
 *     确实是 3 个,只取第一个会丢 2/3 名单。
 */
import { describe, it, expect } from 'vitest';
import { extractInteractions, parseNotifTime, iconToKind,
  type Interaction } from '@platform/main/x/x-notifications';

/** 仿真实测结构:一条通知,3 个点赞者,1 个目标推 */
const payload = { data: { viewer_v2: { user_results: { result: { timeline: {
  timeline: { instructions: [{ entries: [
    { content: { itemContent: {
      __typename: 'TimelineNotification',
      notification_icon: 'heart_icon',
      rich_message: { text: '呀吰吖 and 2 others liked your reply' },
      timestamp_ms: '2026-08-20T16:35:09.521Z',
      template: {
        __typename: 'TimelineNotificationAggregateUserActions',
        from_users: [
          { user_results: { result: { rest_id: '111', core: { screen_name: 'UserOne' } } } },
          { user_results: { result: { rest_id: '222', core: { screen_name: 'usertwo' } } } },
          { user_results: { result: { rest_id: '333', core: { screen_name: 'UserThree' } } } },
        ],
        target_objects: [{ tweet_results: { result: { rest_id: '2050889514764190173' } } }],
      },
    } } },
  ] }] },
} } } } } };

function run(): Interaction[] { const out: Interaction[] = []; extractInteractions(payload, out); return out; }

describe('通知时间解析', () => {
  it('⭐ timestamp_ms 实际是 ISO 字符串(名不副实)', () => {
    expect(parseNotifTime('2026-08-20T16:35:09.521Z')).toBe('2026-08-20T16:35:09.521Z');
  });
  it('真毫秒数也接', () => {
    expect(parseNotifTime(1756000000000)).toBe(new Date(1756000000000).toISOString());
    expect(parseNotifTime('1756000000000')).toBe(new Date(1756000000000).toISOString());
  });
  it('⭐ 解析不出返回 undefined,不得抛也不得写 Invalid Date', () => {
    for (const bad of ['', 'not-a-date', null, undefined, {}, NaN]) {
      expect(() => parseNotifTime(bad)).not.toThrow();
      expect(parseNotifTime(bad)).toBeUndefined();
    }
  });
});

describe('icon → 行为类型', () => {
  it('heart_icon = 点赞', () => expect(iconToKind('heart_icon')).toBe('like'));
  it('文案兜底(icon 未知时按文案判)', () => {
    expect(iconToKind('unknown_icon', 'X reposted your post')).toBe('retweet');
    expect(iconToKind('unknown_icon', 'X followed you')).toBe('follow');
  });
  it('都判不出归 other,不丢弃(便于事后补映射)', () => {
    expect(iconToKind('brand_new_icon', 'something new')).toBe('other');
  });
});

describe('具名互动解析', () => {
  it('⭐ 取全部 from_users,不是只取第一个(twikit 的坑)', () => {
    const r = run();
    expect(r, '「and 2 others」共 3 人,少一个都是丢名单').toHaveLength(3);
    expect(r.map((i) => i.actorUid).sort()).toEqual(['111', '222', '333']);
  });

  it('handle 归一化(小写无 @),uid 原样', () => {
    const r = run();
    expect(r.map((i) => i.actorHandle).sort()).toEqual(['userone', 'usertwo', 'userthree'].sort());
  });

  it('三人指向同一条被赞的推', () => {
    for (const i of run()) expect(i.targetId).toBe('2050889514764190173');
  });

  it('kind 与时间正确带出', () => {
    for (const i of run()) {
      expect(i.kind).toBe('like');
      expect(i.notifiedAt).toBe('2026-08-20T16:35:09.521Z');
    }
  });

  it('⭐ 幂等键 (kind,actor,target) 能区分同一人对不同推的同类行为', () => {
    const keys = new Set(run().map((i) => `${i.kind}|${i.actorUid}|${i.targetId}`));
    expect(keys.size).toBe(3);
  });
});

/**
 * 聚合通知的**两个维度**都是数组:from_users × target_objects。
 * 我避开了 actor 那个坑(twikit 只取 [0]),却在 target 上照犯 ——
 * 2026-09-03 用户按页面数字对账时发现:「应该是 1 个点赞、3 个转发、1 个回复」,
 * 而库里每条通知只记了 1 条 target,与「liked 4 of your posts」对不上。
 */
const multiTarget = { data: { x: {
  __typename: 'TimelineNotification',
  notification_icon: 'heart_icon',
  rich_message: { text: 'A and 1 other liked 3 of your posts' },
  timestamp_ms: '2026-09-03T10:00:00.000Z',
  template: {
    from_users: [
      { user_results: { result: { rest_id: 'u1', core: { screen_name: 'alice' } } } },
      { user_results: { result: { rest_id: 'u2', core: { screen_name: 'bob' } } } },
    ],
    target_objects: [
      { tweet_results: { result: { rest_id: 'p1',
        legacy: { conversation_id_str: 'c1', created_at: 'Wed Sep 02 10:00:00 +0000 2026' } } } },
      { tweet_results: { result: { rest_id: 'p2',
        legacy: { conversation_id_str: 'c2', created_at: 'Wed Sep 02 11:00:00 +0000 2026',
          extended_entities: { media: [{ type: 'photo' }] } } } } },
      { tweet_results: { result: { rest_id: 'p3',
        legacy: { conversation_id_str: 'c3', created_at: 'Wed Sep 02 12:00:00 +0000 2026' } } } },
    ],
  },
} } };

describe('聚合通知:多人 × 多推', () => {
  it('⭐ 2 人 × 3 推 = 6 条互动事实,不是 2 条也不是 1 条', () => {
    const out: Interaction[] = [];
    extractInteractions(multiTarget, out);
    expect(out, '只取 target[0] 会把「liked 3 of your posts」记成 1 次').toHaveLength(6);
  });

  it('⭐ 每条推的 has_media 各自独立(不能用第一条的值套给全部)', () => {
    const out: Interaction[] = [];
    extractInteractions(multiTarget, out);
    const p2 = out.filter((i) => i.targetId === 'p2');
    const p1 = out.filter((i) => i.targetId === 'p1');
    expect(p2.every((i) => i.targetHasMedia === true), 'p2 带图').toBe(true);
    expect(p1.every((i) => i.targetHasMedia === false), 'p1 不带图').toBe(true);
  });

  it('⭐ conversation_id 逐条对应(决定属于哪篇文章)', () => {
    const out: Interaction[] = [];
    extractInteractions(multiTarget, out);
    const map = new Map(out.map((i) => [i.targetId, i.targetConversationId]));
    expect(map.get('p1')).toBe('c1');
    expect(map.get('p2')).toBe('c2');
    expect(map.get('p3')).toBe('c3');
  });

  it('幂等键能区分同一人对不同推的同类行为', () => {
    const out: Interaction[] = [];
    extractInteractions(multiTarget, out);
    const keys = new Set(out.map((i) => `${i.kind}|${i.actorUid}|${i.targetId}`));
    expect(keys.size).toBe(6);
  });

  it('follow 类无目标推时仍产出一条(空 targetId 占位)', () => {
    const followNotif = { x: {
      __typename: 'TimelineNotification',
      notification_icon: 'person_icon',
      rich_message: { text: 'A followed you' },
      template: { from_users: [
        { user_results: { result: { rest_id: 'u9', core: { screen_name: 'zoe' } } } }] },
    } };
    const out: Interaction[] = [];
    extractInteractions(followNotif, out);
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe('follow');
    expect(out[0].targetId).toBe('');
  });
});
