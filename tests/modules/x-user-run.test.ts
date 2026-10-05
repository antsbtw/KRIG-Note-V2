/**
 * ⭐⭐⭐ 人流采集编排 —— **行为测试**(不是结构守卫)
 *
 * ⭐ 这个模块的 dep 全是注入的,离线驱得动 ——
 * 所以这里测的是**真的会不会那样跑**,而不是「源码里有没有那个字」。
 * ⚠️ `feedback-source-scan-cant-see-execution`:
 * 源码扫描看不见「会不会执行」(`void 0 && f()` 文本在、行为没了)。
 * 能跑行为测试的地方就不该退回去扫源码。
 */
import { describe, it, expect, vi } from 'vitest';
import { runUserCollect, type UserRunDeps } from '@modules/x/x-user-run';

const FOLLOWERS_URL
  = 'https://x.com/i/api/graphql/abc/Followers?variables=%7B%22userId%22%3A%221%22%7D';

/** ⭐ 照真机形状造一个人 */
const user = (i: number): unknown => ({
  entryId: `user-${i}`,
  content: { itemContent: { user_results: { result: {
    rest_id: `${900 + i}`,
    core: { screen_name: `user${i}`, name: `名字${i}` },
    legacy: { description: `bio ${i}`, followers_count: 10 + i },
  } } } },
});

const payload = (ids: number[], opts: {
  cursor?: string; terminated?: boolean;
} = {}): string => {
  const entries: unknown[] = ids.map(user);
  if (opts.cursor !== undefined) {
    entries.push({
      entryId: 'cursor-bottom',
      content: { cursorType: 'Bottom', value: opts.cursor },
    });
  }
  const instructions: unknown[] = [{ type: 'TimelineAddEntries', entries }];
  if (opts.terminated === true) {
    instructions.push({ type: 'TimelineTerminateTimeline', direction: 'Bottom' });
  }
  return JSON.stringify({
    data: { user: { result: { timeline: { timeline: { instructions } } } } },
  });
};

/** ⭐ 一个会按剧本一页页回的假底座 */
function fakeDeps(pages: string[], over: Partial<UserRunDeps> = {}): UserRunDeps {
  let n = 0;
  return {
    harvest: vi.fn(async () => {
      const text = pages[Math.min(n, pages.length - 1)];
      n += 1;
      return { items: [{ url: FOLLOWERS_URL, text }] };
    }),
    runScript: vi.fn(async () => ({ ok: true })),
    ...over,
  };
}

