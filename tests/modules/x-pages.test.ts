/**
 * ⭐ X 语义页面表 —— 行为测试(纯逻辑,真跑)
 *
 * ⚠️ 不是源码扫描:`toMatch(/extractTweetId/)` 遇上
 * `void 0 && extractTweetId(...)` 会全绿(文本在、行为没了)——
 * 见 `feedback-source-scan-cant-see-execution`。
 */
import { describe, it, expect } from 'vitest';
import { extractTweetId, xPageResolver, PAGE_PARAMS } from '@modules/x/x-pages';

describe('⭐⭐ extractTweetId:人粘什么都要能认', () => {
  /**
   * ── 用户 2026-10-02:「应该是推文的链接,而不是 id 号」──
   *
   * ⚠️ 实测踩到:框只收 id 时用户粘了整条链接,
   * 于是拼出 `/i/status/https://x.com/.../status/2105…?s=20` —— 页面不存在,
   * 而报错说成「导航后未到位」,把人指向完全错误的方向。
   */
  it('⭐ 完整链接(带 query)', () => {
    expect(extractTweetId('https://x.com/cxknh5z/status/2105861183614169438?s=20'))
      .toBe('2105861183614169438');
  });

  it('⭐ /i/status/ 形式(X 自己会重写成这种)', () => {
    expect(extractTweetId('https://x.com/i/status/1519480761749016577'))
      .toBe('1519480761749016577');
  });

  it('⭐ 裸 id —— 人也可能只粘数字', () => {
    expect(extractTweetId('1519480761749016577')).toBe('1519480761749016577');
  });

  it('⭐ 不带协议 / 带空格 —— 都是人真会粘的', () => {
    expect(extractTweetId('  x.com/someone/status/123  ')).toBe('123');
  });

  it('⚠️ twitter.com 的老链接也要认', () => {
    expect(extractTweetId('https://twitter.com/someone/status/456')).toBe('456');
  });

  it('⭐⭐ 取不出来返回 **null**,绝不把原值硬拼进 URL', () => {
    /**
     * ⚠️ 这条是真正要守的:硬拼会得到 `/i/status/elonmusk`,
     * 页面当然不存在 —— 而报错会说「没到位」,
     * 让人以为是网络或判据的问题,而不是「填错了」。
     */
    for (const bad of ['elonmusk', '', '   ', 'https://x.com/elonmusk', 'not a url']) {
      expect(extractTweetId(bad), `「${bad}」不该被当成 tweetId`).toBeNull();
    }
  });
});

describe('⭐ x.status 的解析', () => {
  it('⭐ 粘链接也能解析出 URL', () => {
    const r = xPageResolver.resolve('x.status', {
      tweetId: 'https://x.com/cxknh5z/status/2105861183614169438?s=20',
    });
    expect(r, '粘链接解析不出来 —— 用户正是这么用的').not.toBeNull();
    expect(r!.url).toBe('https://x.com/i/status/2105861183614169438');
  });

  it('⭐⭐ 填错(账号名)要返回 null,不许硬拼', () => {
    expect(
      xPageResolver.resolve('x.status', { tweetId: 'elonmusk' }),
      '把账号名硬拼进 status URL 了 —— 会导航到不存在的页面',
    ).toBeNull();
  });

  it('⚠️ 到位判据用 tweetId 不用 handle', () => {
    /**
     * X 会把 `/i/status/` 重写成 `/{真作者}/status/` ——
     * 判 handle 会把「已经到了」误判成「没到位」。
     */
    const r = xPageResolver.resolve('x.status', { tweetId: '123' })!;
    expect(JSON.stringify(r.arrival)).toContain('/status/123');
  });
});

