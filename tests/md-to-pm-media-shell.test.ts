/**
 * B3 外壳本地化测试 —— ② markdownToProseMirror 的 async 媒体本地化「外壳」行为。
 *
 * 与核契约测试（markdown-core.test.ts，纯 sync）分开：本文件专测**外壳**做的事 ——
 *  - base64 图/附件 → media://（走 mock 的 mediaPutBase64，验回归红线：本地化行为没丢）
 *  - 核只吃已 resolve 的 src（核纯 sync 无 IPC，本地化只在外壳）
 *  - ② B3 新增能力：video/audio/htmlBlock/obsidian 解析改调核后 ② 能产真节点
 *
 * 用独立 mock 覆盖 shared setup 的 registry mock（后者对真调 mediaPutBase64 抛错），
 * 让 mediaPutBase64 可控（返回可断言的 media:// URL）。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// 可控 mediaPutBase64：base64 → media://（记录调用次数供断言）
const mediaPutBase64 = vi.fn(async (data: string, mime?: string, filename?: string) => ({
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

beforeEach(() => mediaPutBase64.mockClear());

describe('B3 外壳 / base64 本地化（回归红线：行为不变）', () => {
  it('base64 图片 → 外壳 mediaPutBase64 → src 变 media://', async () => {
    const nodes = await markdownToProseMirror('![封面](data:image/png;base64,AAAA)');
    expect(mediaPutBase64).toHaveBeenCalledTimes(1);
    expect(nodes[0].type).toBe('image');
    expect(String(nodes[0].attrs?.src)).toMatch(/^media:\/\//);
    expect(nodes[0].attrs?.alt).toBe('封面');
  });

  it('远程 URL 图片 → 不调 mediaPutBase64，src 原样', async () => {
    const nodes = await markdownToProseMirror('![x](https://x.com/a.png)');
    expect(mediaPutBase64).not.toHaveBeenCalled();
    expect(nodes[0].attrs?.src).toBe('https://x.com/a.png');
  });

  it('!attach base64 → fileBlock，外壳本地化 src + mediaId', async () => {
    const nodes = await markdownToProseMirror('!attach[报告.pdf](data:application/pdf;base64,BBBB)');
    expect(mediaPutBase64).toHaveBeenCalledTimes(1);
    expect(nodes[0].type).toBe('fileBlock');
    expect(String(nodes[0].attrs?.src)).toMatch(/^media:\/\//);
    expect(nodes[0].attrs?.mediaId).toBe('mock-media-id');
    expect(nodes[0].attrs?.filename).toBe('报告.pdf');
  });

  it('!file 路径 → externalRef，href normalize（sync 外壳，不调 IPC）', async () => {
    const nodes = await markdownToProseMirror('!file[规格](/Users/me/a.txt)');
    expect(mediaPutBase64).not.toHaveBeenCalled();
    expect(nodes[0].type).toBe('externalRef');
    expect(String(nodes[0].attrs?.href)).toMatch(/^file:\/\//);
    expect(nodes[0].attrs?.title).toBe('规格');
  });
});

describe('B3 外壳 / ② 新增媒体能力（video/audio/htmlBlock/obsidian）', () => {
  it('!html[title](url) → htmlBlock（src 原样，不本地化）', async () => {
    const nodes = await markdownToProseMirror('!html[图表](media://h1)');
    expect(mediaPutBase64).not.toHaveBeenCalled();
    expect(nodes[0].type).toBe('htmlBlock');
    expect(nodes[0].attrs).toEqual({ src: 'media://h1', title: '图表' });
  });

  it('<iframe https> → videoBlock', async () => {
    const nodes = await markdownToProseMirror('<iframe src="https://youtube.com/embed/x" title="片"></iframe>');
    expect(nodes[0].type).toBe('videoBlock');
    expect(nodes[0].attrs?.src).toBe('https://youtube.com/embed/x');
  });

  it('<video>/<audio> → video/audioBlock', async () => {
    const v = await markdownToProseMirror('<video src="media://v" data-duration="90"></video>');
    expect(v[0].type).toBe('videoBlock');
    expect(v[0].attrs?.duration).toBe(90);
    const a = await markdownToProseMirror('<audio src="media://a"></audio>');
    expect(a[0].type).toBe('audioBlock');
  });

  it('Obsidian ![[id]] → YouTube videoBlock', async () => {
    const nodes = await markdownToProseMirror('![[dQw4w9WgXcQ]]');
    expect(nodes[0].type).toBe('videoBlock');
    expect(String(nodes[0].attrs?.src)).toContain('dQw4w9WgXcQ');
  });
});
