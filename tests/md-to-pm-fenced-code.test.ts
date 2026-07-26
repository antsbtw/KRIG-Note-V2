/**
 * md-to-pm (markdownToProseMirror) fenced code block 解析回归
 *
 * 背景(2026-07-25 阶段A):Markdown 文件导入 + 网页剪藏共用的 markdownToProseMirror
 * 与 AI 提取的 ResultParser 是两套独立转换器,曾有**同款**嵌套 fence bug —— 闭栏用
 * `startsWith('```')` 不按开栏长度配对,导致 ````markdown 里的内层 ```mermaid 被误当闭栏
 * → 空 codeBlock + 内容漏成正文。AI 侧先修(ai-markdown-fenced-code.test.ts),此处对齐。
 *
 * 契约:
 *  1. 嵌套 fence 按开栏 backtick 长度配对(内层 ```mermaid 视为外层 ````markdown 的内容)。
 *  2. 闭栏只看「起始 backtick 数 ≥ 开栏」,不要求整行纯 backtick(闭栏行带残留不吞到文末)。
 *  3. 真 ```python / 纯 ```mermaid 不受影响。
 *  4. 与 AI 侧的差异:md-to-pm **不**自动展开 language=markdown 包裹块(通用导入保真,
 *     用户文件里的 ```markdown 代码块是有意的)。
 */

import { describe, it, expect } from 'vitest';
import { markdownToProseMirror } from '@capabilities/text-editing/converters/md-to-pm';

type N = { type?: string; attrs?: { language?: string }; content?: Array<{ text?: string }> };

async function parse(md: string): Promise<N[]> {
  return (await markdownToProseMirror(md)) as unknown as N[];
}
const codeText = (n: N): string => n.content?.[0]?.text ?? '';

describe('md-to-pm fenced code', () => {
  it('嵌套 ````markdown 包 ```mermaid:单个 codeBlock,内层内容完整不漏', async () => {
    const md =
      '前言。\n\n````markdown\n```mermaid\nmindmap\n  root((NJ))\n    Chapter 1\n```\n````\n\n结束。';
    const nodes = await parse(md);
    const code = nodes.filter((n) => n.type === 'codeBlock');
    expect(code).toHaveLength(1);
    expect(codeText(code[0])).toContain('```mermaid');
    expect(codeText(code[0])).toContain('Chapter 1');
    // 不得出现空 codeBlock / mermaid 内容漏成 paragraph
    expect(nodes.some((n) => n.type === 'codeBlock' && !codeText(n).trim())).toBe(false);
    expect(nodes.some((n) => n.type === 'paragraph' && codeText(n).includes('mindmap'))).toBe(false);
  });

  it('纯 ```mermaid 保持 mermaid 代码块', async () => {
    const nodes = await parse('前言。\n\n```mermaid\nmindmap\n  root((NJ))\n```\n\n尾。');
    const code = nodes.filter((n) => n.type === 'codeBlock');
    expect(code).toHaveLength(1);
    expect(code[0].attrs?.language).toBe('mermaid');
  });

  it('真 ```python 代码块不受影响', async () => {
    const code = (await parse('```python\nprint("hi")\n```')).filter((n) => n.type === 'codeBlock');
    expect(code).toHaveLength(1);
    expect(code[0].attrs?.language).toBe('python');
    expect(codeText(code[0])).toBe('print("hi")');
  });

  it('闭栏行带残留(``` 后跟文字)不把后续段落吞进代码块', async () => {
    const nodes = await parse('第一段。\n\n```\ncode\n``` 后面还有字\n\n第三段。');
    expect(nodes.map((n) => n.type)).toEqual(['paragraph', 'codeBlock', 'paragraph']);
    expect(codeText(nodes[2])).toContain('第三段');
  });
});
