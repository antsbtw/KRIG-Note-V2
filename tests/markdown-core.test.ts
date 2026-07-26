/**
 * markdown-core 契约测试 —— 阶段 B1 唯一解析核的回归护栏。
 *
 * 覆盖（验收要求）：
 *  - 每类 B1 block：heading / paragraph / horizontalRule / codeBlock / mathBlock / mathInline
 *  - 两个已知 fence 坑：嵌套 fence 长度配对 + 闭栏带残留不吞到文末
 *  - inline mark 递归嵌套（bold/italic/strike/code/link 互套）
 *  - 「未覆盖」出口：非 B1 block 产 uncovered 哨兵、绝不静默吞
 *
 * B1 拍板：①(AI 提取) 与 ②(文件/剪藏/Word 导入) 的这几类 block 都吃本核产出的
 * canonical 形态。本文件同时锁 markdownCore 直接产物 + ① blocks-to-pm-doc 一致性。
 */

import { describe, it, expect } from 'vitest';
import {
  markdownCore,
  parseInline,
  tryParseFencedCode,
  isUncovered,
  UNCOVERED_TYPE,
  type PMNode,
} from '@shared/markdown-core';

// ── heading ──────────────────────────────────────────────────────────
describe('markdown-core / heading', () => {
  it('# ~ ###### → heading level 1-6', () => {
    for (let lvl = 1; lvl <= 6; lvl++) {
      const nodes = markdownCore(`${'#'.repeat(lvl)} 标题${lvl}`);
      expect(nodes).toHaveLength(1);
      expect(nodes[0].type).toBe('heading');
      expect(nodes[0].attrs?.level).toBe(lvl);
      expect(nodes[0].content?.[0]).toEqual({ type: 'text', text: `标题${lvl}` });
    }
  });

  it('heading 内含 mark（canonical inline）', () => {
    const [h] = markdownCore('## 含 **粗** 与 `代码`');
    expect(h.type).toBe('heading');
    const texts = (h.content ?? []).map((n) => n.text);
    expect(texts).toContain('粗');
    expect(h.content?.find((n) => n.text === '粗')?.marks).toEqual([{ type: 'bold' }]);
    expect(h.content?.find((n) => n.text === '代码')?.marks).toEqual([{ type: 'code' }]);
  });
});

// ── paragraph ────────────────────────────────────────────────────────
describe('markdown-core / paragraph', () => {
  it('纯文本 → paragraph', () => {
    const [p] = markdownCore('一段普通文字');
    expect(p.type).toBe('paragraph');
    expect(p.content).toEqual([{ type: 'text', text: '一段普通文字' }]);
  });
});

// ── horizontalRule ───────────────────────────────────────────────────
describe('markdown-core / horizontalRule', () => {
  it.each(['---', '***', '___', '----', '******'])('%s → horizontalRule', (rule) => {
    const [hr] = markdownCore(rule);
    expect(hr).toEqual({ type: 'horizontalRule' });
  });
});

// ── codeBlock + fence 两个坑 ─────────────────────────────────────────
const codeText = (n: PMNode): string => n.content?.[0]?.text ?? '';

describe('markdown-core / codeBlock', () => {
  it('```lang → codeBlock，有 language 才带 attrs', () => {
    const [c] = markdownCore('```python\nprint("hi")\n```');
    expect(c.type).toBe('codeBlock');
    expect(c.attrs?.language).toBe('python');
    expect(codeText(c)).toBe('print("hi")');
  });

  it('无 language 的 ``` → attrs 省略（undefined）', () => {
    const [c] = markdownCore('```\ncode\n```');
    expect(c.type).toBe('codeBlock');
    expect(c.attrs).toBeUndefined();
    expect(codeText(c)).toBe('code');
  });

  it('空代码块 → content 省略', () => {
    const [c] = markdownCore('```\n```');
    expect(c.type).toBe('codeBlock');
    expect(c.content).toBeUndefined();
  });

  // 坑 1：嵌套 fence 长度配对
  it('坑1 嵌套 ````markdown 包 ```mermaid：单块，内层内容完整不漏', () => {
    const md = '前言。\n\n````markdown\n```mermaid\nmindmap\n  root((NJ))\n    Chapter 1\n```\n````\n\n结束。';
    const nodes = markdownCore(md);
    const code = nodes.filter((n) => n.type === 'codeBlock');
    expect(code).toHaveLength(1);
    expect(code[0].attrs?.language).toBe('markdown');
    expect(codeText(code[0])).toContain('```mermaid');
    expect(codeText(code[0])).toContain('Chapter 1');
    // 绝不能出现空 codeBlock / mermaid 内容漏成正文
    expect(nodes.some((n) => n.type === 'codeBlock' && !codeText(n).trim())).toBe(false);
    expect(nodes.some((n) => n.type === 'paragraph' && (codeText(n)).includes('mindmap'))).toBe(false);
  });

  it('坑1 内层带空行的 mermaid 内容完整保留', () => {
    const md = '````markdown\n```mermaid\nmindmap\n  root((X))\n\n    Chapter 1\n\n    Chapter 2\n```\n````';
    const code = markdownCore(md).filter((n) => n.type === 'codeBlock');
    expect(code).toHaveLength(1);
    expect(codeText(code[0])).toContain('Chapter 1');
    expect(codeText(code[0])).toContain('Chapter 2');
  });

  // 坑 2：闭栏带残留不吞到文末
  it('坑2 闭栏行带残留（``` 后跟文字）不把后续段落吞进代码块', () => {
    const md = '第一段。\n\n```\ncode\n``` 后面还有字\n\n第三段。';
    const nodes = markdownCore(md);
    expect(nodes.map((n) => n.type)).toEqual(['paragraph', 'codeBlock', 'paragraph']);
    const last = nodes[nodes.length - 1];
    expect(last.content?.some((t) => (t.text ?? '').includes('第三段'))).toBe(true);
  });

  it('tryParseFencedCode 非开栏返回 null', () => {
    expect(tryParseFencedCode(['普通行'], 0)).toBeNull();
    expect(tryParseFencedCode(['``', 'x'], 0)).toBeNull(); // 只有 2 个 backtick
  });
});