describe('人流采集编排', () => {
  it('⭐ 首轮采到的人会去重后按名次排好', async () => {
    const r = await runUserCollect(
      fakeDeps([payload([1, 2, 3])]), { listSource: 'followers' },
    );
    expect(r.users.map((u) => u.handle)).toEqual(['user1', 'user2', 'user3']);
    expect(r.users.map((u) => u.seq)).toEqual([0, 1, 2]);
  });

  it('⭐⭐ 同一个人出现两次只算一个', async () => {
    const r = await runUserCollect(
      fakeDeps([payload([1, 2], { cursor: 'c1' }), payload([2, 3])]),
      { listSource: 'followers' },
    );
    expect(r.users).toHaveLength(3);
  });

  it('⭐⭐⭐ 没游标就停 —— 不空转', async () => {
    const r = await runUserCollect(
      fakeDeps([payload([1, 2])]), { listSource: 'followers' },
    );
    expect(r.paging.rounds).toBe(0);
    expect(r.paging.stopReason).toContain('没有下一页游标');
  });

  it('⭐⭐⭐ 游标不变就停(防死循环)', async () => {
    /** ⚠️ 两页给同一个游标 —— 真机上就是「翻不动了」 */
    const r = await runUserCollect(
      fakeDeps([payload([1], { cursor: 'same' }), payload([2], { cursor: 'same' })]),
      { listSource: 'followers' },
    );
    expect(r.paging.stopReason).toContain('游标不再变化');
    /** ⭐ 停之前该翻的那一轮翻到了 —— 不是一上来就停 */
    expect(r.paging.rounds).toBe(1);
    expect(r.users).toHaveLength(2);
  });

  it('⭐⭐⭐ TimelineTerminateTimeline 要停 —— 哪怕还带着游标', async () => {
    /**
     * ⚠️⚠️ 这是人流**独有**的闸:X 翻到底会发它,**但仍附带游标**。
     * 只看游标会在这里一路空转到安全网。
     */
    const r = await runUserCollect(
      fakeDeps([
        payload([1], { cursor: 'c1' }),
        payload([2], { cursor: 'c2', terminated: true }),
      ]),
      { listSource: 'followers' },
    );
    expect(r.paging.terminated).toBe(true);
    expect(r.paging.stopReason).toContain('TimelineTerminateTimeline');
    /**
     * ⭐ 停在第 1 轮之后 —— terminated 是**翻回来的那一页**带的,
     * 下一轮开头就被闸住。
     * ⚠️ 我原先写 2,是把假底座的页序数错了(首轮吃 page[0]、
     * 翻页吃 page[1])—— 错的是期望不是代码。关键两条
     * (terminated / stopReason)当时就已经是对的。
     */
    expect(r.paging.rounds).toBe(1);
    /** ⭐ 而且这一轮采到的人**留着**,不因为停就丢 */
    expect(r.users).toHaveLength(2);
  });

  it('⭐⭐⭐ 「几页没新人」本模块自己不停 —— 那是业务的事', async () => {
    /**
     * ⚠️⚠️ `project-x-cursor-paging` 实测:3 页刹车把 2604 账号
     * **卡死在 2244**、三跑同数,而 X 一直说 hasMore=true。
     * 滚动已采过的人让翻页头几页**天然零新增**。
     * ⭐ 所以:连续 5 轮零新增,照样继续翻,直到数据说到头。
     */
    const pages = [
      payload([1], { cursor: 'c1' }),
      payload([1], { cursor: 'c2' }),
      payload([1], { cursor: 'c3' }),
      payload([1], { cursor: 'c4' }),
      payload([1], { cursor: 'c5' }),
      /** ⭐ 第 6 页才出新人 —— 早停就永远拿不到他 */
      payload([1, 42], { cursor: 'c6', terminated: true }),
    ];
    const r = await runUserCollect(fakeDeps(pages), { listSource: 'followers' });
    expect(r.users.map((u) => u.handle)).toContain('user42');
    expect(r.paging.rounds).toBe(5);
  });

  it('⭐⭐⭐ 判据用「这一页」的新人,不是累计数', async () => {
    /**
     * ⚠️⚠️ `project-x-fast-incremental` 三铁律之一:
     * 累计表里已见过的人**不再出现** → 「已知数」恒为 0 → 条件永不成立。
     * ⭐ 这里验 `freshThisRound` 是**每页独立**的:
     * 第 1 页给新人(fresh>0),第 2 页全是老人(fresh=0)。
     */
    const seen: Array<{ fresh: number; empty: number }> = [];
    await runUserCollect(
      fakeDeps([
        payload([1, 2], { cursor: 'c1' }),
        payload([3], { cursor: 'c2' }),
        payload([3], { cursor: 'c3', terminated: true }),
      ], {
        stopPaging: (s) => {
          seen.push({ fresh: s.freshThisRound, empty: s.emptyRounds });
          return { go: true };
        },
      }),
      { listSource: 'followers' },
    );
    expect(seen[0]).toEqual({ fresh: 1, empty: 0 });
    expect(seen[1]).toEqual({ fresh: 0, empty: 1 });
  });

  it('⭐⭐⭐ 业务说停就停,且停因要原样带出去', async () => {
    const r = await runUserCollect(
      fakeDeps([
        payload([1], { cursor: 'c1' }),
        payload([2], { cursor: 'c2' }),
        payload([3], { cursor: 'c3' }),
      ], {
        stopPaging: (s) => (s.uniqueUsers >= 2
          ? { go: false, why: '够 2 个人了' } : { go: true }),
      }),
      { listSource: 'followers' },
    );
    expect(r.paging.stopReason).toBe('够 2 个人了');
    expect(r.paging.rounds).toBe(1);
  });

  it('⭐⭐⭐ 人点停止要真的停 —— 翻页循环听得见', async () => {
    /**
     * ⚠️⚠️ 用户 2026-10-04:「停止按钮不起作用的,怎么点击停止也不停止?」
     * 真因:「停止」只停得了滚动,而翻页循环是本模块自己的循环,**听不见**。
     */
    let n = 0;
    const r = await runUserCollect(
      fakeDeps([
        payload([1], { cursor: 'c1' }),
        payload([2], { cursor: 'c2' }),
        payload([3], { cursor: 'c3' }),
      ], { cancelled: () => { n += 1; return n > 2; } }),
      { listSource: 'followers' },
    );
    expect(r.paging.stopReason).toBe('人点了停止');
    /** ⭐ 已采到的都留着 —— 喊停不是丢弃 */
    expect(r.users.length).toBeGreaterThan(0);
  });

  it('⭐⭐ 安全网是网不是目标 —— 够大,别拦住人多的号', async () => {
    /**
     * ⚠️ `project-x-followers-2500-ceiling`:所谓「X 天花板 2500」
     * 真因是**滚动轮数不够**,而轮数是人填的目标值。
     * ⭐ 2645 人实测要 ~130 轮,所以安全网必须远大于它。
     */
    const src = (await import('node:fs')).readFileSync(
      'src/modules/x/x-user-run.ts', 'utf8',
    );
    const m = src.match(/USER_PAGING_SAFETY_ROUNDS = (\d+)/);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBeGreaterThanOrEqual(1000);
  });

  it('⭐⭐ 翻页失败不毁整轮 —— 已采到的还在,且说清哪轮坏的', async () => {
    const r = await runUserCollect(
      fakeDeps([payload([1, 2], { cursor: 'c1' })], {
        runScript: vi.fn(async () => { throw new Error('404 空 body'); }),
      }),
      { listSource: 'followers' },
    );
    expect(r.users).toHaveLength(2);
    expect(r.paging.stopReason).toContain('第 1 轮失败');
    expect(r.paging.stopReason).toContain('404 空 body');
  });

  it('⭐⭐ 首轮没响应要说「压根没跑起来」,不是「采到 0 人」', async () => {
    /**
     * ⚠️ 两者混起来就查不动:一个是链路坏,一个是这页真没人
     * (`project-x-collect-needs-scroll`:「采到 0 条」两种成因别混)。
     */
    const r = await runUserCollect(
      { harvest: vi.fn(async () => null) }, { listSource: 'followers' },
    );
    expect(r.users).toHaveLength(0);
    expect(r.problems[0]).toContain('压根没跑起来');
  });

  it('⭐⭐ 没有可翻页的请求要说清楚,不是静默不翻', async () => {
    const r = await runUserCollect({
      harvest: vi.fn(async () => ({ items: [{ url: 'https://x.com/home', text: '{}' }] })),
      runScript: vi.fn(async () => ({})),
    }, { listSource: 'followers' });
    expect(r.paging.stopReason).toContain('没有可用来翻页的请求');
  });

  it('⭐⭐ 解析出的问题要带出去,不许吞', async () => {
    /** ⚠️ 空 handle:解析器报 problems,编排层**汇总带出**,不吞 */
    const bad = JSON.stringify({ data: { user: { result: { timeline: { timeline: {
      instructions: [{ type: 'TimelineAddEntries', entries: [{
        entryId: 'user-x',
        content: { itemContent: { user_results: { result: {
          rest_id: '1', core: { screen_name: '', name: '无名' }, legacy: {},
        } } } },
      }] }],
    } } } } } });
    const r = await runUserCollect(fakeDeps([bad]), { listSource: 'followers' });
    expect(r.problems.length).toBeGreaterThan(0);
    /** ⭐ 而且空 handle 的人不进名单凑数 */
    expect(r.users).toHaveLength(0);
  });

  it('⭐⭐ 翻页新增要与首轮分开记', async () => {
    /**
     * ⚠️ 混在一起看不出「翻页到底带来了多少」——
     * 47 轮只换 40 条新推这种事就是靠这个数看出来的。
     */
    const r = await runUserCollect(
      fakeDeps([
        payload([1, 2], { cursor: 'c1' }),
        payload([3], { cursor: 'c2', terminated: true }),
      ]),
      { listSource: 'followers' },
    );
    expect(r.users).toHaveLength(3);
    expect(r.paging.freshTotal).toBe(1);
  });

  it('⭐⭐ listSource 原样带进结果留痕(进 list_source 的就是它)', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await runUserCollect(fakeDeps([payload([1])]), { listSource: 'verifiedFollowers' });
    expect(log.mock.calls.flat().join(' ')).toContain('verifiedFollowers');
    log.mockRestore();
  });
});
