/**
 * ⭐⭐⭐ 人流载荷的解析 —— followers / following / verifiedFollowers
 *
 * ⚠️ 此前这三页被 `carriesTweets` 认成时间线、喂给**推文**解析器 →
 * **0 条 + 报「一条推文都没解出来,可能结构变了」**。
 * ⭐ 误导性告警**比报错还坏**:它把人指向「X 改版了」这个错方向。
 *
 * 四条判据来自 `docs/handoff/x-followers-collection.md` 的实测,
 * 不是我新发明的。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { auditUserPayload } from '@modules/x/x-user-audit';
import { carriesTweets, carriesUsers } from '@modules/x/x-pages';

/** ⭐ 照真机形状造一个人 */
const person = (i: number, over: Record<string, unknown> = {}): unknown => ({
  entryId: `user-${i}`,
  content: { itemContent: { user_results: { result: {
    rest_id: `${900 + i}`,
    core: { screen_name: `user${i}`, name: `名字${i}` },
    legacy: {
      description: `bio ${i}`,
      followers_count: 1234 + i, friends_count: 56, statuses_count: 789,
      profile_image_url_https: `https://pbs/av${i}.jpg`,
    },
    relationship_perspectives: { following: false, followed_by: true },
    ...over,
  } } } },
});

const payload = (entries: unknown[], extra: unknown[] = []): string => JSON.stringify({
  data: { user: { result: { timeline: { timeline: {
    instructions: [{ type: 'TimelineAddEntries', entries }, ...extra],
  } } } } },
});

const cursor = (v: string): unknown =>
  ({ entryId: 'cursor-bottom', content: { cursorType: 'Bottom', value: v } });

describe('⭐⭐⭐ 人流与推文流必须分开', () => {
  it('⭐⭐⭐ 三个人流端点**不**算带推文', () => {
    for (const ep of ['Followers', 'Following', 'BlueVerifiedFollowers']) {
      const u = `https://x.com/i/api/graphql/abc/${ep}`;
      expect(
        carriesTweets(u),
        `${ep} 被当成推文流 —— 人的载荷喂给推文解析器会报「一条推文都没解出来」`,
      ).toBe(false);
      expect(carriesUsers(u), `${ep} 没被认成人流`).toBe(true);
    }
  });

  it('⭐⭐ 推文端点**不**算带人 —— 两者互斥', () => {
    for (const ep of ['SearchTimeline', 'HomeTimeline', 'TweetResultByRestId']) {
      const u = `https://x.com/i/api/graphql/abc/${ep}`;
      expect(carriesUsers(u), `${ep} 被认成人流了`).toBe(false);
      expect(carriesTweets(u)).toBe(true);
    }
  });
});

describe('⭐⭐ 解析一页人', () => {
  it('⭐⭐ 身份四样都取到:handle / id / 名字 / 头像', () => {
    const a = auditUserPayload(payload([person(0)]));
    const p = a.items[0];
    expect(p.handle).toBe('user0');
    expect(p.restId).toBe('900');
    expect(p.name).toBe('名字0');
    expect(p.avatar).toContain('av0.jpg');
  });

  /**
   * ⚠️ `screen_name` 在 `core` 和 `legacy` **两个位置**都可能 ——
   * X 正在往 `core` 挪。只认一个会在改版时**静默少一半**。
   */
  it('⭐⭐ handle 在 legacy 里也认得出(X 正在挪字段)', () => {
    const old = { content: { itemContent: { user_results: { result: {
      rest_id: '1', legacy: { screen_name: 'oldstyle', name: '老形状' },
    } } } } };
    const a = auditUserPayload(payload([old]));
    expect(a.items[0]?.handle, '只认 core 的话,老形状的载荷会一个人都解不出').toBe('oldstyle');
  });

  it('⭐ 关系用 X 的原词 following / followedBy', () => {
    const p = auditUserPayload(payload([person(0)])).items[0];
    expect(p.following).toBe(false);
    expect(p.followedBy).toBe(true);
  });

  /** ⚠️ 没带就 undefined —— 记忆记着旧实现 36 行里**粉丝数全空** */
  it('⚠️ 载荷没带粉丝数 → undefined,**不兜底成 0**', () => {
    const noFc = { content: { itemContent: { user_results: { result: {
      rest_id: '1', core: { screen_name: 'a', name: 'A' }, legacy: {},
    } } } } };
    const p = auditUserPayload(payload([noFc])).items[0];
    expect(p.followersCount, '没带却说成 0 粉丝 —— 「不知道」不是「零」').toBeUndefined();
  });

  /**
   * ⭐⭐ `seq` 是增量采集的命根子:交接文档实测
   * **X 的 followers 严格按关注时间倒序**,新人全落在最前面。
   */
  it('⭐⭐ seq 跨页连续 —— 差集靠它', () => {
    const a = auditUserPayload(payload([person(0), person(1)]), 100);
    expect(a.items.map((p) => p.seq), '名次没接着上一页数,跨页就对不上').toEqual([100, 101]);
  });
});