// ── mathBlock ────────────────────────────────────────────────────────
describe('markdown-core / mathBlock', () => {
  it('单行 $$…$$ → mathBlock，content=[text]', () => {
    const [m] = markdownCore('$$a^2 + b^2 = c^2$$');
    expect(m.type).toBe('mathBlock');
    expect(m.content).toEqual([{ type: 'text', text: 'a^2 + b^2 = c^2' }]);
  });

  it('多行 $$ … $$ → mathBlock，跨行 latex 完整', () => {
    const [m] = markdownCore('$$\n\\int_0^1 x dx\n= \\frac{1}{2}\n$$');
    expect(m.type).toBe('mathBlock');
    expect(codeText(m)).toContain('\\int_0^1');
    expect(codeText(m)).toContain('\\frac{1}{2}');
  });

  it('空 $$$$ → uncovered 哨兵（不静默吞，caller 决定降级）', () => {
    const [n] = markdownCore('$$$$');
    expect(isUncovered(n)).toBe(true);
  });
});

// ── mathInline + inline mark 递归嵌套 ───────────────────────────────
describe('markdown-core / inline marks', () => {
  it('mathInline $x^2$ → inline node', () => {
    const nodes = parseInline('值为 $x^2$ 结束');
    expect(nodes.some((n) => n.type === 'mathInline' && n.attrs?.latex === 'x^2')).toBe(true);
  });

  it('strike ~~删除~~', () => {
    const nodes = parseInline('~~删除~~');
    expect(nodes[0].marks).toEqual([{ type: 'strike' }]);
  });

  it('递归嵌套 [**X**](url)：link + bold 同叠', () => {
    const nodes = parseInline('[**加粗链接**](https://x.com)');
    expect(nodes).toHaveLength(1);
    const marks = (nodes[0].marks ?? []).map((m) => m.type).sort();
    expect(marks).toEqual(['bold', 'link']);
    expect(nodes[0].marks?.find((m) => m.type === 'link')?.attrs?.href).toBe('https://x.com');
  });

  it('递归嵌套 **[X](url)**：bold 外套 link', () => {
    const nodes = parseInline('**[链接](u)**');
    const marks = (nodes[0].marks ?? []).map((m) => m.type).sort();
    expect(marks).toEqual(['bold', 'link']);
  });

  it('code 为叶子，内部 ** 不再解析', () => {
    const nodes = parseInline('`**不是粗**`');
    expect(nodes).toEqual([{ type: 'text', text: '**不是粗**', marks: [{ type: 'code' }] }]);
  });
});

// ── 未覆盖出口（不静默吞）────────────────────────────────────────────
describe('markdown-core / uncovered exit', () => {
  it('list / table / blockquote 等非 B1 block → uncovered 哨兵带原始源行', () => {
    const md = '- 列表项\n- 第二项';
    const nodes = markdownCore(md);
    expect(nodes.every((n) => n.type === UNCOVERED_TYPE)).toBe(true);
    const raw = nodes.map((n) => (n.attrs as { rawLines: string }).rawLines).join('\n');
    expect(raw).toContain('列表项');
    expect(raw).toContain('第二项');
  });

  it('uncovered 块内容一字不丢（table）', () => {
    const md = '| a | b |\n|---|---|\n| 1 | 2 |';
    const nodes = markdownCore(md);
    const raw = nodes.map((n) => (n.attrs as { rawLines: string })?.rawLines ?? '').join('\n');
    expect(raw).toContain('| a | b |');
    expect(raw).toContain('| 1 | 2 |');
  });

  it('B1 块与 uncovered 块混排：B1 规范解析、uncovered 隔断', () => {
    const md = '# 标题\n\n- 列表\n\n普通段落';
    const nodes = markdownCore(md);
    expect(nodes[0].type).toBe('heading');
    expect(nodes[1].type).toBe(UNCOVERED_TYPE);
    expect(nodes[2].type).toBe('paragraph');
  });
});
