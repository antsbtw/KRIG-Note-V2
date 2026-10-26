/**
 * ⭐⭐ 一批推文的统计(用户 10-16:「我们需要统计的是采集到的推文数,发推文的用户数,以及用户特征」)
 */
import { describe, it, expect } from 'vitest';
import { capOfOp, saveFnBody } from './_x-ipc-wiring';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { summarizeBatch, statsLine } from '@modules/x/x-batch-stats';
import { detectMutualIntent, evidenceText } from '@modules/x/x-mutual-intent';

describe('summarizeBatch', () => {
  const rows = [
    { id: '1', text: '@a 互关互关', authorRestId: 'A', authorName: 'a', isBlueVerified: true, following: true, followedBy: true },
    { id: '2', text: '今天天气', authorRestId: 'A', authorName: 'a', isBlueVerified: true, following: true, followedBy: true },
    { id: '3', text: '随便', authorRestId: 'B', authorName: '米丽（蓝V互关）', authorBio: '林深见鹿', isBlueVerified: true, following: false, followedBy: false },
    { id: '4', text: '互关必回', authorRestId: 'C', retweetOfId: 'x', isBlueVerified: false, following: true, followedBy: false },
    { id: '5', text: '无作者' },
  ];

  it('⭐ 推文数 / 发推的人数(按数字 id 去重)/ 没 id 的单独数', () => {
    const s = summarizeBatch(rows);
    expect([s.tweets, s.authors, s.noAuthorId]).toEqual([5, 3, 1]);
  });

  it('⭐ 人的特征:蓝V / 有 Bio / 有倾向(名字也算,转发不算)/ 关系分组(用载荷自带的)', () => {
    const s = summarizeBatch(rows);
    expect([s.blue, s.withBio, s.intent]).toEqual([2, 1, 2]);
    expect(s.relation).toEqual({ mutual: 1, iWait: 1, theyWait: 0, none: 1, unknown: 0 });
    expect(statsLine(s)).toContain('推文 5 条 · 发推的人 3 个(另 1 条没作者 id)');
  });
});

describe('显示名也是依据(10-16 真机明细:「米丽（蓝V互关）」「wh（互关版）」)', () => {
  it('Bio 没有、名字有 → 命中,依据记「名字:…」', () => {
    const h = detectMutualIntent('林深见鹿', [], '米丽 （蓝V互关）');
    expect(h).toMatchObject({ hit: true, where: 'name' });
    expect(evidenceText(h as never)).toBe('名字:米丽 （蓝V互关）');
    expect(detectMutualIntent(undefined, [], 'wh（互关版）').hit).toBe(true);
  });
});

describe('接线', () => {
  it('saveTweets 算统计、留痕、回给页面', () => {
    const IPC = readFileSync(join(process.cwd(), 'src/modules/x/x-data-ipc.ts'), 'utf8');
    /** 2026-10-24 存推文搬到 x-save-batch.ts saveTweetBatch(能力 x.tweet.save);IPC 只剩对照表 */
    expect(capOfOp(IPC, 'saveTweets')).toBe('x.tweet.save');
    const body = saveFnBody('saveTweetBatch');
    expect(body.length).toBeGreaterThan(200);
    expect(body).toMatch(/const stats = summarizeBatch\(records\);/);
    expect(body).toMatch(/source: ctx\?\.source \?\? '\(empty\)', stats,/);
    expect(body).toMatch(/return \{ \.\.\.r, stats, statsLine: statsLine\(stats\) \}/);
  });
});