describe('⭐ 页面表与参数表一致', () => {
  it('⭐⭐ 每个登记的页面都要有参数声明 —— 漏一个,面板就不知道该填什么', () => {
    /**
     * ⚠️ 旧实现栽过(同族第五刀):面板写死「哪些页面要 handle」,
     * 新页面不在里面 → 框不显示 → 参数不传 → resolve 返 null。
     * ⭐ 现在参数来自真表,但**表本身也可能漏** —— 本条钉住两者对齐。
     */
    const names = xPageResolver.names?.() ?? [];
    expect(names.length, '一个页面都没登记 —— 守卫在空转').toBeGreaterThan(0);
    const missing = names.filter((n) => !(n in PAGE_PARAMS));
    expect(
      missing,
      '这些页面没在 PAGE_PARAMS 里声明参数 —— 面板不知道该渲染什么输入框:\n  '
      + missing.join('\n  '),
    ).toEqual([]);
  });

  it('⭐ 反过来:参数表里不许有不存在的页面', () => {
    const names = new Set(xPageResolver.names?.() ?? []);
    const stale = Object.keys(PAGE_PARAMS).filter((n) => !names.has(n));
    expect(stale, '参数表里有已删除的页面 —— 清单必须与现实对齐:\n  ' + stale.join('\n  '))
      .toEqual([]);
  });

  it('⭐ 正向与反向认同一个页面(identify 不许漂)', () => {
    /**
     * ⚠️ `identify` 与 `resolve` 必须是**同一张表的两面**:
     * 另写一份会漂,而漂的表现是「自动填的和实际采的不是同一页」。
     */
    const got = xPageResolver.identify?.('https://x.com/cxknh5z/status/2105861183614169438?s=20');
    expect(got?.name).toBe('x.status');
    expect(got?.params.tweetId).toBe('2105861183614169438');
  });
});

/**
 * ⭐⭐ 本轮(2026-10-02)补的 8 页 —— 重点不是 URL 拼得对,
 * 而是**搬过来的实测规则真的生效**。
 *
 * ⚠️ 判据这么定的理由:只测「url 含 /search」那种,
 * 会在规范化/时间窗被删掉后照样绿 —— 而那两条正是实测换来的。
 */
describe('x.search:三条实测规则', () => {
  const url = (p: Record<string, string>): string => {
    const r = xPageResolver.resolve('x.search', p);
    expect(r, `resolve('x.search', ${JSON.stringify(p)}) 返回 null`).not.toBeNull();
    return decodeURIComponent(r!.url);
  };

  it('⭐ 逗号串变 OR,不是一个短语(用户 2026-09-23:94 条全不相干)', () => {
    /**
     * ⚠️ X 把 `VPN,翻墙` 当成**一个短语**且**不报错** ——
     * 「搜的不是你想搜的」与「这个词真没人发」长得一样。
     */
    const u = url({ q: 'VPN,翻墙' });
    expect(u, '逗号串没被规范化成 OR').toContain('("VPN" OR "翻墙")');
    expect(u, '原始逗号串还在 —— 规范化没生效').not.toContain('VPN,翻墙');
  });

  it('⭐ 单词也加引号(避免被分词)', () => {
    expect(url({ q: 'VPN' })).toContain('"VPN"');
  });

  it('⚠️ 已带高级语法的原样放行 —— 不许把人写对的查询改坏', () => {
    for (const q of ['from:elonmusk', '"a" OR "b"', 'VPN lang:zh', 'VPN since:2026-01-01']) {
      const u = url({ q });
      expect(u, `「${q}」被改写了`).toContain(q);
    }
  });

  it('⭐⭐ 默认带时间窗(用户 2026-09-25:一次不超过 24 小时)', () => {
    /**
     * ⚠️ 这一条防的是「手填那套绕开规则」——
     * 配方跑的时候一直有 since:,而手填这条路原来搜的是**全部历史**。
     */
    expect(url({ q: 'VPN' }), '没有 since: —— 会搜全部历史').toMatch(/since:\d{4}-\d{2}-\d{2}/);
  });

  it('⭐ days=0 是逃生口:搜全部历史', () => {
    expect(url({ q: 'VPN', days: '0' }), 'days=0 仍加了时间窗').not.toContain('since:');
  });

  it('⭐⭐ since 盖过 days —— 两个都算会打架且看不出来', () => {
    const u = url({ q: 'VPN', days: '7', since: '2026-09-01' });
    expect(u, 'since 没生效').toContain('since:2026-09-01');
    // ⚠️ 判据:**只有一个** since,不是「含有」—— 叠加了也会含有
    expect(u.match(/since:/g)?.length, '叠了两个 since —— 窗口会比预期窄,而且不报错').toBe(1);
  });

  it('⚠️ 查询自带 since: 时不叠加', () => {
    const u = url({ q: 'VPN since:2026-08-01' });
    expect(u.match(/since:/g)?.length, '人自己写了时间条件,我们又塞了一个').toBe(1);
  });

  it('⭐ f 只认 live/top,乱填退回 live', () => {
    expect(url({ q: 'VPN', f: 'top' })).toContain('f=top');
    expect(url({ q: 'VPN', f: '乱填' }), '乱填的值被原样发给 X 了').toContain('f=live');
  });

  it('⚠️ q 空就返回 null —— 不拿默认值顶上', () => {
    for (const p of [{}, { q: '' }, { q: '   ' }, { q: ',,，' }]) {
      expect(xPageResolver.resolve('x.search', p), `${JSON.stringify(p)} 该返回 null`).toBeNull();
    }
  });

  it('⭐ describe 里显示**最终发出去**的串', () => {
    /** ⚠️ 人要看得见我们真正搜的是什么,不是他填的那个 */
    const r = xPageResolver.resolve('x.search', { q: 'VPN,翻墙' });
    expect(r!.describe, 'describe 没显示规范化后的串').toContain('OR');
  });
});

