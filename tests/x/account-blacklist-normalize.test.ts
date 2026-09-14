/**
 * 屏蔽名单归一化契约(B 期)—— 守的是一个**会静默失效**的缺陷。
 *
 * 背景(实测 2026-09-01,查 krig_x.x_tweet):
 *   库里 author_handle 的实际形态是 '@Miekko22' —— 带 @ 前缀、保留原始大小写。
 *   而 x_author.handle 上有 idx_author_handle UNIQUE 索引,必须归一化后再存,
 *   否则 Foo/foo 会成两行,同一个人被屏蔽两次只生效一次。
 *
 * 缺陷形态:写库归一化('miekko22')、比对却用原始串('@Miekko22')去 includes
 *   → 永远 false → **屏蔽点了没反应,而且不报错**。
 *
 * 本测试钉死的不变量:
 *   applyFilter 的比对端与 getBlockedHandleSet 的写入端**共用 normalizeHandle**。
 *   任一端漏掉归一化,下面第一条用例必须变红。
 */
import { describe, it, expect } from 'vitest';
import { applyFilter } from '@platform/main/x/x-timeline-scan';
import { normalizeHandle, DEFAULT_FILTER_CONFIG } from '@shared/types/x-timeline-types';
import type { XTweetData } from '@platform/main/x/x-extract-tweet';

/** 造一条推:handle 用库里的真实形态(带 @、原始大小写) */
function tweet(authorHandle: string, tweetId = 't1'): XTweetData {
  return {
    tweetId,
    text: 'hello',
    authorHandle,
    authorName: 'X',
    metrics: { likes: 0, retweets: 0 },
  } as XTweetData;
}

/** 黑名单按契约存归一化形态 —— 与 getBlockedHandleSet 返回值同源 */
function configWithBlocked(handles: string[]) {
  return { ...DEFAULT_FILTER_CONFIG, accountBlacklist: handles.map(normalizeHandle) };
}

describe('normalizeHandle', () => {
  it('去 @ 前缀 + 转小写', () => {
    expect(normalizeHandle('@Miekko22')).toBe('miekko22');
    expect(normalizeHandle('Miekko22')).toBe('miekko22');
    expect(normalizeHandle('  @MIEKKO22  ')).toBe('miekko22');
  });

  it('幂等 —— 已归一化的再过一次不变(repo 入参可能来自任一端)', () => {
    expect(normalizeHandle(normalizeHandle('@Miekko22'))).toBe('miekko22');
  });
});

describe('applyFilter 账号黑名单', () => {
  it('⭐核心:库里的 @Miekko22 能被归一化黑名单命中', () => {
    // 这条就是反向注入的靶子:把 applyFilter 里的 normalizeHandle 去掉,它必须变红
    const { pass, reason } = applyFilter(
      tweet('@Miekko22'),
      configWithBlocked(['@Miekko22']),
      new Set(),
    );
    expect(pass).toBe(false);
    expect(reason).toBe('account_blacklist');
  });

  it('大小写不同也命中(UI 输入 miekko22,库里是 @Miekko22)', () => {
    const { pass, reason } = applyFilter(
      tweet('@Miekko22'),
      configWithBlocked(['miekko22']),
      new Set(),
    );
    expect(pass).toBe(false);
    expect(reason).toBe('account_blacklist');
  });

  it('未屏蔽的人正常放行 —— 守卫不能宽到误伤', () => {
    const { pass } = applyFilter(
      tweet('@someoneElse'),
      configWithBlocked(['@Miekko22']),
      new Set(),
    );
    expect(pass).toBe(true);
  });

  it('空黑名单不拦任何人', () => {
    const { pass } = applyFilter(tweet('@Miekko22'), configWithBlocked([]), new Set());
    expect(pass).toBe(true);
  });

  it('authorHandle 缺失不误判成"空串在黑名单里"', () => {
    const t = { tweetId: 't9', text: 'x', metrics: { likes: 0, retweets: 0 } } as XTweetData;
    const { pass } = applyFilter(t, configWithBlocked(['@Miekko22']), new Set());
    expect(pass).toBe(true);
  });
});
