/**
 * X 加权字数(发推第①期,2026-10-27)—— 确认窗显示的「412 / 280」就是它,算错 = 让人发不出去或白拆推串
 *
 * 规则照 twitter-text v3:拉丁 / 常用标点算 1,中日韩等算 2,emoji(含组合序列)算 2,链接一律算 23。
 */
import { describe, it, expect } from 'vitest';
import { X_POST_LIMIT, xWeightedLength } from '../../src/modules/x/x-post-length';

describe('X 加权字数', () => {
  it('上限是 280', () => expect(X_POST_LIMIT).toBe(280));
  it('英文 / 数字 / 空格 / 换行 各算 1', () => expect(xWeightedLength('Hi 42\nok')).toBe(8));
  it('汉字算 2', () => expect(xWeightedLength('今天读论文')).toBe(10));
  it('中文标点也算 2(不在 1 的区间里)', () => expect(xWeightedLength('好，')).toBe(4));
  it('日文 / 韩文算 2', () => expect(xWeightedLength('かな한')).toBe(6));
  it('弯引号 / 破折号在 1 的区间', () => expect(xWeightedLength('“a”—')).toBe(4));
  it('emoji 算 2,组合 emoji(家庭 / 肤色)整个也算 2', () => {
    expect(xWeightedLength('👍')).toBe(2);
    expect(xWeightedLength('👍🏽')).toBe(2);
    expect(xWeightedLength('👨‍👩‍👧')).toBe(2);
  });
  it('链接一律算 23,不管多长', () => {
    expect(xWeightedLength('https://example.com/a/very/long/path?with=query')).toBe(23);
    expect(xWeightedLength('看 https://x.com')).toBe(2 + 1 + 23);
  });
  it('140 个汉字正好 280', () => expect(xWeightedLength('字'.repeat(140))).toBe(280));
  it('空串 0', () => expect(xWeightedLength('')).toBe(0));
});
