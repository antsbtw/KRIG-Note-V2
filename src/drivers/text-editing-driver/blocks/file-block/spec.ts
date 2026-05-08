/**
 * fileBlock — 通用附件 block 卡片(L5-B3.14)
 *
 * V1 → V2 直迁:src/plugins/note/blocks/file-block.ts
 *
 * 字节进 mediaStore,自包含跟着 note 走(对比 externalRef 只存 URL 不拷字节)。
 *
 * 两态:
 * - placeholder(无 src):file picker + URL embed
 * - card(有 src):icon + 文件名 + MIME · 大小 + [打开] [Finder 显示]
 *
 * 典型场景:AI 生成 PDF / Code Interpreter 文件 / 用户上传附件。
 *
 * V1 → V2 改造:
 * - viewAPI(IPC)→ V2 直接调 electronAPI(单 React tree,无 viewAPI 层)
 * - V1 用 content: 'text*' 让 PM mousemove 工作给 block-handle hover;
 *   V2 试 atom: true(更干净);若 hover 不工作再退回 'text*'
 * - 不复用 V1 createPlaceholder 共享基类(对齐 L5-B3.5 image 各自独立 NodeView 模式)
 */

import type { NodeSpec } from 'prosemirror-model';
import type { BlockSpec } from '../../types';
import { fileBlockNodeView } from './node-view';

const fileBlockNodeSpec: NodeSpec = {
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,
  attrs: {
    src: { default: '' },        // media:// URL(主要)/ file:// / 绝对路径(兼容)
    mediaId: { default: '' },    // mediaStore 内部 ID(去重 hash)
    filename: { default: '' },
    mimeType: { default: '' },
    size: { default: null },     // bytes
    source: { default: null },   // 'user-uploaded' / 'ai-generated' 等(可选 metadata)
  },
  parseDOM: [
    {
      tag: 'div.krig-file-block',
      getAttrs(node) {
        const el = node as HTMLElement;
        const sizeStr = el.getAttribute('data-size');
        return {
          src: el.getAttribute('data-src') || '',
          mediaId: el.getAttribute('data-media-id') || '',
          filename: el.getAttribute('data-filename') || '',
          mimeType: el.getAttribute('data-mime') || '',
          size: sizeStr ? Number(sizeStr) || null : null,
          source: el.getAttribute('data-source') || null,
        };
      },
    },
  ],
  toDOM(node) {
    return [
      'div',
      {
        class: 'krig-file-block',
        'data-src': (node.attrs.src as string) || '',
        'data-media-id': (node.attrs.mediaId as string) || '',
        'data-filename': (node.attrs.filename as string) || '',
        'data-mime': (node.attrs.mimeType as string) || '',
        'data-size': node.attrs.size != null ? String(node.attrs.size) : '',
        'data-source': (node.attrs.source as string | null) || '',
      },
    ];
  },
};

export const fileBlockSpec: BlockSpec = {
  id: 'fileBlock',
  displayName: 'File attachment',
  spec: fileBlockNodeSpec,
  nodeView: fileBlockNodeView,
  containerRule: 'leaf',
  cascadeBoundary: false,
};