describe('⭐⭐⭐ 到底的判据', () => {
  /**
   * ⚠️⚠️ 交接文档实测:X 翻到底会发 `TimelineTerminateTimeline`,
   * **但仍附带游标**(值还在倒退)—— 光看游标会以为还能翻。
   */
  it('⭐⭐⭐ 到底那页:**有游标但 terminated** —— 两个都要报', () => {
    const a = auditUserPayload(payload(
      [person(0), cursor('STILL-HERE')],
      [{ type: 'TimelineTerminateTimeline', direction: 'Bottom' }],
    ));
    expect(a.hasCursor, '游标确实还在 —— 这正是坑所在').toBe(true);
    expect(a.terminated, '没认出 TimelineTerminateTimeline —— 会一直翻下去').toBe(true);
  });

  it('⭐ 没到底时 terminated 为 false', () => {
    const a = auditUserPayload(payload([person(0), cursor('C1')]));
    expect(a.terminated).toBe(false);
    expect(a.cursor).toBe('C1');
  });
});

describe('⚠️⚠️ 空 handle 要在解析层就喊', () => {
  /**
   * ⚠️⚠️ 交接文档实测:空 handle 会让**整批写入 0 条**
   * (`FOR` 里一条 ASSERT 失败全灭)。
   * ⭐ 在解析这层报出来,比到写库时整批失败好查得多。
   */
  it('⭐⭐⭐ 有人没 handle → problems 里明说「入库前必须挡掉」', () => {
    const bad = { content: { itemContent: { user_results: { result: {
      rest_id: '1', core: { screen_name: '', name: '无名' },
      legacy: { screen_name: '', description: 'x' },
    } } } } };
    /** ⚠️ 先确认样本真造出了该现象 —— 没 handle 的人要能被解出来 */
    const a = auditUserPayload(payload([person(0), bad]));
    expect(a.users, '样本里那个空 handle 的人没被解出来 —— 测不到该现象').toBe(2);
    expect(
      a.problems.join(''),
      '空 handle 不报 —— 到写库时会整批 0 条，那时才查就晚了',
    ).toContain('入库前必须挡掉');
  });
});

describe('⚠️ 读不懂与是空的,分开说', () => {
  it('⚠️ 空响应体 → 说「响应体是空的」,不说解析失败', () => {
    expect(auditUserPayload('').problems.join('')).toContain('响应体是空的');
  });

  it('⚠️ 半截 JSON → 说「不是合法 JSON」', () => {
    expect(auditUserPayload('{"data":{"us').problems.join('')).toContain('不是合法 JSON');
  });

  it('⚠️ 合法但一个人都没有 → 明说,不交空报告', () => {
    const a = auditUserPayload('{"data":{}}');
    expect(a.users).toBe(0);
    expect(a.problems.join('')).toContain('一个人都没解出来');
  });
});

describe('⭐ 覆盖率只报事实', () => {
  it('⭐ 不是人人都有位置 → 不该报 100%', () => {
    const a = auditUserPayload(payload([
      person(0, { legacy: { screen_name: 'a', location: '北京' } }),
      person(1),
    ]));
    expect(a.coverage.位置, '位置报成 100% —— 「不量的字段永远 100%」的反面').toBeLessThan(100);
  });
});

