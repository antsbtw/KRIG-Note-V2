/**
 * 守卫:操作按钮不得因 tweet_url 缺失而消失。
 *
 * 起因(用户 2026-09-02 发现):「已确认」翻到第二页后「查看原推」按钮整片不见。
 * 根因不是新 bug —— 是 0 期回填的 616 行只有正文没有 url
 * (能力勘查 §2.3 实测:url 填充率仅 28%),而按钮写了 `t.tweet_url && ...`。
 *
 * url 是**可从 tweet_id 推导**的(X 永久链接 = /<handle>/status/<id>,
 * 已对真实数据核对一致),没有理由让功能因它缺失而消失。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SRC = readFileSync(
  resolve(__dirname, '../../src/views/x-inbox/XInboxView.tsx'), 'utf-8');

describe('tweet_url 缺失不应禁用功能', () => {
  it('⭐ 按钮不得被 t.tweet_url 把关', () => {
    const offenders = [
      ...SRC.matchAll(/\{t\.tweet_url\s*&&[\s\S]{0,80}?<Btn/g),
    ].map((m) => m[0].slice(0, 60));
    expect(
      offenders,
      '按钮又被 tweet_url 把关了 —— 回填数据没有 url,按钮会整片消失。\n'
      + '  用 tweetUrlOf() 从 tweet_id 推导。',
    ).toEqual([]);
  });

  it('存在 tweetUrlOf 推导函数', () => {
    expect(SRC).toContain('const tweetUrlOf');
    expect(SRC).toMatch(/status\/\$\{tweet\.tweet_id\}/);
  });

  it('viewTweet 不得因缺 url 直接 return', () => {
    const fn = SRC.slice(SRC.indexOf('const viewTweet'));
    const body = fn.slice(0, fn.indexOf('\n  };'));
    expect(/if\s*\(!tweet\.tweet_url\)\s*return/.test(body)).toBe(false);
  });
});
