/**
 * 网页剪藏 blob: 视频 → 真实直链(2026-11-05)
 *
 * 事故:6abc.com 剪进 note 的视频块 src 是 `blob:https://6abc.com/…` —— 只在原页面里活着,
 * 笔记里播不了也下不了。样本形状照真实 clip 缓存(正文是 markdown + 内联 <video> HTML),内容合成。
 */
import { describe, it, expect, vi } from 'vitest';

// binary-manager 顶层读 Electron app;本测只测纯函数,不跑 yt-dlp
vi.mock('../../../../src/platform/main/ytdlp/binary-manager', () => ({ getYtdlpPath: () => null }));

import { applyBlobVideoResolution, resolveBlobVideos } from '../../../../src/platform/main/content-extraction/blob-video';
import type { FullPageResult } from '../../../../src/platform/main/content-extraction/types';

const page = (content: string, extra: Partial<FullPageResult> = {}): FullPageResult => ({
  content, title: 't', wordCount: 1, domain: 'news.example', url: 'https://news.example/post/1', ...extra,
});
const BLOB = 'blob:https://news.example/cdf7a062-7c61-4f68-95ff-fabb84695fc7';
const TAG = `<video aria-label="Experts warn" src="${BLOB}"></video>`;

describe('applyBlobVideoResolution', () => {
  it('解析到直链 → 换掉 blob,其余正文不动', () => {
    const r = applyBlobVideoResolution(page(`${TAG}\n\n正文一段`), ['https://cdn.example/v/a.mp4?x=1&y=2']);
    expect(r.content).toBe('<video aria-label="Experts warn" src="https://cdn.example/v/a.mp4?x=1&amp;y=2"></video>\n\n正文一段');
    expect(r.content).not.toMatch(/blob:/);
  });

  it('解析不出 → 不留空视频块,换成看得见的「请到原网页观看」+ 原网页链接', () => {
    const r = applyBlobVideoResolution(page(`${TAG}\n\n正文`), []);
    expect(r.content).not.toMatch(/<video|blob:/);
    expect(r.content).toContain('视频无法提取');
    expect(r.content).toContain('[https://news.example/post/1](https://news.example/post/1)');
    expect(r.content).toContain('正文');
  });

  it('多个 blob 视频按顺序配直链;直链不够的那个改成提示', () => {
    const b2 = 'blob:https://news.example/second';
    const r = applyBlobVideoResolution(page(`${TAG}\n\n<video src="${b2}"></video>`), ['https://cdn.example/1.mp4']);
    expect(r.content).toContain('src="https://cdn.example/1.mp4"');
    expect(r.content).not.toContain(b2);
    expect(r.content).toContain('视频无法提取');
  });

  it('contentVideos 里的 blob 一并替换;配不上的移除', () => {
    const r = applyBlobVideoResolution(
      page('正文', { contentVideos: [
        { src: BLOB, title: 'a', w: 1, h: 1 },
        { src: 'https://ok.example/b.mp4', title: 'b', w: 1, h: 1 },
        { src: 'blob:https://news.example/x', title: 'c', w: 1, h: 1 },
      ] }),
      ['https://cdn.example/1.mp4'],
    );
    expect(r.contentVideos?.map((v) => v.src)).toEqual(['https://cdn.example/1.mp4', 'https://ok.example/b.mp4']);
  });

  it('普通 https 视频不碰', () => {
    const c = '<video src="https://ok.example/a.mp4"></video>';
    expect(applyBlobVideoResolution(page(c), ['https://cdn.example/1.mp4']).content).toBe(c);
  });
});

describe('resolveBlobVideos', () => {
  it('没有 blob 视频 → 原样返回(不调 yt-dlp)', async () => {
    const p = page('<video src="https://ok.example/a.mp4"></video>');
    expect(await resolveBlobVideos(p)).toBe(p);
  });
  it('yt-dlp 不可用 → 走「请到原网页观看」,不留 blob', async () => {
    const r = await resolveBlobVideos(page(TAG));
    expect(r.content).toContain('视频无法提取');
    expect(r.content).not.toMatch(/blob:/);
  });
});
