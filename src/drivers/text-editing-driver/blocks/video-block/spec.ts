/**
 * videoBlock — 多端 embed + 直接 video 播放(L5-B3.16)
 *
 * V1 → V2 直迁:src/plugins/note/blocks/video-block.ts(988 行 → 砍字幕 + 砍 Vimeo/generic
 * 留 Phase D,V2 ~300 行)
 *
 * V2 仅支持两种 embedType(决策 § 1.3):
 * - 'youtube':<iframe> 16/9 比例(rel=0,无 jsapi — 字幕系统留 D 阶段才需要)
 * - 'direct'  :<video controls preload=metadata>(media:// / https:// 直链)
 *
 * 砍 V1:
 * - ❌ Vimeo / generic embed iframe — Phase D + iframe 安全 sanitizer 设计
 * - ❌ 字幕系统(WebVTT cue / CC 浮层 / YouTube transcript / 翻译 — 全部留 Phase D)
 * - ❌ YouTube IFrame API postMessage(没字幕需求,enablejsapi=0)
 * - ❌ Tab 框架(单一播放器视图)
 *
 * caption:contentDOM 由 PM 接管,跟 audio / image 同模式
 */

import type { NodeSpec } from 'prosemirror-model';
import type { BlockSpec } from '../../types';
import { videoBlockNodeView } from './node-view';

const videoBlockNodeSpec: NodeSpec = {
  group: 'block',
  content: 'block',          // 单段 caption
  draggable: true,
  selectable: true,
  attrs: {
    src: { default: null },          // YouTube URL / mp4 URL / media://
    embedType: { default: null },    // 'youtube' | 'direct' — NodeView mount 时按 src 推断,持久化
    title: { default: 'Video' },
    mimeType: { default: null },
    duration: { default: null },
    // L5-B3.19.1:transcript 文本(`[MM:SS] text` / `[HH:MM:SS] text` 多行字符串)
    // direct + youtube 两种播放态都支持用户编辑;cues 是 derived(parse 时缓存)
    // 翻译产物预留 transcriptZh / transcriptJa 等多语言字段(B3.19.4 加,本段不做)
    transcript: { default: '' },
    atomId: { default: null },       // KRIG 知识图谱挂钩(D 阶段)
  },
  parseDOM: [
    {
      tag: 'div.krig-video-block',
      getAttrs(node) {
        const el = node as HTMLElement;
        const durStr = el.getAttribute('data-duration');
        return {
          src: el.getAttribute('data-src') || null,
          embedType: el.getAttribute('data-embed-type') || null,
          title: el.getAttribute('data-title') || 'Video',
          mimeType: el.getAttribute('data-mime') || null,
          duration: durStr ? Number(durStr) || null : null,
          transcript: el.getAttribute('data-transcript') || '',
        };
      },
    },
  ],
  toDOM(node) {
    const attrs: Record<string, string> = { class: 'krig-video-block' };
    if (node.attrs.src) attrs['data-src'] = node.attrs.src as string;
    if (node.attrs.embedType) attrs['data-embed-type'] = node.attrs.embedType as string;
    if (node.attrs.title) attrs['data-title'] = node.attrs.title as string;
    if (node.attrs.mimeType) attrs['data-mime'] = node.attrs.mimeType as string;
    if (node.attrs.duration != null) attrs['data-duration'] = String(node.attrs.duration);
    if (node.attrs.transcript) attrs['data-transcript'] = node.attrs.transcript as string;
    return [
      'div',
      attrs,
      ['figcaption', { class: 'krig-video-block__caption' }, 0],
    ];
  },
};

export const videoBlockSpec: BlockSpec = {
  id: 'videoBlock',
  displayName: 'Video',
  spec: videoBlockNodeSpec,
  nodeView: videoBlockNodeView,
  containerRule: 'inline-only',
  cascadeBoundary: false,
};
