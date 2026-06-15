/**
 * pm-to-markdown 视频源收集 单元测试(X 集成 阶段 2.5-b 视频)
 *
 * 守的约束(prompt §2②,videoLocalSource 决策):
 *  - localFilePath(ytdlp 下载的绝对路径)优先;无则取 src 且仅当 src 是 media://
 *  - 外链(http(s) / youtube / vimeo / generic embed,无本地文件)→ 不收
 *  - sliceToMarkdown / docNodeToMarkdown 两个入口都收(嵌容器里的 videoBlock 也抓)
 *  - markdown 正文仍产 `[Video: title]` 占位(不破坏既有行为);videos 与之正交
 */

import { describe, it, expect } from 'vitest';
import { Schema, Slice, Fragment } from 'prosemirror-model';
import { docNodeToMarkdown, sliceToMarkdown } from '@drivers/text-editing-driver/serializers/pm-to-markdown';

// 最小 schema:paragraph + videoBlock(attrs 对齐真实 spec 的关键字段)+ callout 容器
const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    text: { group: 'inline' },
    paragraph: { content: 'inline*', group: 'block', toDOM: () => ['p', 0] },
    videoBlock: {
      content: 'block',
      group: 'block',
      attrs: {
        src: { default: null },
        embedType: { default: null },
        title: { default: 'Video' },
        localFilePath: { default: null },
      },
      toDOM: () => ['div', 0],
    },
    callout: { content: 'block+', group: 'block', toDOM: () => ['div', 0] },
  },
  marks: {},
});

const { paragraph, videoBlock, callout } = schema.nodes;

function vid(attrs: Record<string, unknown>) {
  return videoBlock.create(attrs, paragraph.create()); // caption 空段
}

describe('docNodeToMarkdown — videos 收集', () => {
  it('localFilePath 优先(即使 src 也是 media://)', () => {
    const doc = schema.node('doc', null, [
      vid({ embedType: 'direct', src: 'media://x.mp4', localFilePath: '/Users/me/Downloads/x.mp4' }),
    ]);
    expect(docNodeToMarkdown(doc).videos).toEqual(['/Users/me/Downloads/x.mp4']);
  });

  it('无 localFilePath → 取 media:// src', () => {
    const doc = schema.node('doc', null, [vid({ embedType: 'direct', src: 'media://y.mp4' })]);
    expect(docNodeToMarkdown(doc).videos).toEqual(['media://y.mp4']);
  });

  it('外链视频(youtube / http(s))不收', () => {
    const doc = schema.node('doc', null, [
      vid({ embedType: 'youtube', src: 'https://youtube.com/watch?v=abc' }),
      vid({ embedType: 'generic', src: 'https://example.com/v.mp4' }),
    ]);
    expect(docNodeToMarkdown(doc).videos).toEqual([]);
  });

  it('混合:只收本地的,外链丢', () => {
    const doc = schema.node('doc', null, [
      vid({ embedType: 'direct', src: 'media://local.mp4' }),
      vid({ embedType: 'youtube', src: 'https://youtu.be/x' }),
      vid({ localFilePath: '/abs/dl.mp4' }),
    ]);
    expect(docNodeToMarkdown(doc).videos).toEqual(['media://local.mp4', '/abs/dl.mp4']);
  });

  it('嵌在 callout 容器里的 videoBlock 也被抓到', () => {
    const doc = schema.node('doc', null, [
      callout.create(null, [paragraph.create(null, schema.text('提示')), vid({ src: 'media://nested.mp4' })]),
    ]);
    expect(docNodeToMarkdown(doc).videos).toEqual(['media://nested.mp4']);
  });

  it('markdown 正文仍含 [Video: …] 占位(videos 与正文正交,不破坏既有行为)', () => {
    const doc = schema.node('doc', null, [vid({ title: '我的视频', src: 'media://z.mp4' })]);
    const r = docNodeToMarkdown(doc);
    expect(r.markdown).toContain('[Video: 我的视频]');
    expect(r.videos).toEqual(['media://z.mp4']);
  });
});

describe('sliceToMarkdown — videos 收集(选区入口)', () => {
  it('选区 slice 同样收本地视频源', () => {
    const frag = Fragment.from([
      paragraph.create(null, schema.text('文')),
      vid({ src: 'media://sel.mp4' }),
    ]);
    const slice = new Slice(frag, 0, 0);
    expect(sliceToMarkdown(slice).videos).toEqual(['media://sel.mp4']);
  });

  it('空 slice → videos 为空数组(不报错)', () => {
    expect(sliceToMarkdown(Slice.empty).videos).toEqual([]);
  });
});
