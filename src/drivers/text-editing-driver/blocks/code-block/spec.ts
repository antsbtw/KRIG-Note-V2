/**
 * codeBlock — 代码块(id 驼峰避免短横线问题)
 *
 * V2 当前仅对 language === 'mermaid' 提供 NodeView(渲染图表 + 工具栏);
 * 其他语言走默认 toDOM 输出 <pre><code>。
 */

import type { NodeSpec } from 'prosemirror-model';
import type { BlockSpec } from '../../types';
import { codeBlockNodeView } from './node-view';

const codeBlockNodeSpec: NodeSpec = {
  content: 'text*',
  marks: '',
  group: 'block',
  code: true,
  defining: true,
  attrs: {
    language: { default: '' },
    // sub-phase 022: 标注 eBook 时承载定位元数据 (default null, decision 022 §1.3.1)
    bookAnchor: { default: null },
  },
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
  nodeView: codeBlockNodeView,
  containerRule: 'inline-only',
  cascadeBoundary: true,
};
