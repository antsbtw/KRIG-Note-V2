/**
 * ⭐⭐ 语义页面**反向解析** —— 真调函数
 *
 * ── 用户 2026-09-18 ──
 *
 * > 「跟着左边走,则是一种操作习惯,对吗?
 * >   应该是点击左边时,右边自动填充变量,点击采集,即可采集。」
 *
 * 下拉与参数框照样在(编排时要用),只是**值可以从当前页面自动来**。
 * 这需要 URL → 语义名 + 参数的反向解析。
 *
 * ⚠️ 最危险的是**认错**:把 `/settings` 认成「一个叫 settings 的人的主页」,
 * 然后采集跑到那儿去 —— 而现象是「采到 0 条」,指向完全错误的方向。
 * 所以 X 自己的路由必须排除,认不出来就返回 null,**绝不猜**。
 */
import { describe, it, expect } from 'vitest';
import { XPageResolver } from '@platform/main/x/x-pages';

const r = new XPageResolver();
const id = (url: string) => r.identify(url);

describe('⭐⭐ 认得出常见页面', () => {
  it('⭐ 首页 / 通知', () => {
    expect(id('https://x.com/home')).toEqual({ name: 'x.home', params: {} });
    expect(id('https://x.com/notifications')).toEqual({ name: 'x.notifications', params: {} });
  });

  it('⭐⭐ 某人主页 → 带出 handle(这是「跟着左边走」的主场景)', () => {
    expect(id('https://x.com/somebody')).toEqual({
      name: 'x.profile', params: { handle: 'somebody' },
    });
  });

  it('⭐⭐ 关注者 / 验证关注者 / 关注中 —— 人的列表页', () => {
    /**
     * 用户 2026-09-18 在 x.com/OTun_MyVPN/verified_followers 上点采集,
     * 面板说「认不出左边这个页面」—— 因为这三页**根本没登记**。
     *
     * ⚠️ 登记 ≠ 能采:这几页的载荷是 Followers/Following(人的列表),
     * 而 extractTweetsFrom 只认推文对象,会整个跳过。
     * 「采人」是另一种采集类型,先让页面认得出。
     */
    expect(id('https://x.com/somebody/followers')).toEqual({
      name: 'x.followers', params: { handle: 'somebody' },
    });
    expect(id('https://x.com/somebody/verified_followers')).toEqual({
      name: 'x.verifiedFollowers', params: { handle: 'somebody' },
    });
    expect(id('https://x.com/somebody/following')).toEqual({
      name: 'x.following', params: { handle: 'somebody' },
    });
  });

  it('⭐ 推文与回复 / 文章列表', () => {
    expect(id('https://x.com/somebody/with_replies')).toEqual({
      name: 'x.withReplies', params: { handle: 'somebody' },
    });
    expect(id('https://x.com/somebody/articles')).toEqual({
      name: 'x.articles', params: { handle: 'somebody' },
    });
  });

  it('⭐ 单条推文 → handle + tweetId 都带出来', () => {
    expect(id('https://x.com/somebody/status/1934567890123')).toEqual({
      name: 'x.status', params: { handle: 'somebody', tweetId: '1934567890123' },
    });
  });

  it('⭐ 搜索 → 带出搜索词与 f', () => {
    expect(id('https://x.com/search?q=%E6%9C%BA%E5%9C%BA&f=live')).toEqual({
      name: 'x.search', params: { q: '机场', f: 'live' },
    });
  });

  it('⭐ 末尾斜杠不影响', () => {
    expect(id('https://x.com/home/')?.name).toBe('x.home');
    expect(id('https://x.com/somebody/')?.name).toBe('x.profile');
  });

  it('⭐ twitter.com 同样认(X 改名前的域)', () => {
    expect(id('https://twitter.com/somebody')?.name).toBe('x.profile');
  });
});

describe('⭐⭐ 认不出来就返回 null —— 绝不猜', () => {
  it('⭐⭐ X 自己的路由不许被认成「某人主页」', () => {
    /**
     * 把 /settings 认成「一个叫 settings 的人」,采集就会跑到设置页去,
     * 而现象是「采到 0 条」—— 指向完全错误的排查方向。
     */
    for (const path of [
      '/explore', '/settings', '/messages', '/bookmarks', '/lists',
      '/communities', '/jobs', '/premium', '/i', '/login', '/tos',
    ]) {
      expect(
        id(`https://x.com${path}`),
        `${path} 被认成了某人主页 —— 采集会跑到那儿去`,
      ).toBeNull();
    }
  });

  it('⭐⭐ 别的站点一律不认', () => {
    expect(id('https://example.com/somebody')).toBeNull();
    expect(id('https://fake-x.com/somebody')).toBeNull();
    // ⚠️ 子域要认(mobile.x.com),但同名后缀不认
    expect(id('https://notx.com/somebody')).toBeNull();
  });

  it('⭐ 空搜索词不认(采了也没意义)', () => {
    expect(id('https://x.com/search')).toBeNull();
    expect(id('https://x.com/search?f=live')).toBeNull();
  });

  it('⭐ 坏 URL 不抛异常,返回 null', () => {
    expect(id('not-a-url')).toBeNull();
    expect(id('')).toBeNull();
  });

  it('⭐ 深层路径不认(/a/b/c 不是已知形状)', () => {
    expect(id('https://x.com/somebody/status/123/photo/1')).toBeNull();
    expect(id('https://x.com/i/grok')).toBeNull();
  });
});

describe('⭐⭐ 正反向必须对得上', () => {
  it('⭐⭐ resolve(identify(url)) 回到同一个 URL', () => {
    /**
     * ⚠️ 正反向两套表会漂,而漂的表现是
     * 「自动填的页面名和实际采的不是同一个」—— 最难查的那种。
     * 这条钉住它们是自洽的。
     */
    for (const url of [
      'https://x.com/home',
      'https://x.com/somebody',
      'https://x.com/somebody/with_replies',
      'https://x.com/somebody/articles',
      'https://x.com/somebody/followers',
      'https://x.com/somebody/verified_followers',
      'https://x.com/somebody/following',
      'https://x.com/notifications',
    ]) {
      const hit = id(url);
      expect(hit, `${url} 认不出来`).not.toBeNull();
      const back = r.resolve(hit!.name, hit!.params);
      expect(back, `${hit!.name} 反解不回去`).not.toBeNull();
      expect(back!.url.replace(/\/$/, ''), `${url} 正反向对不上`).toBe(url.replace(/\/$/, ''));
    }
  });

  it('⭐ identify 认出的每个名字都在 names() 里', () => {
    const known = new Set(r.names());
    for (const url of [
      'https://x.com/home', 'https://x.com/somebody',
      'https://x.com/somebody/status/123', 'https://x.com/search?q=x',
    ]) {
      const hit = id(url);
      if (!hit) continue;
      expect(known.has(hit.name), `identify 认出了未登记的名字 ${hit.name}`).toBe(true);
    }
  });
});