/**
 * ⭐⭐⭐ **名字用 X 的词** —— 用户 2026-10-05:「人,就是 x 的用户呀」
 *
 * ⚠️⚠️ 这是**第二次**:2026-10-04 刚把 `iFollow`/`followsMe` 改成
 * X 的 `following`/`followedBy`,转头我又写了 `Person`/`people` ——
 * 而载荷里的原词全是 **user**(`user_results` / `UserCell` / `screen_name`)。
 * ⭐ 少一层翻译就少一层漂移;自造的词还会让人以为是**另一个实体**。
 */
describe('⭐⭐⭐ 用 X 的词,不自造', () => {
  const SRC = readFileSync(
    join(__dirname, '..', '..', 'src/modules/x/x-user-audit.ts'),
    'utf-8',
  );
  /** ⚠️ 剥注释 —— 注释里要解释「原先叫 Person」,不该被判违规 */
  const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

  it('⭐⭐⭐ 代码里不许出现自造的 Person / people', () => {
    expect(
      CODE,
      '又用自造的词了 —— X 的原词是 user（user_results / UserCell）',
    ).not.toMatch(/\bPerson\b|\bpeople\b/i);
  });

  it('⭐⭐ 导出的名字都带 user', () => {
    const exported = [...CODE.matchAll(/export (?:type|function) (\w+)/g)].map((m) => m[1]);
    expect(exported.length, '一个导出都没解析到 —— 本条要重写').toBeGreaterThan(1);
    for (const n of exported) {
      expect(n, `导出 ${n} 没带 user —— 名字要对得上它描述的那件事`).toMatch(/User/i);
    }
  });

  /**
   * ⭐⭐ **实体归一**:follower 和「推文作者」是同一个东西 ——
   * 一个 X 用户,两种发现途径。所以不建新表,落到已有的 `x_author`。
   */
  it('⭐⭐ 文件头要写明「落到 x_author,不建新表」', () => {
    expect(
      SRC,
      '没说清落到哪 —— 下一个人会以为要新建一张 user 表，于是同一个实体两张表',
    ).toContain('x_author');
  });
});

/**
 * ⭐⭐⭐ **整列为 0 要喊出来** —— 用户 2026-10-05:
 * 「人有哪些数据?**要先观察清楚**,不要数据都采不齐呢。」
 */
describe('采不齐要喊,不要默默算个覆盖率', () => {
  /** ⭐ 只有 core/profile_bio 的新结构 —— 真机现在就是这样 */
  const newShape = (i: number): unknown => ({
    entryId: `user-${i}`,
    content: { itemContent: { user_results: { result: {
      rest_id: `${900 + i}`,
      core: { screen_name: `user${i}`, name: `名字${i}` },
      profile_bio: { description: `bio ${i}` },
      avatar: { image_url: `https://pbs/av${i}.jpg` },
      /** ⚠️ legacy 在,但**不带**计数/地点/注册时间 */
      legacy: {},
    } } } },
  });
  const pack = (entries: unknown[]): string => JSON.stringify({
    data: { user: { result: { timeline: { timeline: {
      instructions: [{ type: 'TimelineAddEntries', entries }],
    } } } } },
  });

  it('⭐⭐⭐ 粉丝数整列空 → problems 里必须有话', () => {
    const r = auditUserPayload(pack([newShape(1), newShape(2), newShape(3)]));
    expect(r.users).toBe(3);
    /** ⭐ 人是解出来了的 —— 不是「解析失败」,是「字段缺了」 */
    expect(r.items[0].handle).toBe('user1');
    const joined = r.problems.join(' ');
    expect(joined, '粉丝数 0/3 却一句话都不说 = 量了等于没量').toContain('粉丝数');
    expect(joined).toContain('地点');
    expect(joined).toContain('注册时间');
  });

  it('⭐⭐⭐ 零星缺失**不许**报警 —— 「有人没填」是正常的', () => {
    /**
     * ⚠️ 判据太宽会被无视,那是另一种假绿
     * (`feedback-guard-caught-what-tsc-cannot`:不误伤样本也要钉)。
     */
    const withCounts = (i: number): unknown => ({
      entryId: `user-${i}`,
      content: { itemContent: { user_results: { result: {
        rest_id: `${900 + i}`,
        core: { screen_name: `user${i}`, name: `名字${i}` },
        legacy: {
          followers_count: 10 + i, friends_count: 5, statuses_count: 7,
          created_at: 'Fri Oct 03 10:00:00 +0000 2026',
          /** ⭐ 只有第 1 个人填了地点 —— 这是**正常**的零星缺失 */
          location: i === 1 ? '北京' : '',
        },
      } } } },
    });
    const r = auditUserPayload(pack([withCounts(1), withCounts(2), withCounts(3)]));
    const joined = r.problems.join(' ');
    expect(joined, '有一个人填了地点就不该报「整列空」').not.toContain('地点');
    expect(joined).not.toContain('粉丝数');
  });

  it('⭐⭐ 一个人都没解出来时不该再刷一堆「整列空」', () => {
    /** ⚠️ 那只会把真正的问题(载荷不对)淹掉 */
    const r = auditUserPayload(pack([]));
    expect(r.users).toBe(0);
    expect(r.problems.join(' ')).toContain('一个人都没解出来');
    expect(r.problems.filter((p) => p.includes('整列空'))).toHaveLength(0);
  });
});

