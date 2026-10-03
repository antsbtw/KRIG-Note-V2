/**
 * ⭐ X 语义页面表 —— 行为测试(纯逻辑,真跑)
 *
 * ⚠️ 不是源码扫描:`toMatch(/extractTweetId/)` 遇上
 * `void 0 && extractTweetId(...)` 会全绿(文本在、行为没了)——
 * 见 `feedback-source-scan-cant-see-execution`。
 */
import { describe, it, expect } from 'vitest';
import { extractTweetId, xPageResolver, PAGE_PARAMS , X_TIMELINE_ENDPOINTS, X_NOISY_URLS , X_PAGE_MATCHERS, X_PAGE_NAME, isTimelineOp } from '@modules/x/x-pages';

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

describe('页面上没推文的:到位判据不能等推文', () => {
  /**
   * ⚠️⚠️ 这些页上**没有推文卡片** —— 用 `byUrlAndTweets` 会必然超时。
   * ⭐ 判据直接查 arrival 的结构,不查字符串。
   *
   * ⚠️ 2026-10-03 加 `x.article`:长文单篇页是**一篇文章**,
   * 同样没有 `[data-testid="tweet"]`,犯的是同一个错。
   */
  const NO_TWEET_PAGES: ReadonlyArray<[string, Record<string, string>]> = [
    ['x.followers', { handle: 'elonmusk' }],
    ['x.verifiedFollowers', { handle: 'elonmusk' }],
    ['x.following', { handle: 'elonmusk' }],
    ['x.article', { articleId: '2105111183481266176' }],
  ];
  for (const [name, params] of NO_TWEET_PAGES) {
    it(`⭐ ${name} 的到位判据不含「有推文」`, () => {
      const r = xPageResolver.resolve(name, params);
      expect(r, `${name} resolve 不出来`).not.toBeNull();
      const json = JSON.stringify(r!.arrival);
      expect(json, `${name} 在等推文锚点 —— 这页没推文,会必然超时`)
        .not.toContain('tweetArticle');
      expect(json, `${name} 的判据该比 URL`).toContain('urlIncludes');
    });
  }
});

/**
 * ⭐⭐⭐ 单篇长文页 —— 2026-10-03
 *
 * 真机 @KA594594 40 条里 **38 条是长文**,正文全不在列表页。
 * 地址**就在列表页载荷里**(`entities.urls[].expanded_url`,38/38 全配上),
 * 所以这一页存在的意义是:编排层拿到 articleUrl 直接 goto,不用点卡片。
 */
