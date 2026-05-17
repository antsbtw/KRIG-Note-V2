/**
 * htmlBlock — HTML 预览(V1 → V2 直迁)
 *
 * V1 直迁:src/plugins/note/blocks/html-block.ts(331 行)
 *
 * 用 sandbox iframe 安全地渲染 AI 生成的 HTML artifact。
 * attrs.src = media:// URL 引用(源码在 mediaStore,PM doc 只持引用 — 不存源码)。
 *
 * 安全:sandbox='allow-scripts'(对齐 V1),不开 allow-same-origin —
 *   iframe 内 script 可执行 + 可外发 fetch,但无法访问 parent cookie/storage。
 *
 * caption:`content: 'block'` 单段(对齐 V2 image / audio-block — 'block' group
 *   单子节点 == V1 'textBlock' 单 caption 等价)。
 */

import type { NodeSpec } from 'prosemirror-model';
import type { BlockSpec } from '../../types';
import { htmlBlockNodeView } from './node-view';

const htmlBlockNodeSpec: NodeSpec = {
  group: 'block',
  content: 'block',
  draggable: true,
  selectable: true,
  attrs: {
    src: { default: null },
    title: { default: '' },
    height: { default: null },
    sandbox: { default: 'allow-scripts' },
    atomId: { default: null },
  },
  parseDOM: [
    {
      tag: 'div.krig-html-block',
      getAttrs(node) {
        const el = node as HTMLElement;
        const heightStr = el.getAttribute('data-height');
        return {
          src: el.getAttribute('data-src') || null,
          title: el.getAttribute('data-title') || '',
          height: heightStr ? Number(heightStr) || null : null,
          sandbox: el.getAttribute('data-sandbox') || 'allow-scripts',
        };
      },
    },
  ],
  toDOM(node) {
    const attrs: Record<string, string> = { class: 'krig-html-block' };
    if (node.attrs.src) attrs['data-src'] = node.attrs.src as string;
    if (node.attrs.title) attrs['data-title'] = node.attrs.title as string;
    if (node.attrs.height != null) attrs['data-height'] = String(node.attrs.height);
    if (node.attrs.sandbox) attrs['data-sandbox'] = node.attrs.sandbox as string;
    return [
      'div',
      attrs,
      ['figcaption', { class: 'krig-html-block__caption' }, 0],
    ];
  },
};

export const htmlBlockSpec: BlockSpec = {
  id: 'htmlBlock',
  displayName: 'HTML Preview',
  spec: htmlBlockNodeSpec,
  nodeView: htmlBlockNodeView,
  containerRule: 'inline-only',
  cascadeBoundary: false,
};