/**
 * ⭐⭐⭐ **拿真载荷钉** —— 2026-10-05 从真机 `Following` 响应取下来的样本
 * (`tests/fixtures/x-user-following-real.json`,只换了 handle/名字/头像,
 * **结构一个键都没动**)。
 *
 * ⚠️⚠️ 为什么非要真样本:我手写的假样本一直在造 `legacy.followers_count`,
 * 而真载荷里**根本没有 `legacy` 这个键** —— X 已经把字段全搬进带类型的
 * 子对象。于是粉丝数/关注数/地点/注册时间**整列空采了三跑**,
 * 测试却一路全绿:**我的样本里有那个字段,真实数据里没有**。
 * ⭐ 正是 `feedback-check-sample-contains-phenomenon` 的反向版:
 * 别拿**含有某现象的**假样本,去论证真实数据里也有。
 */
describe('真载荷:X 现在到底给哪些字段', () => {
  const real = readFileSync(
    join(process.cwd(), 'tests/fixtures/x-user-following-real.json'), 'utf8',
  );

  it('⭐⭐⭐ legacy 已经不存在了 —— 样本自己作证', () => {
    /** ⚠️ 这条钉的是**事实本身**:哪天 X 把 legacy 加回来,它会红,那是好事 */
    const d = JSON.parse(real) as Record<string, unknown>;
    const s = JSON.stringify(d);
    expect(s).not.toContain('"legacy"');
    expect(s, '新结构的标志').toContain('relationship_counts');
  });

  it('⭐⭐⭐ 四个「曾经整列空」的字段,现在都解得出来', () => {
    const r = auditUserPayload(real);
    expect(r.users).toBe(2);
    const u = r.items[0];
    expect(u.followersCount, '粉丝数 ← relationship_counts.followers').toBe(1874);
    expect(u.followingCount, '关注数 ← relationship_counts.following').toBe(2096);
    expect(u.statusesCount, '推文数 ← tweet_counts.tweets').toBeGreaterThan(0);
    expect(u.createdAt, '注册时间 ← core.created_at').toBeTruthy();
  });

  it('⭐⭐ 新发现的字段也收下 —— 媒体数/网站/认证/受保护', () => {
    const r = auditUserPayload(real);
    const u = r.items[0];
    expect(u.mediaCount, '媒体推文数 ← tweet_counts.media_tweets').toBeGreaterThanOrEqual(0);
    expect(typeof u.isVerified, '认证 ← verification.verified(与蓝V不是一回事)')
      .toBe('boolean');
    expect(typeof u.isProtected, '受保护 ← privacy.protected').toBe('boolean');
  });

  it('⭐⭐⭐ 真载荷下不许再报「整列空」', () => {
    /**
     * ⭐ 这条把上面那套报警和真实数据接在一起:
     * 报警该在**字段路径错**时响,不该在正常数据上响。
     */
    const r = auditUserPayload(real);
    const joined = r.problems.join(' ');
    expect(joined).not.toContain('粉丝数');
    expect(joined).not.toContain('关注数');
    expect(joined).not.toContain('注册时间');
  });

  it('⭐⭐ 关系方向两边都解得出', () => {
    const r = auditUserPayload(real);
    const u = r.items[0];
    expect(typeof u.following, '我关注他').toBe('boolean');
    expect(typeof u.followedBy, '他关注我').toBe('boolean');
  });
});
