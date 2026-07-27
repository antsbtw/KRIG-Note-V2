/**
 * B4b 收官契约测试 —— ① AI 提取端到端产物（aiMarkdownToPmNodes / aiMarkdownToNoteDoc）。
 *
 * B4b 废 ExtractedBlock 中间态，① 成唯一解析核 markdownCore 的薄 caller：
 *   AI 预处理（JSON/widget/LaTeX/包裹展开/<<IMAGE>>/<center>）→ markdownCore → PMNode[]。
 * 本文件锁 ①-专属处理迁移后**产物不变**（回归红线：不许悄悄改 AI 输出），覆盖 ①-only 特性
 * + 通用 block（走核）。fence 相关另见 ai-markdown-fenced-code.test.ts。
 */

import { describe, it, expect } from 'vitest';
import { aiMarkdownToPmNodes, aiMarkdownToNoteDoc } from '@shared/ai-markdown-parser';

describe('B4b ① AI-专属预处理（①-only，迁移后不变）', () => {
  it('<<IMAGE:pageN|caption|desc>> → image（src=image、caption→title、desc→alt）', () => {
    const [img] = aiMarkdownToPmNodes('<<IMAGE:page19|图 1-1|函数 y=f(x) 的图形>>');
    expect(img.type).toBe('image');
    expect(img.attrs).toMatchObject({ src: 'image', title: '图 1-1', alt: '函数 y=f(x) 的图形' });
  });

  it('<<IMAGE>> 无 caption → alt=desc、无 title', () => {
    const [img] = aiMarkdownToPmNodes('<<IMAGE:page3||只有描述>>');
    expect(img.attrs).toMatchObject({ src: 'image', alt: '只有描述' });
    expect(img.attrs!.title).toBeUndefined();
  });

  it('<center>…</center> 紧跟 image → 并入 caption(title)', () => {
    const nodes = aiMarkdownToPmNodes('![alt](media://a)\n<center>图 2：架构</center>');
    expect(nodes).toHaveLength(1);
    expect(nodes[0].type).toBe('image');
    expect(nodes[0].attrs!.title).toBe('图 2：架构');
  });

  it('<center> 无前置 image → 纯文本段（剥标签）', () => {
    const nodes = aiMarkdownToPmNodes('<center>孤立文本</center>');
    expect(nodes[0].type).toBe('paragraph');
    expect(nodes[0].content![0].text).toBe('孤立文本');
  });

  it('LaTeX \\[..\\] → mathBlock、\\(..\\) → mathInline', () => {
    const [blk] = aiMarkdownToPmNodes('\\[ a^2+b^2=c^2 \\]');
    expect(blk.type).toBe('mathBlock');
    expect(blk.content![0].text).toContain('a^2+b^2=c^2');
    const inline = aiMarkdownToPmNodes('值 \\(x_i\\) 结束');
    expect(inline[0].content!.some((n) => n.type === 'mathInline')).toBe(true);
  });

  it('ChatGPT genui widget → mathBlock', () => {
    const nodes = aiMarkdownToPmNodes('genui{"math_widget":{"content":"y = 2x + 1"}}');
    expect(nodes.some((n) => n.type === 'mathBlock')).toBe(true);
  });

  it('整段被 ```markdown 包裹 → 剥外层、内层块浮出', () => {
    const nodes = aiMarkdownToPmNodes('```markdown\n# 标题\n\n正文\n```');
    expect(nodes[0].type).toBe('heading');
    expect(nodes[1].type).toBe('paragraph');
  });

  it('JSON 数组路径 → heading/paragraph 直接产 PMNode', () => {
    const nodes = aiMarkdownToPmNodes(
      '[{"type":"heading","headingLevel":2,"text":"章节"},{"type":"paragraph","text":"一段 **粗**"}]',
    );
    expect(nodes[0]).toMatchObject({ type: 'heading', attrs: { level: 2 } });
    expect(nodes[1].type).toBe('paragraph');
    // JSON text 过核 → 行内 mark 生效
    expect(nodes[1].content!.find((n) => n.text === '粗')?.marks).toEqual([{ type: 'bold' }]);
  });
});

describe('B4b ① 通用 block（走核，产物对齐）', () => {
  it('callout / blockquote / list / task / table / image / video 各产真节点', () => {
    expect(aiMarkdownToPmNodes('> [!TIP]\n> 提示')[0].type).toBe('callout');
    expect(aiMarkdownToPmNodes('> 引用')[0].type).toBe('blockquote');
    expect(aiMarkdownToPmNodes('- 甲\n- 乙')[0].type).toBe('bulletList');
    expect(aiMarkdownToPmNodes('1. 一\n2. 二')[0].type).toBe('orderedList');
    const task = aiMarkdownToPmNodes('- [x] 完成');
    expect(task[0].type).toBe('taskList');
    expect(task[0].content![0].attrs!.checked).toBe(true);
    expect(aiMarkdownToPmNodes('| a | b |\n|---|---|\n| 1 | 2 |')[0].type).toBe('table');
    expect(aiMarkdownToPmNodes('![x](media://a)')[0].type).toBe('image');
    expect(aiMarkdownToPmNodes('![[dQw4w9WgXcQ]]')[0].type).toBe('videoBlock');
    expect(aiMarkdownToPmNodes('!html[图](media://h)')[0].type).toBe('htmlBlock');
  });

  it('blockquote 内含 code → 真子块（递归）', () => {
    const [bq] = aiMarkdownToPmNodes('> 前言\n> ```js\n> x=1\n> ```');
    expect(bq.type).toBe('blockquote');
    expect(bq.content!.map((n) => n.type)).toContain('codeBlock');
  });

  it('src 原样：base64 图不被 ① 本地化（① 无 media 本地化）', () => {
    const [img] = aiMarkdownToPmNodes('![x](data:image/png;base64,AAAA)');
    expect(img.attrs!.src).toBe('data:image/png;base64,AAAA');
  });
});

describe('B4b ① 信封 + 空兜底', () => {
  it('aiMarkdownToNoteDoc 包 {type:doc, content}', () => {
    const env = aiMarkdownToNoteDoc('# 标题');
    expect(env.format).toBe('pm-doc-json');
    expect((env.payload as { type: string }).type).toBe('doc');
    expect((env.payload as { content: unknown[] }).content[0]).toMatchObject({ type: 'heading' });
  });

  it('空/空白输入 → doc 兜底单空 paragraph（PM doc 不能空）', () => {
    for (const s of ['', '   ', '\n\n']) {
      const env = aiMarkdownToNoteDoc(s);
      expect((env.payload as { content: unknown[] }).content).toEqual([{ type: 'paragraph' }]);
    }
  });
});
