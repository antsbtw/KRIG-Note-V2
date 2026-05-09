/**
 * videoBlock — 多端 embed + 直接 video + Tab 框架 + 字幕底座(L5-B3.16 → L5-B3.19.a)
 *
 * V1 → V2 直迁:src/plugins/note/blocks/video-block.ts(988 行)
 *
 * embedType:
 * - 'youtube'  :<iframe> 16/9 + IFrame postMessage time tracking(B3.19.a 启 enablejsapi=1)
 * - 'direct'   :<video controls preload=metadata>(media:// / https:// 直链)
 * - 'vimeo'    :探测出但本期不渲染,fallback 占位(总设计 Q4=A)
 * - 'generic'  :未知 embed,本期不渲染,fallback 占位
 *
 * Tab 框架(B3.19.a):'play'(默认) / 'data' / 'transcript' / <future translation lang>
 * 字幕底座(B3.19.a):time-tracker 单源 300ms 轮询;CC 浮层渲染 activeCue
 *
 * 后续段:
 * - B3.19.b:transcript import(ytdlp.fetchTranscript)+ translate 多 Tab
 * - B3.19.c:Memory Playback Mode(艾宾浩斯)
 * - B3.19.d:Vocab Panel(timeline 视图)
 * - B3.19.e:yt-dlp 下载 + 完整 Data Tab
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
    embedType: { default: null },    // 'youtube' | 'direct' | 'vimeo' | 'generic' — mount 时按 src 推断,持久化
    title: { default: 'Video' },
    mimeType: { default: null },
    duration: { default: null },
    atomId: { default: null },       // KRIG 知识图谱挂钩(D 阶段)
    // L5-B3.19.a NEW:
    activeTab: { default: 'play' },        // 'play' | 'data' | 'transcript' | <translation lang code>
    transcriptText: { default: null },     // 字幕原文(P1 修正:真相源,subtitleCues 内存派生不持久化)
    // L5-B3.19.b NEW:
    translationTexts: { default: null },   // JSON.stringify(Record<langCode, transcriptText>) | null;每语言独立持久化原文
    // L5-B3.19.c NEW(Memory Mode):
    segmentDuration: { default: 60 },      // 段长(秒);用户从 dropdown 选 30/60/90/120
    memoryLastStep: { default: 0 },        // 上次 stepIndex(stop 时写;start 时跑到此 step)
    // L5-B3.19.e NEW(Download):
    localFilePath: { default: null },      // ytdlp 下载完成后的本地路径(Q-e-1=A:不切 src 仅记录;按钮 ⬇ → 📁)
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
          activeTab: el.getAttribute('data-active-tab') || 'play',
          transcriptText: el.getAttribute('data-transcript') || null,
          translationTexts: el.getAttribute('data-translations') || null,
          segmentDuration: Number(el.getAttribute('data-segment-duration') || '60') || 60,
          memoryLastStep: Number(el.getAttribute('data-memory-last-step') || '0') || 0,
          localFilePath: el.getAttribute('data-local-file-path') || null,
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
    if (node.attrs.activeTab && node.attrs.activeTab !== 'play') {
      attrs['data-active-tab'] = node.attrs.activeTab as string;
    }
    if (node.attrs.transcriptText) attrs['data-transcript'] = node.attrs.transcriptText as string;
    if (node.attrs.translationTexts) attrs['data-translations'] = node.attrs.translationTexts as string;
    if (node.attrs.segmentDuration && node.attrs.segmentDuration !== 60) {
      attrs['data-segment-duration'] = String(node.attrs.segmentDuration);
    }
    if (node.attrs.memoryLastStep) {
      attrs['data-memory-last-step'] = String(node.attrs.memoryLastStep);
    }
    if (node.attrs.localFilePath) {
      attrs['data-local-file-path'] = node.attrs.localFilePath as string;
    }
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
