/**
 * ⭐⭐ 「采人」解析器 —— 真调函数
 *
 * ── 用户 2026-09-18 实测 ──
 *
 * 在 `x.com/otun_myvpn/verified_followers` 采集,截到
 * **12 个 `BlueVerifiedFollowers` 载荷、每个约 40KB** —— 那就是人的列表。
 * 而 `extractTweetsFrom` 只认推文对象,会整个跳过 → 报 0 条。
 *
 * ⚠️ 本解析器是**按兄弟代码推断**写的(`x-author-profile.ts` 的
 * `findUserResult`/`parseUserResult` 解过同类结构),**我没见过真实载荷**。
 * 所以这里用两种形态(新 core/profile_bio、旧 legacy)各造一份样本,
 * 钉住两边都能解 —— 真载荷进来时若解不出,这些测试会是排查的起点。
 */
import { describe, it, expect } from 'vitest';
import {
  extractPeopleFrom, parsePerson, isPeopleOp,
  type HarvestedPerson,
} from '@platform/main/x/x-people-harvester';

/** 新形态:core / profile_bio / relationship_counts */
const modern = {
  rest_id: '1640251786476023808',
  core: { screen_name: 'SomeBody', name: '某人', created_at: 'Thu Sep 17 23:36:41 +0000 2026' },
  profile_bio: { description: '信息PhD,银行账户,云居民经验' },
  relationship_counts: { followers: 1452, following: 1306 },
  tweet_counts: { tweets: 8800 },
  avatar: { image_url: 'https://pbs.twimg.com/a.jpg' },
  is_blue_verified: true,
  relationship_perspectives: { following: true, followed_by: true, blocking: false },
  location: { location: '上海' },
};

/** 旧形态:全在 legacy */
const legacyShape = {
  rest_id: '999',
  legacy: {
    screen_name: 'OldStyle', name: '旧形态', description: '旧结构的 bio',
    followers_count: 300, friends_count: 120, statuses_count: 50,
    profile_image_url_https: 'https://pbs.twimg.com/b.jpg',
    following: false, followed_by: true,
    created_at: 'Mon Jan 01 00:00:00 +0000 2020', location: '北京',
  },
};

describe('⭐⭐ 两种形态都要解得出', () => {
  it('⭐⭐ 新形态(core / profile_bio / relationship_counts)', () => {
    const p = parsePerson(modern)!;
    expect(p.handle, 'handle 没归一化 —— 与 x_author.handle 对不上会静默查不到').toBe('somebody');
    expect(p.restId).toBe('1640251786476023808');
    expect(p.displayName).toBe('某人');
    expect(p.bio, 'bio 没解出来 —— 那正是这条能力存在的理由').toContain('信息PhD');
    expect(p.followersCount).toBe(1452);
    expect(p.followingCount).toBe(1306);
    expect(p.isBlueVerified).toBe(true);
    expect(p.iFollow).toBe(true);
    expect(p.followsMe).toBe(true);
    expect(p.xBlocking).toBe(false);
    expect(p.location).toBe('上海');
  });

  it('⭐⭐ 旧形态(全在 legacy)', () => {
    /**
     * ⚠️ 只读一种形态会在 X 改版后**静默少字段** ——
     * 而现象是「bio 覆盖率突然掉到 0」,不报错。
     */
    const p = parsePerson(legacyShape)!;
    expect(p.handle).toBe('oldstyle');
    expect(p.bio).toBe('旧结构的 bio');
    expect(p.followersCount).toBe(300);
    expect(p.iFollow, 'legacy.following=false 该解成 false').toBe(false);
    expect(p.followsMe).toBe(true);
  });

  it('⭐⭐ 没有 screen_name → null(不造只有 handle 的空壳)', () => {
    expect(parsePerson({ rest_id: '1' })).toBeNull();
    expect(parsePerson({})).toBeNull();
  });
});