describe('⭐⭐⭐ x.article:单篇长文', () => {
  it('⭐⭐ 裸 id → 拼出 /i/article/<id>', () => {
    const r = xPageResolver.resolve('x.article', { articleId: '2105111183481266176' });
    expect(r?.url).toBe('https://x.com/i/article/2105111183481266176');
  });

  /**
   * ⭐ 人手上有的是**链接**(载荷里给的就是整条 URL)——
   * 让调用方先把 id 抠出来是把代码该做的事推出去(用户 2026-10-02)。
   */
  it('⭐⭐ 粘整条长文链接也认 —— 不要求先抠 id', () => {
    const r = xPageResolver.resolve('x.article', {
      articleId: 'https://x.com/i/article/2105111183481266176',
    });
    expect(r?.url, '粘链接拼不出来 —— 会得到 /i/article/https://… 这种不存在的页')
      .toBe('https://x.com/i/article/2105111183481266176');
  });

  it('⚠️ 取不出 id → 返回 null,**不拿原值硬拼**', () => {
    expect(xPageResolver.resolve('x.article', { articleId: 'elonmusk' }), '硬拼了一个不存在的页')
      .toBeNull();
    expect(xPageResolver.resolve('x.article', { articleId: '' })).toBeNull();
  });

  it('⭐⭐ 反向 identify 认得出,且与正向往返一致', () => {
    const url = 'https://x.com/i/article/2105111183481266176';
    const got = xPageResolver.identify?.(url);
    expect(got?.name, '长文页反向认不出 —— 正反两面漂了').toBe('x.article');
    expect(got?.params.articleId).toBe('2105111183481266176');
    // ⭐ 往返:identify 出来的参数再 resolve 回去,必须是同一个 URL
    expect(xPageResolver.resolve('x.article', got!.params)?.url).toBe(url);
  });

  /**
   * ⚠️⚠️ 两者都走 `/i/...`,判据顺序错就会**互相吃掉**。
   * 当前靠 STATUS_PATH 要求 `/status/` 才没撞上 —— 那是碰巧,所以钉住。
   */
  it('⚠️⚠️ 长文页与推文页不许互相吃掉', () => {
    expect(xPageResolver.identify?.('https://x.com/i/status/123')?.name)
      .toBe('x.status');
    expect(xPageResolver.identify?.('https://x.com/i/article/456')?.name)
      .toBe('x.article');
  });

  /**
   * ⭐⭐ 常量必须指向**真登记的页** —— 否则只是把漂移挪了个地方:
   * 面板点下去会得到「没登记这一页」,而 tsc 全绿。
   */
  it('⭐⭐ X_PAGE_NAME 里的名字在页面表里真存在', () => {
    const names = xPageResolver.names?.() ?? [];
    expect(names.length, '页面表空了 —— 下面的断言会空转').toBeGreaterThan(4);
    for (const [key, name] of Object.entries(X_PAGE_NAME)) {
      expect(names, `X_PAGE_NAME.${key} = '${name}' 不在页面表里 —— 点下去会说没登记`)
        .toContain(name);
    }
  });

  it('⚠️ articleId **不等于**推文 id —— 别拿推文 id 拼长文页', () => {
    /**
     * 真机实测 5/5 都不同(推文 2105111536603959409 ↔ 长文 2105111183481266176)。
     * 这条钉的是**文档性事实**:若将来有人以为能推导,这里会提醒他。
     */
    const tweetId = '2105111536603959409';
    const articleId = '2105111183481266176';
    expect(articleId, '两者若相同,「必须从载荷取」的理由就不成立了').not.toBe(tweetId);
  });
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

/**
 * ⭐⭐ 采集判据:**要什么** 与 **不要什么**
 *
 * ── 2026-10-02 实测逼出来的 ──
 * 滚 10 轮采到 59 条,**52 条是视频分片**(最大 1299KB,合计约 15MB)。
 * 两个后果:
 * ① 把 `CaptureSession` 的 64 条容量挤爆 —— `HomeTimeline` 存不下
 * ② 判据 `'/i/api/graphql/'` **太宽**,`ViewerBadgeCounts`(0.2KB 角标)
 *    被当成「时间线载荷」→ 核对报告说「1 页 · 0 条推文」,
 *    而真相是**那根本不是时间线**
 */
describe('⭐⭐ 采集判据', () => {
  it('⭐⭐⭐ 时间线端点按**操作名**认,不是「所有 graphql」', () => {
    /**
     * ⚠️ 用 `'/i/api/graphql/'` 的话,这些**全部**会被当成时间线:
     * ViewerBadgeCounts / DataSaverMode / getAltTextPromptPreference …
     * 于是报告说「采到 1 页」而那页解出 0 条推文 —— **误导**。
     */
    const notTimeline = [
      'https://x.com/i/api/graphql/abc/ViewerBadgeCounts?variables=%7B%7D',
      'https://x.com/i/api/graphql/abc/DataSaverMode',
      'https://x.com/i/api/graphql/abc/getAltTextPromptPreference',
      'https://x.com/i/api/graphql/abc/PinnedTimelines',
      'https://x.com/i/api/graphql/abc/CreatorStudioTabBarItemQuery',
    ];
    for (const u of notTimeline) {
      expect(
        X_TIMELINE_ENDPOINTS.some((e) => u.includes(e)),
        `「${u.split('/').pop()}」不是时间线,却被判成了时间线载荷`,
      ).toBe(false);
    }
  });

  it('⭐⭐ 真正的时间线端点要认得出来', () => {
    /** ⚠️ 反向锁:上一条光有「别认错」会被一个「什么都不认」的清单满足 */
    const timeline = [
      'https://x.com/i/api/graphql/abc/HomeTimeline',
      'https://x.com/i/api/graphql/abc/UserTweets',
      'https://x.com/i/api/graphql/abc/SearchTimeline',
      'https://x.com/i/api/graphql/abc/TweetDetail',
      'https://x.com/i/api/graphql/abc/Followers',
    ];
    for (const u of timeline) {
      expect(
        X_TIMELINE_ENDPOINTS.some((e) => u.includes(e)),
        `「${u.split('/').pop()}」是时间线却没认出来 —— 会漏采`,
      ).toBe(true);
    }
  });

  it('⭐⭐⭐ 噪音名单挡住视频/图片,**不挡 API**', () => {
    /**
     * ⚠️ 挡错了是**静默丢数据**,比多采几条坏得多 ——
     * 所以反向那条(不许挡住 API)比正向更要紧。
     */
    const shouldBlock = [
      'https://video.twimg.com/amplify_video/123/vid/avc1/x.m4s',
      'https://video.twimg.com/a/b.m3u8',
      'https://pbs.twimg.com/profile_images/1/a.jpg',
      'https://abs.twimg.com/responsive-web/client-web/main.js',
    ];
    for (const u of shouldBlock) {
      expect(X_NOISY_URLS.some((n) => u.includes(n)), `没挡住噪音：${u}`).toBe(true);
    }

    const mustNotBlock = [
      'https://x.com/i/api/graphql/abc/HomeTimeline',
      'https://x.com/i/api/graphql/abc/UserTweets',
      'https://x.com/i/api/1.1/flow/timeline.json',
      'https://api.x.com/1.1/account/settings.json',
    ];
    for (const u of mustNotBlock) {
      expect(
        X_NOISY_URLS.some((n) => u.includes(n)),
        `⚠️ 把 API 挡掉了 —— 这是**静默丢数据**：${u}`,
      ).toBe(false);
    }
  });

  it('⚠️ 噪音名单与时间线端点**不许重叠** —— 否则自相矛盾', () => {
    /** ⭐ 一个 URL 既「要」又「不要」时,行为取决于判断顺序 —— 那是定时炸弹 */
    for (const t of X_TIMELINE_ENDPOINTS) {
      for (const n of X_NOISY_URLS) {
        expect(
          t.includes(n) || n.includes(t),
          `端点「${t}」与噪音「${n}」重叠 —— 要不要采取决于判断顺序`,
        ).toBe(false);
      }
    }
  });
});

/**
 * ⭐⭐⭐ 端点判据要**抗 X 改版** —— 2026-10-03 实测踩到
 *
 * 去 `x.com/KA594594`(个人主页)采集:滚了 60 轮 44621px、每轮都展开,
 * 结果**采到 0 页** —— 而留痕里明明有 `UserOriginalsTimeline` 2 条。
 *
 * ⭐ 真因:清单是从**旧实现**抄的,而 **X 改版了** ——
 * 个人主页现在用 `UserOriginalsTimeline`,不是 `UserTweets`。
 * ⚠️ `feedback-search-community-before-sixth-guess`:
 * **平台侧改动不可能从自家代码推断出来**。
 */
describe('⭐⭐⭐ 端点判据抗改版', () => {
  it('⭐⭐⭐ 凡是 `*Timeline` 都认 —— 包括**没见过的**新名字', () => {
    /**
     * ⭐ 这一条是全文件最要紧的:写死清单在平台改版时**静默失效**
     * (采到 0 页,而数据就在眼前)。
     */
    const neverSeen = [
      'https://x.com/i/api/graphql/abc/UserOriginalsTimeline',   // ← 这次漏掉的那个
      'https://x.com/i/api/graphql/abc/SomeBrandNewTimeline',    // ← 将来可能出现的
      'https://x.com/i/api/graphql/abc/CommunityTweetsTimeline',
    ];
    for (const u of neverSeen) {
      expect(isTimelineOp(u), `「${u.split('/').pop()}」没认出来 —— 改版就会静默采 0 页`)
        .toBe(true);
    }
  });

  it('⭐⭐ 但 `PinnedTimelines` **不算** —— 实测 0 条推文', () => {
    /** ⚠️ 它是「置顶时间线**列表**」(导航用),38.7KB 里只有 15 个用户 */
    expect(
      isTimelineOp('https://x.com/i/api/graphql/abc/PinnedTimelines'),
      'PinnedTimelines 被当成了推文数据 —— 会报「采到 N 页」而实际 0 条推文',
    ).toBe(false);
  });

  it('⭐ 不以 Timeline 结尾的那些仍要认(精确名)', () => {
    for (const u of [
      'https://x.com/i/api/graphql/abc/TweetDetail',
      'https://x.com/i/api/graphql/abc/Followers',
      'https://x.com/i/api/graphql/abc/UserArticlesTweets',
    ]) {
      expect(isTimelineOp(u), `「${u.split('/').pop()}」漏了`).toBe(true);
    }
  });

  it('⭐⭐ 杂项 GraphQL **一律不认**(反向锁)', () => {
    /** ⚠️ 光有「别漏」会被一个「什么都认」的实现满足 —— 那更坏 */
    for (const u of [
      'https://x.com/i/api/graphql/abc/ViewerBadgeCounts',
      'https://x.com/i/api/graphql/abc/UserByScreenName',
      'https://x.com/i/api/graphql/abc/ProfileSpotlightsQuery',
      'https://x.com/i/api/graphql/abc/CommunitiesFetchOneQuery',
      'https://x.com/i/api/graphql/abc/UserSportsProfile',
      'https://x.com/i/api/1.1/jot/client_event.json',
    ]) {
      expect(isTimelineOp(u), `「${u.split('/').pop()}」被误判成时间线`).toBe(false);
    }
  });

  it('⭐⭐ 传给底座的判据(字符串形式)与 `isTimelineOp` **口径一致**', () => {
    /**
     * ⚠️ 两份判据必漂 —— 漂的表现是「底座说采到 3 页,而核对只认出 1 页」。
     * ⭐ 这里拿同一批样本跑两边,结果必须相同。
     */
    const match = (url: string): boolean => X_PAGE_MATCHERS.some((w) => (w.startsWith('re:')
      ? new RegExp(w.slice(3)).test(url)
      : url.includes(w)));

    const samples = [
      'https://x.com/i/api/graphql/abc/HomeTimeline',
      'https://x.com/i/api/graphql/abc/UserOriginalsTimeline',
      'https://x.com/i/api/graphql/abc/PinnedTimelines',
      'https://x.com/i/api/graphql/abc/ViewerBadgeCounts',
      'https://x.com/i/api/graphql/abc/TweetDetail',
      'https://x.com/i/api/graphql/abc/Followers',
      'https://video.twimg.com/a.m4s',
    ];
    for (const u of samples) {
      expect(match(u), `两套判据对「${u.split('/').pop()}」说法不一致`).toBe(isTimelineOp(u));
    }
  });

  it('⚠️ 正则写错时不该崩 —— 底座会忽略并告警', () => {
    /** ⭐ 判据本身出错不该让整轮采集作废 */
    expect(() => X_PAGE_MATCHERS.forEach((w) => {
      if (w.startsWith('re:')) new RegExp(w.slice(3));
    }), '导出的判据里有非法正则').not.toThrow();
  });
});
