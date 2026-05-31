/**
 * Unit test: web-history 纯函数(mergeVisit / matchHistory)
 *
 * 只测纯逻辑(去重/排序/上限/前缀匹配),localStorage 边缘不测。
 */
import { describe, it, expect } from 'vitest';
import { mergeVisit, matchHistory, type WebHistoryEntry } from '@views/web/web-history';

const E = (url: string, lastVisit: number, visitCount = 1, title = ''): WebHistoryEntry => ({
  url,
  title,
  lastVisit,
  visitCount,
});

describe('mergeVisit', () => {
  it('新 URL → 置顶,visitCount=1', () => {
    const out = mergeVisit([], 'https://a.com', 'A', 1000);
    expect(out).toEqual([{ url: 'https://a.com', title: 'A', lastVisit: 1000, visitCount: 1 }]);
  });

  it('已存在 URL → 去重 + visitCount 累加 + 更新 lastVisit', () => {
    const list = [E('https://a.com', 1000, 2, 'old')];
    const out = mergeVisit(list, 'https://a.com', 'new', 2000);
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({ url: 'https://a.com', title: 'new', lastVisit: 2000, visitCount: 3 });
  });

  it('已存在但新 title 为空 → 保留旧 title', () => {
    const out = mergeVisit([E('https://a.com', 1000, 1, 'keep')], 'https://a.com', '', 2000);
    expect(out[0].title).toBe('keep');
  });

  it('多条 → 按 lastVisit 降序', () => {
    let list: WebHistoryEntry[] = [];
    list = mergeVisit(list, 'https://a.com', 'A', 1000);
    list = mergeVisit(list, 'https://b.com', 'B', 3000);
    list = mergeVisit(list, 'https://c.com', 'C', 2000);
    expect(list.map((e) => e.url)).toEqual(['https://b.com', 'https://c.com', 'https://a.com']);
  });

  it('超过上限裁掉最旧(此处用小列表验证排序裁剪不丢最新)', () => {
    // 构造 501 条,确认裁到 500 且最旧被丢
    let list: WebHistoryEntry[] = [];
    for (let i = 0; i < 501; i++) {
      list = mergeVisit(list, `https://site${i}.com`, '', i + 1);
    }
    expect(list).toHaveLength(500);
    // 最新(site500, lastVisit=501)在,最旧(site0, lastVisit=1)被裁
    expect(list[0].url).toBe('https://site500.com');
    expect(list.some((e) => e.url === 'https://site0.com')).toBe(false);
  });
});

describe('matchHistory', () => {
  const list = [
    E('https://github.com/anthropics', 3000, 5, 'GitHub'),
    E('https://google.com', 2000, 10, 'Google'),
    E('https://gitlab.com', 1000, 2, 'GitLab'),
  ];

  it('空输入 → 空候选', () => {
    expect(matchHistory(list, '   ')).toEqual([]);
  });

  it('前缀子串匹配(去协议)', () => {
    const out = matchHistory(list, 'git');
    expect(out.map((e) => e.url)).toContain('https://github.com/anthropics');
    expect(out.map((e) => e.url)).toContain('https://gitlab.com');
    expect(out.map((e) => e.url)).not.toContain('https://google.com');
  });

  it('按 visitCount 降序 → lastVisit 降序', () => {
    // github(visitCount 5)在 gitlab(2)前
    const out = matchHistory(list, 'git');
    expect(out[0].url).toBe('https://github.com/anthropics');
  });

  it('匹配 title(大小写不敏感)', () => {
    const out = matchHistory(list, 'google');
    expect(out.map((e) => e.url)).toEqual(['https://google.com']);
  });

  it('最多 8 条候选', () => {
    const big: WebHistoryEntry[] = [];
    for (let i = 0; i < 20; i++) big.push(E(`https://test${i}.com`, i, i));
    expect(matchHistory(big, 'test')).toHaveLength(8);
  });
});
