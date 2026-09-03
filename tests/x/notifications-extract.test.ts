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
