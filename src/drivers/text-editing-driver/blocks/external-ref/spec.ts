/**
 * externalRef — 外部引用 block 卡片(L5-B3.14)
 *
 * V1 → V2 直迁:src/plugins/note/blocks/external-ref.ts
 *
 * 跟 fileBlock 区别:
 * - fileBlock 把字节拷进 mediaStore,自包含跟着 note 走
 * - externalRef **只存 URL**(file:// 或 https://),文件移动 / 删除会断链
 * - 价值:KRIG Graph 的"外部知识引用关系"(note → file → folder → ...)
 *
 * 两种 kind:
 * - 'file':href 是 `file:///absolute/path`
 * - 'url' :href 是 `https://...`
 */

import type { NodeSpec } from 'prosemirror-model';
import type { BlockSpec } from '../../types';
import { externalRefNodeView } from './node-view';

const externalRefNodeSpec: NodeSpec = {
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,
  attrs: {
    kind: { default: 'url' },        // 'file' | 'url'
    href: { default: '' },
    title: { default: '' },
    mimeType: { default: '' },
    size: { default: null },
    modifiedAt: { default: null },
  },
  parseDOM: [
    {
      tag: 'div.krig-external-ref',
      getAttrs(node) {
        const el = node as HTMLElement;
        const sizeStr = el.getAttribute('data-size');
        return {
          kind: (el.getAttribute('data-kind') as 'file' | 'url') || 'url',
          href: el.getAttribute('data-href') || '',
          title: el.getAttribute('data-title') || '',
          mimeType: el.getAttribute('data-mime') || '',
          size: sizeStr ? Number(sizeStr) || null : null,
        };
      },
    },
  ],
  toDOM(node) {
    return [
      'div',
      {
        class: 'krig-external-ref',
        'data-kind': (node.attrs.kind as string) || 'url',
        'data-href': (node.attrs.href as string) || '',
        'data-title': (node.attrs.title as string) || '',
        'data-mime': (node.attrs.mimeType as string) || '',
        'data-size': node.attrs.size != null ? String(node.attrs.size) : '',
      },
    ];
  },
};

export const externalRefSpec: BlockSpec = {
  id: 'externalRef',
  displayName: 'External reference',
  spec: externalRefNodeSpec,
  nodeView: externalRefNodeView,
  containerRule: 'leaf',
  cascadeBoundary: false,
};