describe('人的列表页:到位判据不能等推文', () => {
  /**
   * ⚠️⚠️ 这三页上**没有推文** —— 用 `byUrlAndTweets` 会必然超时。
   * ⭐ 判据直接查 arrival 的结构,不查字符串。
   */
  for (const name of ['x.followers', 'x.verifiedFollowers', 'x.following']) {
    it(`⭐ ${name} 的到位判据不含「有推文」`, () => {
      const r = xPageResolver.resolve(name, { handle: 'elonmusk' });
      expect(r, `${name} resolve 不出来`).not.toBeNull();
      const json = JSON.stringify(r!.arrival);
      expect(json, `${name} 在等推文锚点 —— 这几页没推文,会必然超时`)
        .not.toContain('tweetArticle');
      expect(json, `${name} 的判据该比 URL`).toContain('urlIncludes');
    });
  }
});

describe('identify:X 自己的路由不许被认成人', () => {
  /**
   * ⚠️⚠️ 不排除会怎样(旧实现原文):
   * 把「设置页」认成「一个叫 settings 的人的主页」,然后采集跑到那儿去 ——
   * **而现象是「采到 0 条」,指向完全错误的方向**。
   */
  it('⭐ 保留路由一个都不许认成 x.profile', () => {
    const reserved = [
      'settings', 'explore', 'messages', 'bookmarks', 'lists',
      'communities', 'jobs', 'premium', 'login', 'signup', 'tos', 'privacy',
      // ⭐ 这几个是**我们自己登记的页面**占掉的首段 —— 更容易漏
      'search', 'home', 'notifications', 'compose',
    ];
    const wrong = reserved
      .map((seg) => ({ seg, hit: xPageResolver.identify?.(`https://x.com/${seg}`) }))
      .filter((x) => x.hit?.name === 'x.profile');
    expect(
      wrong.map((x) => x.seg),
      '这些 X 自己的路由被认成了「某人的主页」:\n  ' + wrong.map((x) => x.seg).join('\n  '),
    ).toEqual([]);
  });

  it('⭐ 大小写也要挡住', () => {
    expect(xPageResolver.identify?.('https://x.com/Settings')?.name).not.toBe('x.profile');
  });

  it('⚠️ 但真账号名照样认得出 —— 别挡过头', () => {
    expect(xPageResolver.identify?.('https://x.com/elonmusk')?.name).toBe('x.profile');
    // ⭐ 名字里含保留词的账号不该被误挡
    expect(xPageResolver.identify?.('https://x.com/searchbot')?.name).toBe('x.profile');
  });

  it('⭐ 末尾斜杠不影响识别', () => {
    expect(xPageResolver.identify?.('https://x.com/home/')?.name).toBe('x.home');
    expect(xPageResolver.identify?.('https://x.com/elonmusk/')?.name).toBe('x.profile');
  });
});
