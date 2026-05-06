/**
 * codeBlock — 代码块(id 驼峰避免短横线问题)
 */

import type { NodeSpec } from 'prosemirror-model';
import type { BlockSpec } from '../../types';

const codeBlockNodeSpec: NodeSpec = {
  content: 'text*',
  marks: '',
  group: 'block',
  code: true,
  defining: true,
  attrs: { language: { default: '' } },
  parseDOM: [
    {
      tag: 'pre',
      preserveWhitespace: 'full',
      getAttrs(node) {
        const codeEl = (node as HTMLElement).querySelector('code');
        const langClass = codeEl?.className.match(/language-(\S+)/);
        return { language: langClass ? langClass[1] : '' };
      },
    },
  ],
  toDOM(node) {
    const lang = node.attrs.language as string;
    return [
      'pre',
      { class: 'krig-code-block' },
      ['code', lang ? { class: `language-${lang}` } : {}, 0],
    ];
  },
};

export const codeBlockSpec: BlockSpec = {
  id: 'codeBlock',
  displayName: 'Code',
  spec: codeBlockNodeSpec,
  containerRule: 'inline-only',
  cascadeBoundary: true,
};
