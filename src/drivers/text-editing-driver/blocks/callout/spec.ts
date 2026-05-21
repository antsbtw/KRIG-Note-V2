/**
 * callout — 提示框(ContainerBlock 同款,emoji + 背景包裹子内容)
 *
 * 对齐 V1:content: 'block+',attrs.emoji 默认 💡,点 emoji 循环切换 10 个表情
 *
 * id 驼峰避免短横线问题(参考 [feedback_pm_schema_naming.md])。
 *
 * D023:新增 attrs.iconName(lucide icon 名),非 null 时优先于 emoji 渲染。
 * D024 §4.1:新增 attrs.imageSrc(用户上传图 media:// URL),非 null 时优先于 iconName / emoji。
 *           三字段字面平级互斥(setter 守门,见 driver/api.ts setCalloutEmoji/Icon/Image)。
 */

import type { NodeSpec } from 'prosemirror-model';
import type { BlockSpec } from '../../types';
import { calloutNodeView } from './node-view';

const calloutNodeSpec: NodeSpec = {
  content: 'block+',
  group: 'block',
  defining: true,
  attrs: {
    // L7 block atomization (decision 026 §3.1.1 / §4): block atom 稳定 ULID,与 atom.id 同步
    id: { default: null },
    emoji: { default: '💡' },
    // sub-phase 022: 标注 eBook 时承载定位元数据 (default null, decision 022 §1.3.1)
    bookAnchor: { default: null },
    // D023 §4.1: lucide icon 名,null 走 emoji 模式
    iconName: { default: null },
    // D024 §4.1: 用户上传图 media:// URL,null 走 iconName / emoji 模式
    imageSrc: { default: null },
  },
  parseDOM: [
    {
      tag: 'div.krig-callout',
      getAttrs(node) {
        const el = node as HTMLElement;
        return {
          emoji: el.getAttribute('data-emoji') || '💡',
          iconName: el.getAttribute('data-icon-name') || null,
          imageSrc: el.getAttribute('data-image-src') || null,
        };
      },
    },
  ],
  toDOM(node) {
    const attrs: Record<string, string> = {
      class: 'krig-callout',
      'data-emoji': node.attrs.emoji as string,
    };
    if (node.attrs.iconName) {
      attrs['data-icon-name'] = node.attrs.iconName as string;
    }
    if (node.attrs.imageSrc) {
      attrs['data-image-src'] = node.attrs.imageSrc as string;
    }
    return ['div', attrs, 0];
  },
};

export const calloutSpec: BlockSpec = {
  id: 'callout',
  displayName: 'Callout',
  spec: calloutNodeSpec,
  containerRule: 'block+',
  cascadeBoundary: false,
  nodeView: calloutNodeView,
};
