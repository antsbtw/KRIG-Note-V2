/**
 * ai-markdown-parser fenced code block 解析回归
 *
 * 背景(2026-07-25 修复):ChatGPT「提取整页对话」把整段回复渲染成一个外层「markdown」
 * 代码块、里面再套 ```mermaid 时,旧 collectCodeBlock 不按 fence 长度配对 —— 遇到内层
 * ```mermaid 就误当闭栏 → 产出空 codeBlock、mermaid 内容漏成正文段落(note 里看到空
 * 「Markdown」框 + 一堆散落的 mindmap 文字)。
 *
 * 本测试锁死两条契约:
 *  1. 嵌套 fence 按长度配对(````markdown 只被 ```` 闭合,内层 ```mermaid 视为内容)。
 *  2. language=markdown/md 的包裹型代码块自动展开,让内层 ```mermaid 浮出为真 mermaid 块;
 *     但真 ```python / ```mermaid(无外层包裹)不受影响。
 */

import { describe, it, expect } from 'vitest';
import { ResultParser } from '@shared/ai-markdown-parser';

type B = { type?: string; language?: string; text?: string };

function parse(md: string): B[] {
  return new ResultParser().parse(md) as unknown as B[];
}

describe('ai-markdown-parser fenced code', () => {
  it('ChatGPT 外层 ````markdown 包 ```mermaid → 浮出为 mermaid 块,内容完整不漏', () => {
    const md =
      '前言。\n\n````markdown\n```mermaid\nmindmap\n  root((NJ))\n    Chapter 1\n      License Types\n```\n````\n\n结束。';
    const blocks = parse(md);
    const code = blocks.filter((b) => b.type === 'code');
    expect(code).toHaveLength(1);
    expect(code[0].language).toBe('mermaid');
    expect(code[0].text).toContain('mindmap');
    expect(code[0].text).toContain('License Types');
    // 绝不能出现空代码块 / mermaid 内容漏成 paragraph
    expect(blocks.some((b) => b.type === 'code' && !b.text?.trim())).toBe(false);
    expect(blocks.some((b) => b.type === 'paragraph' && b.text?.includes('mindmap'))).toBe(false);
  });

  it('纯 ```mermaid(无外层包裹)保持 mermaid 代码块', () => {
    const blocks = parse('前言。\n\n```mermaid\nmindmap\n  root((NJ))\n```\n\n尾。');
    const code = blocks.filter((b) => b.type === 'code');
    expect(code).toHaveLength(1);
    expect(code[0].language).toBe('mermaid');
    expect(code[0].text).toContain('mindmap');
  });

  it('真 ```python 代码块不被 markdown 展开逻辑误伤', () => {
    const blocks = parse('```python\nprint("hi")\n```');
    const code = blocks.filter((b) => b.type === 'code');
    expect(code).toHaveLength(1);
    expect(code[0].language).toBe('python');
    expect(code[0].text).toBe('print("hi")');
  });

  it('闭栏行带残留(``` 后跟文字/语言标记)不能把后续段落吞进代码块', () => {
    // 回归:曾把闭栏判定收严成「整行纯 backtick」→ 闭栏行不干净时从首个 fence 吞到文末,
    // 提取只出第一段。闭栏应只看「起始连续 backtick 数 ≥ 开栏」,不要求整行纯 backtick。
    const md = '第一段。\n\n```\ncode\n``` 后面还有字\n\n第三段。';
    const blocks = parse(md);
    expect(blocks.map((b) => b.type)).toEqual(['paragraph', 'code', 'paragraph']);
    expect(blocks[2].text).toContain('第三段');
  });

  it('整页多段落 + 代码块混排:所有段落都保留(不只第一段)', () => {
    const md =
      '当然可以。\n\n我建议不要全展开。\n\n```mermaid\nmindmap\n  root((NJ))\n```\n\n还能给别的版本。';
    const blocks = parse(md);
    const paras = blocks.filter((b) => b.type === 'paragraph');
    expect(paras.length).toBe(3);
    expect(blocks.filter((b) => b.type === 'code')).toHaveLength(1);
  });

  it('内层带空行的 mermaid(章节间空行)内容完整保留', () => {
    const md =
      '````markdown\n```mermaid\nmindmap\n  root((X))\n\n    Chapter 1\n\n    Chapter 2\n```\n````';
    const code = parse(md).filter((b) => b.type === 'code');
    expect(code).toHaveLength(1);
    expect(code[0].language).toBe('mermaid');
    expect(code[0].text).toContain('Chapter 1');
    expect(code[0].text).toContain('Chapter 2');
  });
});
