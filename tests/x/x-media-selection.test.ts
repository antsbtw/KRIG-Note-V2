/**
 * X 发推媒体取舍(纯逻辑层)单元测试(X 集成 阶段 2.5-b 视频)
 *
 * 守的约束(决策点 §4,本期定):
 *  - 图片只取 media://(外链图不喂 X),note 图 + 渲染图共占 4 张额度,超 4 截断且记总数
 *  - 视频上限 1;序列化器已预筛源,此处只截断 + 记总数
 *  - 图视频互斥:有视频 → 弃全部图、droppedImageCount 记被弃数(fail loud 不静默)
 *  - mediaTradeoffNote 在「弃图 / 视频超限」时给提示,否则 null
 */

import { describe, it, expect } from 'vitest';
import {
  combineMedia,
  collectNoteVideos,
  combineExclusiveMedia,
  mediaTradeoffNote,
  X_MAX_IMAGES,
  X_MAX_VIDEOS,
} from '@shared/x/x-media-selection';

describe('combineMedia — 图清单合并 + 只取 media://', () => {
  it('只取 media:// 本地图,外链图(http/https)被滤掉', () => {
    const { mediaUrls, totalImageCount } = combineMedia(
      ['media://a.png', 'https://x.com/b.png', 'http://c.png'],
      [],
    );
    expect(mediaUrls).toEqual(['media://a.png']);
    expect(totalImageCount).toBe(1);
  });

  it('note 图在前、渲染图在后,共占 4 张额度', () => {
    const { mediaUrls, totalImageCount } = combineMedia(
      ['media://n1.png', 'media://n2.png'],
      ['media://r1.png', 'media://r2.png'],
    );
    expect(mediaUrls).toEqual(['media://n1.png', 'media://n2.png', 'media://r1.png', 'media://r2.png']);
    expect(totalImageCount).toBe(4);
  });

  it('超过 4 张截断,totalImageCount 记截前总数', () => {
    const imgs = Array.from({ length: 6 }, (_, i) => `media://i${i}.png`);
    const { mediaUrls, totalImageCount } = combineMedia(imgs, []);
    expect(mediaUrls).toHaveLength(X_MAX_IMAGES);
    expect(totalImageCount).toBe(6);
  });
});

describe('collectNoteVideos — 视频上限 1 + 截前总数', () => {
  it('过滤空串,截至 1 个', () => {
    const { videos, totalVideoCount } = collectNoteVideos([
      'media://v1.mp4',
      '',
      '/Users/me/Downloads/v2.mp4',
    ]);
    expect(videos).toEqual(['media://v1.mp4']);
    expect(videos).toHaveLength(X_MAX_VIDEOS);
    expect(totalVideoCount).toBe(2);
  });

  it('空清单 → 空 + 0', () => {
    expect(collectNoteVideos([])).toEqual({ videos: [], totalVideoCount: 0 });
  });
});

describe('combineExclusiveMedia — 图视频互斥', () => {
  it('无视频 → 正常带图,videoUrls 空,droppedImageCount=0', () => {
    const r = combineExclusiveMedia(['media://a.png', 'media://b.png'], [], []);
    expect(r.mediaUrls).toEqual(['media://a.png', 'media://b.png']);
    expect(r.videoUrls).toEqual([]);
    expect(r.totalImageCount).toBe(2);
    expect(r.droppedImageCount).toBe(0);
  });

  it('有视频 → 弃全部图(优先视频),droppedImageCount 记被弃图数', () => {
    const r = combineExclusiveMedia(
      ['media://a.png', 'media://b.png', 'media://c.png'],
      ['media://rendered.png'],
      ['media://v.mp4'],
    );
    expect(r.videoUrls).toEqual(['media://v.mp4']);
    expect(r.mediaUrls).toEqual([]); // 图全弃
    expect(r.totalImageCount).toBe(0);
    expect(r.droppedImageCount).toBe(4); // a,b,c + rendered 都被弃
    expect(r.totalVideoCount).toBe(1);
  });

  it('有视频且无图 → droppedImageCount=0(没图可弃)', () => {
    const r = combineExclusiveMedia([], [], ['media://v.mp4']);
    expect(r.videoUrls).toEqual(['media://v.mp4']);
    expect(r.droppedImageCount).toBe(0);
  });

  it('多视频 → 只带第 1 个,totalVideoCount 记总数', () => {
    const r = combineExclusiveMedia([], [], ['media://v1.mp4', '/abs/v2.mp4']);
    expect(r.videoUrls).toEqual(['media://v1.mp4']);
    expect(r.totalVideoCount).toBe(2);
  });
});

describe('mediaTradeoffNote — fail loud 提示文案', () => {
  it('无取舍 → null', () => {
    expect(mediaTradeoffNote(0, 0)).toBeNull();
    expect(mediaTradeoffNote(0, 1)).toBeNull(); // 1 个视频不超限
  });

  it('弃图 → 提示忽略了 N 张图', () => {
    const note = mediaTradeoffNote(3, 1);
    expect(note).toContain('已忽略 3 张图');
    expect(note).toContain('图片和视频混发');
  });

  it('视频超限 → 提示只发第 1 个', () => {
    const note = mediaTradeoffNote(0, 3);
    expect(note).toContain('共 3 个本地视频');
    expect(note).toContain('只能带 1 个');
  });

  it('既弃图又视频超限 → 两条都提示', () => {
    const note = mediaTradeoffNote(2, 2);
    expect(note).toContain('已忽略 2 张图');
    expect(note).toContain('共 2 个本地视频');
  });
});
