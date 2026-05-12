/**
 * noteLink — 笔记内链 inline atom(L5-B3.12)
 *
 * V1 → V2 直迁:src/plugins/note/blocks/note-link.ts
 *
 * 行为:
 * - inline + atom + group:'inline'(光标不进入,作为整体单元处理)
 * - noteId 存目标 note 的 atom id(noteCapability 中的 ULID 字符串),null = 失效
 * - label 派生自目标 note.title(NodeView mount 时同步一次)
 * - 渲染:`📄 <label>` — 由 nodeView 接管(toDOM 是 fallback 序列化)
 * - leafText:'[[label]]' — textBetween / 复制成纯文本时还原源码,对齐 mathInline
 *
 * 触发:`[[` 输入由 build-note-link-command-plugin 监听,弹出搜索面板。
 */

import type { NodeSpec } from 'prosemirror-model';
import type { BlockSpec } from '../../types';
import { noteLinkNodeView } from './node-view';

const noteLinkNodeSpec: NodeSpec = {
  inline: true,
  group: 'inline',
  atom: true,
  attrs: {
    noteId: { default: null },
    label: { default: '' },
  },
  parseDOM: [
    {
      tag: 'span.krig-note-link',
      getAttrs(node) {
        const el = node as HTMLElement;
        return {
          noteId: el.getAttribute('data-note-id') || null,
          label: el.textContent?.replace(/^📄\s*/, '') || '',
        };
      },
    },
  ],
  toDOM(node) {
    return [
      'span',
      {
        class: 'krig-note-link',
        'data-note-id': (node.attrs.noteId as string | null) ?? '',
      },
      `📄 ${(node.attrs.label as string) || 'Untitled'}`,
    ];
  },
  // atom 节点 — leafText 让复制 / textBetween 还原源码 [[label]]
  leafText: (node) => `[[${(node.attrs.label as string) || ''}]]`,
};

export const noteLinkSpec: BlockSpec = {
  id: 'noteLink',
  displayName: 'Note Link',
  spec: noteLinkNodeSpec,
  nodeView: noteLinkNodeView,
  containerRule: 'leaf',
  cascadeBoundary: false,
};
