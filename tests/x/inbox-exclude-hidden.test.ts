/**
 * queryInbox 隐藏过滤(屏蔽者 / 自己)—— 守跨表 handle 归一化。
 *
 * 守的缺陷:x_tweet.author_handle 存 '@angeelfv'(带 @、原始大小写),
 * x_author.handle 存 'angeelfv'(归一化)。跨表直接比对**恒不命中且不报错**
 * —— 与 B 期 applyFilter 同源的坑,表现是「屏蔽了还显示在面板上」。
 *
 * 本测试钉死:排除条件里必须同时有「转小写」和「去 @」两步。
 * 任一步被删,用例必须变红。
 *
 * ⚠️ 真实 SQL 行为已在活库实测(2026-09-02):
 *    全表 782 → 排除后 769,差 13 = 三个被屏蔽者的历史推文
 *    (@angeelfv 6 / @kidzpod 5 / @ashertogcpd 2),数字对得上。
 *    本测试补的是「表达式不被后人改坏」这一层。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SRC = readFileSync(
  resolve(__dirname, '../../src/platform/main/db/tweet-inbox-repo.ts'),
  'utf-8',
);

/** 抽出排除条件那段 SQL */
function excludeClause(): string {
  const m = SRC.match(/NOT IN[\s\S]{0,200}?is_self = true\)/);
  return m ? m[0] : '';
}

describe('queryInbox 隐藏过滤', () => {
  it('排除条件存在', () => {
    expect(excludeClause()).not.toBe('');
  });

  it('⭐必须转小写 —— 少了则 @Miekko22 类大写 handle 漏网', () => {
    expect(SRC).toContain('string::lowercase(author_handle)');
  });

  it('⭐必须去 @ 前缀 —— 少了则 x_tweet 的 @xxx 永远匹配不上 x_author 的 xxx', () => {
    expect(SRC).toMatch(/string::replace\(\s*string::lowercase\(author_handle\)\s*,\s*'@'/);
  });

  it('屏蔽与自己两类都要排除', () => {
    const clause = excludeClause();
    expect(clause).toContain('blocked = true');
    expect(clause).toContain('is_self = true');
  });

  it('excludeHidden 默认开启(只有显式传 false 才看全量)', () => {
    // 写成 !== false 而非 === true,保证调用方不传时也过滤
    expect(SRC).toContain('opts.excludeHidden !== false');
  });

  it('只过滤不删除 —— 本函数不得出现 DELETE', () => {
    const fn = SRC.slice(SRC.indexOf('export async function queryInbox'));
    const body = fn.slice(0, fn.indexOf('\n}'));
    expect(body).not.toMatch(/\bDELETE\b/);
  });
});
