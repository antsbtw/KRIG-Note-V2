/**
 * fileLink — 行内文件链接 inline atom(L5-B3.14)
 *
 * V1 → V2 直迁:src/plugins/note/blocks/file-link.ts
 *
 * 段落中引用附件 chip(📎 filename),点击用系统默认应用打开。
 * 字节存储跟 fileBlock 一样走 mediaStore;但本节点是 inline atom,体积小、
 * 用于段落中"提到附件"场景。
 *
 * 不进 slash menu(对齐 V1 — 仅 paste / drag / 未来 fileBlock 转 inline 路径产生)。
 *
 * leafText:📎<filename> — 复制 / textBetween 还原源码,对齐 noteLink / mathInline 模式。
 */

import type { NodeSpec } from 'prosemirror-model';
import type { BlockSpec } from '../../types';
import { fileLinkNodeView } from './node-view';

const fileLinkNodeSpec: NodeSpec = {
  inline: true,
  group: 'inline',
  atom: true,
  attrs: {
    src: { default: '' },        // media:// / file:// / 绝对路径
    filename: { default: '' },
    // sub-phase 022: 标注 eBook 时承载定位元数据 (default null, decision 022 §1.3.1)
    bookAnchor: { default: null },
  },
  parseDOM: [
    {
      tag: 'span.krig-file-link',
      getAttrs(node) {
        const el = node as HTMLElement;
        return {
          src: el.getAttribute('data-src') || '',
          filename:
            el.querySelector('.krig-file-link__name')?.textContent ||
            el.textContent?.replace(/^📎\s*/, '') ||
            '',
        };
      },
    },
  ],
  toDOM(node) {
    return [
      'span',
      {
        class: 'krig-file-link',
        'data-src': (node.attrs.src as string) || '',
      },
      ['span', { class: 'krig-file-link__icon' }, '📎'],
      ['span', { class: 'krig-file-link__name' }, (node.attrs.filename as string) || 'file'],
    ];
  },
  leafText: (node) => `📎${(node.attrs.filename as string) || 'file'}`,
};

export const fileLinkSpec: BlockSpec = {
  id: 'fileLink',
  displayName: 'File Link',
  spec: fileLinkNodeSpec,
  nodeView: fileLinkNodeView,
  containerRule: 'leaf',
  cascadeBoundary: false,
};
