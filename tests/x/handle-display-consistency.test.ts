/**
 * handle 显示形态一致性 —— 守「@@angeelfv」这类双 @ 回归。
 *
 * 背景(实测 2026-09-02):
 *   x_tweet.author_handle 存 '@angeelfv'(带 @),x_author.handle 存 'angeelfv'(归一化)。
 *   两处 UI 模板都写 `@{值}`,喂进去的形态却不同 →
 *   收件箱渲染成 @@angeelfv,屏蔽名单渲染成 @angeelfv,同一个人两个样。
 *
 * 铁律:**模板负责补 @,值一律先过 normalizeHandle**。
 *   任何 `@${...author_handle}` / `@{...author_handle}` 直接插裸值的写法都是 bug。
 *
 * ⚠️ 只管显示:库值形态是历史既成事实,改库会牵动去重/filter_reason 统计,不在此列。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { normalizeHandle } from '@shared/types/x-timeline-types';

const SRC = readFileSync(
  resolve(__dirname, '../../src/views/x-inbox/XInboxView.tsx'),
  'utf-8',
);

describe('handle 显示形态', () => {
  it('归一化后再补 @ 才是单 @ —— 直接插库值必然双 @', () => {
    const dbValue = '@angeelfv';                    // 库里的真实形态
    expect(`@${dbValue}`).toBe('@@angeelfv');        // 错误写法的产物
    expect(`@${normalizeHandle(dbValue)}`).toBe('@angeelfv');  // 正确写法
  });

  it('⭐无任何一处把裸 author_handle 直接插在 @ 后面', () => {
    // 匹配 @{t.author_handle} / @${tweet.author_handle} 这类未经归一化的插值
    const offenders = [
      ...SRC.matchAll(/@\$?\{\s*([A-Za-z_][\w.?\s]*\.author_handle)[^}]*\}/g),
    ].filter((m) => !m[0].includes('normalizeHandle'));

    expect(
      offenders.map((m) => m[0]),
      '发现直接插裸 author_handle 的写法 —— 库值自带 @,会渲染成 @@xxx。\n'
      + '  修法:@{normalizeHandle(值 ?? \'\')},让模板负责补 @。',
    ).toEqual([]);
  });

  it('去 @ 一律走共享 normalizeHandle,不自己写 replace(/^@+/)', () => {
    // 各写一份归一化逻辑迟早漂移 —— 与 B 期屏蔽失效同源的坑
    expect(SRC).not.toMatch(/replace\(\/\^@\+?\//);
  });

  it('屏蔽名单页的值本就归一化,补一个 @ 即可', () => {
    expect(SRC).toContain('@{a.handle}');
    expect(normalizeHandle('angeelfv')).toBe('angeelfv');  // 幂等,补 @ 不会变双 @
  });
});
