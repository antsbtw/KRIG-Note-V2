/**
 * image — 图片 block(L5-B3.5)
 *
 * V1 → V2 直迁,见 docs/RefactorV2/stages/L5B3.5-image-block-design.md。
 *
 * 三态:
 * - placeholder(无 src):显示 🖼 + Upload 按钮 + Embed link 输入
 * - 普通图(有 src,非 SVG):走 <img>
 * - SVG 图:走 <div> + innerHTML(CSS 变量 / 字体 fallback / 内部事件需要 inline DOM)
 *
 * caption:`content: 'block'` 单段 caption(用户实际写 paragraph),空也可
 *
 * attrs:
 *   src       图片 URL(http / https / data: / media://)
 *   alt       替代文本(可访问性 + markdown 来源 alt)
 *   title     hover 标题(可空)
 *   width     像素宽度(resize 后写)— null 表示 auto
 *   height    像素高度 — null 表示 auto
 *   alignment 'left' | 'center' | 'right'
 *   atomId / sourcePages / thoughtId — KRIG 知识图谱挂钩,留 null,后续接入
 */

import type { NodeSpec } from 'prosemirror-model';
import type { BlockSpec } from '../../types';
import { imageNodeView } from './node-view';
import { buildImageKeymap } from './keymap';

const imageNodeSpec: NodeSpec = {
  // caption — V1 image content='textBlock'(单段)。V2 拆分后默认 caption 是 paragraph,
  // 但 content 用 'block' (group) 表示单个 block — 跟 V1 单 caption 行为等价,
  // 用户实际只会写段落 (paragraph),其他 block 类型(heading / list / 等)允许但不常见。
  content: 'block',
  group: 'block',
  draggable: true,
  selectable: true,
  attrs: {
    src: { default: null },
    alt: { default: '' },
    title: { default: '' },
    width: { default: null },
    height: { default: null },
    alignment: { default: 'center' },
    // KRIG 知识图谱挂钩(留 null,L5-B+ 接入)
    atomId: { default: null },
    sourcePages: { default: null },
    thoughtId: { default: null },
    // sub-phase 022: 标注 eBook 时承载定位元数据 (default null, decision 022 §1.3.1)
    bookAnchor: { default: null },
  },
  parseDOM: [
    {
      tag: 'div.krig-image-block',
      getAttrs(node) {
        const el = node as HTMLElement;
        const img = el.querySelector('img');
        const dataSrc = el.getAttribute('data-src');
        const widthStr = el.getAttribute('data-width');
        const heightStr = el.getAttribute('data-height');
        return {
          src: dataSrc || img?.getAttribute('src') || null,
          alt: img?.getAttribute('alt') || '',
          title: img?.getAttribute('title') || '',
          width: widthStr ? parseInt(widthStr, 10) || null : null,
          height: heightStr ? parseInt(heightStr, 10) || null : null,
          alignment: el.getAttribute('data-alignment') || 'center',
        };
      },
    },
  ],
  toDOM(node) {
    const attrs: Record<string, string> = {
      class: 'krig-image-block',
      'data-alignment': (node.attrs.alignment as string) || 'center',
    };
    if (node.attrs.src) attrs['data-src'] = node.attrs.src as string;
    if (node.attrs.width) attrs['data-width'] = String(node.attrs.width);
    if (node.attrs.height) attrs['data-height'] = String(node.attrs.height);
    return [
      'div',
      attrs,
      // serializer hint:实际渲染由 NodeView 接管,这里只为序列化 / parseDOM 闭环
      ['img', {
        src: (node.attrs.src as string) || '',
        alt: (node.attrs.alt as string) || '',
        title: (node.attrs.title as string) || '',
      }],
      ['figcaption', { class: 'krig-image-block__caption' }, 0],
    ];
  },
};

export const imageSpec: BlockSpec = {
  id: 'image',
  displayName: 'Image',
  spec: imageNodeSpec,
  nodeView: imageNodeView,
  // L5-B3.5:caption 内 Enter 跳出 image 插入新段落(替代 PM 默认 splitBlock,
  // 默认 split 会在 image content='block'(单)约束下被拒,导致用户感觉"按 Enter 删了图")
  plugin: () => buildImageKeymap(),
  containerRule: 'inline-only',
  cascadeBoundary: false,
};
