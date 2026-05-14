/**
 * unknown — schema 缺失节点的占位 block(L5-B4.3.1)
 *
 * 用途:
 * 当外部输入(如 md-to-pm 转出来的 Markdown 含 image / mathBlock / table 等)用了 V2 schema
 * 暂未实现的节点名时,转换层把它们包成 `{ type: 'unknown', attrs: { originalType, raw, ... } }`,
 * 落到 doc 里渲染成"暂未支持"占位卡片。
 *
 * 不偷偷降级丢内容,反向驱动后续 sub-stage 补齐 schema 节点。schema 补齐完成后
 * (例如新增 image block),md-to-pm 会直接输出 `{ type: 'image', ... }`,unknown
 * 占位自动消失。
 *
 * attrs:
 *   originalType:目标节点名(如 'image' / 'mathBlock')
 *   missing:    固定 true,标识"原本应该是其他节点"
 *   raw:        原始文本 / 序列化(便于调试 + 未来手动迁移)
 *   error:      可选,如 mediaPutBase64 失败原因
 */

import type { NodeSpec } from 'prosemirror-model';
import type { BlockSpec } from '../../types';

const unknownNodeSpec: NodeSpec = {
  group: 'block',
  atom: true, // 叶子节点 — 光标不能陷进去
  selectable: true,
  attrs: {
    originalType: { default: '' },
    missing: { default: true },
    raw: { default: '' },
    error: { default: '' },
    // sub-phase 022: 标注 eBook 时承载定位元数据 (default null, decision 022 §1.3.1)
    bookAnchor: { default: null },
  },
  parseDOM: [
    {
      tag: 'div[data-krig-unknown="1"]',
      getAttrs(node) {
        const el = node as HTMLElement;
        return {
          originalType: el.getAttribute('data-original-type') || '',
          missing: true,
          raw: el.getAttribute('data-raw') || '',
          error: el.getAttribute('data-error') || '',
        };
      },
    },
  ],
  toDOM(node) {
    const originalType = node.attrs.originalType as string;
    const error = node.attrs.error as string;
    const raw = node.attrs.raw as string;
    const label = `暂未支持: ${originalType || 'unknown'}${error ? ` (${error})` : ''}`;
    return [
      'div',
      {
        'data-krig-unknown': '1',
        'data-original-type': originalType,
        'data-raw': raw,
        'data-error': error,
        class: 'krig-unknown-block',
        title: raw ? `原始内容:\n${raw}` : label,
      },
      label,
    ];
  },
};

export const unknownSpec: BlockSpec = {
  id: 'unknown',
  displayName: 'Unsupported',
  spec: unknownNodeSpec,
  containerRule: 'leaf',
  cascadeBoundary: false,
};
