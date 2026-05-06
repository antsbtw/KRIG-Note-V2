/**
 * codeBlock — 代码块
 *
 * content: 'text*' — 只装纯文本(无 marks)
 * code: true — 标记为代码节点(PM 自动处理空白 / 不应用 mark 输入规则)
 * marks: '' — 不允许任何 mark
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
  id: 'code-block',
  displayName: 'Code',
  spec: codeBlockNodeSpec,
  containerRule: 'inline-only', // 严格说是 'text-only',这里复用枚举
  cascadeBoundary: true, // 整体不可拆
};
