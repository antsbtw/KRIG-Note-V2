/**
 * htmlBlock — HTML 预览
 *
 * attrs.src = media:// URL 引用(源码在 mediaStore,PM doc 只持引用 — 不存源码)。
 *
 * 不用 sandbox:V2 默认 CSP `script-src 'self'` 拦 sandbox iframe 内的 inline
 *   script,而 sandbox 又禁 parent 读 contentDocument,造成"自动高度死路"。
 *   去 sandbox 后 iframe 与 parent 同 origin,parent 直接 contentDocument.open
 *   写入 + ResizeObserver 监听 body,无需 iframe 内任何脚本通信。
 *
 *   Trade-off:HTML 内 script 能访问 parent window/cookie/storage — KRIG 是本地
 *   app 无敏感会话,HTML 来源限用户自行上传(非远端不可信),接受此 trade-off。
 *
 * caption:`content: 'block'` 单段(对齐 V2 image / audio-block)。
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
        };
      },
    },
  ],
  toDOM(node) {
    const attrs: Record<string, string> = { class: 'krig-html-block' };
    if (node.attrs.src) attrs['data-src'] = node.attrs.src as string;
    if (node.attrs.title) attrs['data-title'] = node.attrs.title as string;
    if (node.attrs.height != null) attrs['data-height'] = String(node.attrs.height);
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
