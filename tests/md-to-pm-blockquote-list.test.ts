/**
 * B4a ② 外壳测试 —— markdownToProseMirror 的 blockquote / list 统一模型。
 *
 * 拍板：blockquote 采「② 递归任意 block」、list 采「①内嵌block ∪ ②task list」并集。
 * 本文件验 ② 侧：
 *  - blockquote 递归（内含 code/heading）+ 嵌套媒体本地化不丢（async 外壳保住）
 *  - 普通单行 list 逐字段不变（回归红线）
 *  - task list 不变；bullet/ordered 不变
 */

import { describe, it, expect, vi } from 'vitest';

const mediaPutBase64 = vi.fn(async (_d: string, _m?: string, filename?: string) => ({
  success: true,
  mediaUrl: `media://localized/${filename || 'img'}`,
  mediaId: 'mock-media-id',
}));

vi.mock('@slot/capability-registry/get-capability-api', () => ({
  getCapabilityApi: vi.fn(() => ({ mediaPutBase64 })),
  requireCapabilityApi: vi.fn((id: string) => {
    if (id === 'media-storage') return { mediaPutBase64 };
    throw new Error(`[test] capability '${id}' not stubbed`);
  }),
}));

import { markdownToProseMirror } from '@capabilities/text-editing/converters/md-to-pm';

describe('B4a ② blockquote（递归任意 block）', () => {
  it('普通文本引用 → blockquote > paragraph（输出不变）', async () => {
    const nodes = await markdownToProseMirror('> 一句引用');
    expect(nodes[0].type).toBe('blockquote');
    expect(nodes[0].content![0].type).toBe('paragraph');
    expect(nodes[0].content![0].content![0].text).toBe('一句引用');
  });

  it('引用内含 code block → 真 codeBlock 子块（能力增强，非压成文本）', async () => {
    const nodes = await markdownToProseMirror('> 前言\n> ```js\n> x=1\n> ```');
    expect(nodes[0].type).toBe('blockquote');
    const types = nodes[0].content!.map((n) => n.type);
    expect(types).toContain('codeBlock');
  });

  it('引用内嵌 base64 图 → 外壳本地化 media://（嵌套媒体不丢）', async () => {
    const nodes = await markdownToProseMirror('> ![图](data:image/png;base64,AAAA)');
    expect(mediaPutBase64).toHaveBeenCalled();
    const img = nodes[0].content!.find((n) => n.type === 'image');
    expect(String(img?.attrs?.src)).toMatch(/^media:\/\//);
  });

  it('GitHub alert `> [!NOTE]` 仍走 callout（B2 不回退）', async () => {
    const nodes = await markdownToProseMirror('> [!WARNING]\n> 小心');
    expect(nodes[0].type).toBe('callout');
  });

  it('空 `>` 行分隔的多 block 引用不被截断（回归：CommonMark 引用内段落分隔）', async () => {
    // 既有缺陷(B4a 一并修):收集条件曾要求 `> `(带空格),空引用行 `>` 被漏 → 截断
    // blockquote → 内嵌块用空 `>` 行分隔却分隔不了。放宽到 `>` 开头后,整段收进一个
    // blockquote,内层递归出「段落 + 图」两个子块,图仍本地化 media://。
    const md = '> 引用里嵌一张图：\n>\n> ![点](data:image/png;base64,AAAA)';
    const nodes = await markdownToProseMirror(md);
    // 只产 1 个 blockquote(不被空 > 行截断成多块 / 孤立 `>` 段落)
    expect(nodes.length).toBe(1);
    expect(nodes[0].type).toBe('blockquote');
    // 引用内既有段落又有图(空行正确变段落分隔)
    const inner = nodes[0].content!;
    expect(inner.some((n) => n.type === 'paragraph')).toBe(true);
    const img = inner.find((n) => n.type === 'image');
    expect(img).toBeTruthy();
    expect(String(img?.attrs?.src)).toMatch(/^media:\/\//); // 嵌套图仍本地化
  });
});

describe('B4a ② list（普通单行不变 + task 不变）', () => {
  it('bullet 单行 → bulletList > listItem > paragraph（逐字段不变）', async () => {
    const nodes = await markdownToProseMirror('- 甲\n- 乙');
    expect(nodes[0]).toEqual({
      type: 'bulletList',
      content: [
        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: '甲' }] }] },
        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: '乙' }] }] },
      ],
    });
  });

  it('ordered 单行 → orderedList（逐字段不变）', async () => {
    const nodes = await markdownToProseMirror('1. 一\n2. 二');
    expect(nodes[0].type).toBe('orderedList');
    expect(nodes[0].content).toHaveLength(2);
    expect(nodes[0].content![0].content![0].content![0].text).toBe('一');
  });

  it('task list → taskList > taskItem（checked + createdAt）', async () => {
    const nodes = await markdownToProseMirror('- [ ] 待办\n- [x] 完成');
    expect(nodes[0].type).toBe('taskList');
    expect(nodes[0].content![0].type).toBe('taskItem');
    expect(nodes[0].content![0].attrs!.checked).toBe(false);
    expect(nodes[0].content![1].attrs!.checked).toBe(true);
    expect(typeof nodes[0].content![0].attrs!.createdAt).toBe('string');
  });

  it('bullet 后接 task → 断成两个 list（bulletList + taskList）', async () => {
    const nodes = await markdownToProseMirror('- 普通\n- [ ] 任务');
    expect(nodes.map((n) => n.type)).toEqual(['bulletList', 'taskList']);
  });
});