describe('⭐⭐ 「没查到」与「查过是 false」必须分开', () => {
  it('⭐⭐ 关系字段缺失 → undefined,不是 false', () => {
    /**
     * 写成 false 等于说「查过了,他没关注我」,而事实是「载荷没带这个字段」。
     * 混起来会让追踪名单判错人(记忆 feedback-check-sample-contains-phenomenon)。
     */
    const p = parsePerson({ core: { screen_name: 'nobody' } })!;
    expect(p.iFollow, '缺失被写成了 false').toBeUndefined();
    expect(p.followsMe).toBeUndefined();
    expect(p.isBlueVerified).toBeUndefined();
  });

  it('⭐ 明确的 false 要保留(那是事实)', () => {
    const p = parsePerson({
      core: { screen_name: 'x' },
      relationship_perspectives: { following: false, followed_by: false },
    })!;
    expect(p.iFollow).toBe(false);
    expect(p.followsMe).toBe(false);
  });

  it('⭐ 数字 0 要保留(0 粉丝是事实,不是没采到)', () => {
    const p = parsePerson({
      core: { screen_name: 'x' },
      relationship_counts: { followers: 0, following: 0 },
    })!;
    expect(p.followersCount).toBe(0);
    expect(p.followingCount).toBe(0);
  });
});

describe('⭐⭐ 递归抽取:不写死嵌套路径', () => {
  it('⭐⭐ 深埋在 instructions/entries 里也能找到', () => {
    /**
     * ⚠️ X 的响应外层结构变过好几次。写死
     * `data.user.result.timeline.instructions[0].entries[...]`
     * 会在改版后**静默取不到**(返回 undefined 而不报错)。
     * 所以按特征递归找。
     */
    const payload = {
      data: { user: { result: { timeline: { timeline: { instructions: [
        { type: 'TimelineAddEntries', entries: [
          { entryId: 'user-1', content: { itemContent: { user_results: { result: modern } } } },
          { entryId: 'user-2', content: { itemContent: { user_results: { result: legacyShape } } } },
          { entryId: 'cursor-bottom', content: { value: 'xxx' } },
        ] },
      ] } } } } },
    };
    const out = new Map<string, HarvestedPerson>();
    extractPeopleFrom(payload, out);

    expect(out.size, '深层嵌套没找到人').toBe(2);
    expect(out.get('somebody')?.bio).toContain('信息PhD');
    expect(out.get('oldstyle')?.followersCount).toBe(300);
  });

  it('⭐ 按 handle 去重,第一次解到的留下', () => {
    const rich = { ...modern };
    const poor = { core: { screen_name: 'SomeBody' } };   // 同一个人的空壳
    const out = new Map<string, HarvestedPerson>();
    extractPeopleFrom([rich, poor], out);

    expect(out.size).toBe(1);
    expect(out.get('somebody')?.bio, '被后面的空壳覆盖了').toContain('信息PhD');
  });

  it('⭐⭐ 光有 screen_name 的引用片段不算人', () => {
    /**
     * 「回复给 @xxx」这类片段只有 screen_name,解出来是个空壳,
     * 会污染人表(一堆没有任何资料的行)。
     */
    const fragment = { screen_name: 'mentioned_user' };   // 没有 core/legacy/rest_id
    const out = new Map<string, HarvestedPerson>();
    extractPeopleFrom(fragment, out);
    expect(out.size, '引用片段被当成人采进来了').toBe(0);
  });

  it('⭐ 深度有上限,不会在环形结构上打转', () => {
    const deep: Record<string, unknown> = {};
    let cur = deep;
    for (let i = 0; i < 40; i++) { cur.next = {}; cur = cur.next as Record<string, unknown>; }
    cur.core = { screen_name: 'too_deep' };
    const out = new Map<string, HarvestedPerson>();
    expect(() => extractPeopleFrom(deep, out)).not.toThrow();
  });
});

describe('⭐ 认得出「人的列表」操作名', () => {
  it('⭐⭐ BlueVerifiedFollowers —— 用户实测到的那个', () => {
    expect(isPeopleOp('BlueVerifiedFollowers'), '实测到的操作名没认出来').toBe(true);
  });

  it('⭐ Followers / Following 也认', () => {
    expect(isPeopleOp('Followers')).toBe(true);
    expect(isPeopleOp('Following')).toBe(true);
    expect(isPeopleOp('FollowersYouKnow')).toBe(true);
  });

  it('⭐ 推文类操作不认', () => {
    expect(isPeopleOp('HomeTimeline')).toBe(false);
    expect(isPeopleOp('UserTweets')).toBe(false);
    expect(isPeopleOp('TweetDetail')).toBe(false);
  });
});
