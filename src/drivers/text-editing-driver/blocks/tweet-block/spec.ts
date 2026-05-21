/**
 * tweet-block — X(Twitter)推文嵌入(L5-B3.18)
 *
 * V1 → V2 直迁:src/plugins/note/blocks/tweet-block.ts(V1 schema 部分)
 *
 * 双 Tab UI(Browse iframe / Data 离线缓存卡片):
 * - Browse:Twitter 官方 platform.twitter.com iframe(实时显示,需 CSP frame-src 白名单)
 * - Data:结构化卡片(头像/名/handle/正文/时间/metrics/引用/inReplyTo)— 离线可读
 *
 * 元数据来自 tweet-fetcher capability(NodeView Fetch 按钮)。
 *
 * caption:`content: 'block'` 单段(对齐 image / audio / video — V2 PM content 表达式
 * 不允许节点名含短横线,只能引用 group;'block' group 表示单 block 跟 V1 单 caption 等价)。
 *
 * V1 → V2 改造:
 * - 砍 V1 的 richText / embedHtml(V1 也只用 text;richText 是预留;embedHtml 走 oEmbed
 *   备用路径,本阶段不上)
 * - 砍 V1 的 sourcePages / thoughtId;atomId 由 L7 block atomization rename 为 id 承接
 */

import type { NodeSpec } from 'prosemirror-model';
import type { BlockSpec } from '../../types';
import { tweetBlockNodeView } from './node-view';

const tweetBlockNodeSpec: NodeSpec = {
  group: 'block',
  content: 'block', // 单段 caption(对齐 image / audio / video)
  draggable: true,
  selectable: true,
  attrs: {
    // 链接
    tweetUrl: { default: null },
    tweetId: { default: null },
    // 元数据(Fetch 按钮抓回填)
    authorName: { default: '' },
    authorHandle: { default: '' },
    authorAvatar: { default: '' },
    text: { default: '' },
    createdAt: { default: '' },
    lang: { default: '' },
    media: { default: null },
    metrics: { default: null },
    quotedTweet: { default: null },
    inReplyTo: { default: null },
    // UI 状态(持久化让用户切回笔记保留 Tab 选择)
    activeTab: { default: 'browse' }, // 'browse' | 'data'
    // L5-B3.18 用户红线:下载视频本地路径持久化(切回笔记仍可点 📁 Finder 高亮)
    // null = 未下载;有值 = 完成下载,Download 按钮显 📁
    downloadedVideoPath: { default: null },
    // L7 block atomization (decision 026 §3.1.1 / §4 / §4.4 字面 rename atomId→id):
    // block atom 稳定 ULID,与 atom.id 同步
    id: { default: null },
    // sub-phase 022: 标注 eBook 时承载定位元数据 (default null, decision 022 §1.3.1)
    bookAnchor: { default: null },
  },
  parseDOM: [
    {
      tag: 'div.krig-tweet-block',
      getAttrs(node) {
        const el = node as HTMLElement;
        return {
          tweetUrl: el.getAttribute('data-tweet-url') || null,
          tweetId: el.getAttribute('data-tweet-id') || null,
          authorName: el.getAttribute('data-author-name') || '',
          authorHandle: el.getAttribute('data-author-handle') || '',
          text: el.getAttribute('data-text') || '',
          createdAt: el.getAttribute('data-created-at') || '',
          activeTab: el.getAttribute('data-active-tab') || 'browse',
          downloadedVideoPath: el.getAttribute('data-downloaded-video-path') || null,
        };
      },
    },
  ],
  toDOM(node) {
    const attrs: Record<string, string> = { class: 'krig-tweet-block' };
    if (node.attrs.tweetUrl) attrs['data-tweet-url'] = node.attrs.tweetUrl as string;
    if (node.attrs.tweetId) attrs['data-tweet-id'] = node.attrs.tweetId as string;
    if (node.attrs.authorName) attrs['data-author-name'] = node.attrs.authorName as string;
    if (node.attrs.authorHandle) attrs['data-author-handle'] = node.attrs.authorHandle as string;
    if (node.attrs.text) attrs['data-text'] = node.attrs.text as string;
    if (node.attrs.createdAt) attrs['data-created-at'] = node.attrs.createdAt as string;
    if (node.attrs.activeTab) attrs['data-active-tab'] = node.attrs.activeTab as string;
    if (node.attrs.downloadedVideoPath) {
      attrs['data-downloaded-video-path'] = node.attrs.downloadedVideoPath as string;
    }
    return [
      'div',
      attrs,
      // serializer hint:实际渲染由 NodeView 接管;caption 走 contentDOM(PM)
      ['figcaption', { class: 'krig-tweet-block__caption' }, 0],
    ];
  },
};

export const tweetBlockSpec: BlockSpec = {
  id: 'tweetBlock',
  displayName: 'X Post',
  spec: tweetBlockNodeSpec,
  nodeView: tweetBlockNodeView,
  containerRule: 'inline-only',
  cascadeBoundary: false,
};
