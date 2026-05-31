/**
 * Unit test: resolveOmniboxInput (Web P0 — 地址栏关键词搜索)
 *
 * 覆盖判别分支:URL vs 搜索词。
 */
import { describe, it, expect } from 'vitest';
import { resolveOmniboxInput } from '@views/web/omnibox';

describe('resolveOmniboxInput', () => {
  it('裸 host.tld → 补 https', () => {
    expect(resolveOmniboxInput('github.com')).toBe('https://github.com');
  });

  it('host.tld/path → 补 https', () => {
    expect(resolveOmniboxInput('github.com/anthropics/claude-code')).toBe(
      'https://github.com/anthropics/claude-code',
    );
  });

  it('已带 https:// → 原样', () => {
    expect(resolveOmniboxInput('https://x.com')).toBe('https://x.com');
  });

  it('已带 http:// → 原样(不强升 https)', () => {
    expect(resolveOmniboxInput('http://example.com')).toBe('http://example.com');
  });

  it('localhost:3000 → URL', () => {
    expect(resolveOmniboxInput('localhost:3000')).toBe('https://localhost:3000');
  });

  it('localhost(无端口)→ URL', () => {
    expect(resolveOmniboxInput('localhost')).toBe('https://localhost');
  });

  it('IPv4 → URL', () => {
    expect(resolveOmniboxInput('192.168.1.1')).toBe('https://192.168.1.1');
  });

  it('IPv4:port/path → URL', () => {
    expect(resolveOmniboxInput('127.0.0.1:8080/foo')).toBe('https://127.0.0.1:8080/foo');
  });

  it('多词(含空格)→ 搜索', () => {
    expect(resolveOmniboxInput('hello world')).toBe(
      'https://www.google.com/search?q=hello%20world',
    );
  });

  it('单词无点 → 搜索', () => {
    expect(resolveOmniboxInput('react hooks')).toBe(
      'https://www.google.com/search?q=react%20hooks',
    );
  });

  it('单个无点的词 → 搜索', () => {
    expect(resolveOmniboxInput('typescript')).toBe(
      'https://www.google.com/search?q=typescript',
    );
  });

  it('含点但也含空格(像句子)→ 搜索', () => {
    expect(resolveOmniboxInput('what is node.js')).toBe(
      'https://www.google.com/search?q=what%20is%20node.js',
    );
  });

  it('about: 协议 → 原样', () => {
    expect(resolveOmniboxInput('about:blank')).toBe('about:blank');
  });

  it('前后空白 → trim 后判别', () => {
    expect(resolveOmniboxInput('  github.com  ')).toBe('https://github.com');
  });

  it('空输入 → 空串', () => {
    expect(resolveOmniboxInput('   ')).toBe('');
  });

  it('搜索词含特殊字符 → encodeURIComponent', () => {
    expect(resolveOmniboxInput('c++ & rust')).toBe(
      'https://www.google.com/search?q=c%2B%2B%20%26%20rust',
    );
  });
});
