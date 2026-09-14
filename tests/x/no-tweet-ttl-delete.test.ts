/**
 * 守卫:X 推文不得被 TTL 删除。
 *
 * 用户 2026-09-02 拍板:「永久保存吧。等容量到了一定的程度,再考虑迁移新的架构。」
 *
 * 为什么要守:删除是**不可逆**的,而这类改动很容易被当成"清理垃圾数据"加回来。
 *  · A 期就因 TTL 丢过 449 条已采纳推文的正文(不可再生)
 *  · 被 Gemma 判 skip / 被黑名单过滤的推,是**竞品分析与 AI 语料**素材
 *    ——「有些不显示的帖子不见得没有用途,可以用于分析竞争对手」
 *
 * 将来做容量治理应是**迁移到冷存储**,不是恢复 DELETE。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repo = readFileSync(
  resolve(__dirname, '../../src/platform/main/db/tweet-inbox-repo.ts'), 'utf-8');
const scan = readFileSync(
  resolve(__dirname, '../../src/platform/main/x/x-timeline-scan.ts'), 'utf-8');

describe('X 推文永久保存', () => {
  it('⭐ cleanExpired 不得含 DELETE —— 它已改为 no-op', () => {
    const fn = repo.slice(repo.indexOf('export async function cleanExpired'));
    const body = fn.slice(0, fn.indexOf('\n}'));
    expect(
      /\bDELETE\b/i.test(body),
      'cleanExpired 又出现 DELETE —— X 推文应永久保存。\n'
      + '  容量治理请走冷存储迁移,不要恢复删除。',
    ).toBe(false);
  });

  it('⭐ 采集时不得设 expires_at 的未来时间戳', () => {
    // 原实现:new Date(Date.now() + 7 * 24 * 3_600_000)
    expect(
      /expiresAt\s*=\s*new Date\(Date\.now\(\)\s*\+/.test(scan),
      '采集又开始设 TTL 了 —— expires_at 应保持 undefined(→NONE)',
    ).toBe(false);
  });

  it('全仓不得有针对 x_tweet 的无条件 DELETE', () => {
    const offenders: string[] = [];
    for (const [name, src] of [['tweet-inbox-repo', repo], ['x-timeline-scan', scan]] as const) {
      const m = src.match(/DELETE\s+x_tweet[^`'"]*/gi);
      if (m) offenders.push(`${name}: ${m.join(' | ')}`);
    }
    expect(offenders).toEqual([]);
  });
});
