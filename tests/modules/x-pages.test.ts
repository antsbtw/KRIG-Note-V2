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
