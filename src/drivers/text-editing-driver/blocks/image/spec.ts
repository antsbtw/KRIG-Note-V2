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
 *   id / sourcePages / thoughtId — KRIG 知识图谱挂钩(id 由 L7 block atomization 承接 atom.id,sourcePages / thoughtId 留 null,后续接入)
 */

import type { NodeSpec } from 'prosemirror-model';
import type { BlockSpec } from '../../types';
import { imageNodeView } from './node-view';
import { buildImageKeymap } from './keymap';

const imageNodeSpec: NodeSpec = {
  // caption — V1 image content='textBlock'(单段)。V2 拆分后默认 caption 是 paragraph,
  // 但 content 用 'block?' (group, 0 或 1 个) 表示可选单 block — 跟 V1 单 caption 行为等价
  // 但允许无 caption(extraction / migration 路径常无 caption)。
  // 修复(2026-05-22):原 'block'(必须 1 个)→ extraction 写入 content=[] 时 PM fromJSON
  // 容忍,但 setNodeAttribute 走 ReplaceStep 严格校验失败 → throw RangeError →
  // NoteView 渲染回退 "笔记加载中或已删除"。
  content: 'block?',
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
    // L7 block atomization (decision 026 §3.1.1 / §4 / §4.4 字面 rename atomId→id):
    // block atom 稳定 ULID,与 atom.id 同步;承接 L5-B+ 占位 atomId 字段
    id: { default: null },
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
