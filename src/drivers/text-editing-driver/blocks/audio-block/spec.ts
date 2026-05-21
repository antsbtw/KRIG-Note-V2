/**
 * audioBlock — HTML5 audio 播放 + 标题 + 下载 + caption(L5-B3.16)
 *
 * V1 → V2 直迁:src/plugins/note/blocks/audio-block.ts(163 行)
 *
 * 两态:
 * - placeholder(无 src):🎵 + Choose file + URL embed
 * - player(有 src):title + <audio controls> + 下载按钮(http(s) 源)+ caption
 *
 * caption:`content: 'block'` 单段(对齐 image 模式 — V2 PM content 表达式不允许节点
 * 名含短横线,只能引用 group;'block' group 表示单 block,跟 V1 单 caption 等价)。
 *
 * V1 → V2 改造:
 * - viewAPI.downloadMedia → V2 直接 mediaDownload(L5-B4.3.1 已落)
 * - 不复用 V1 createRenderBlockView 共享基类(对齐 L5-B3.5 image 各自独立 NodeView)
 * - 砍 V1 sourcePages / thoughtId 字段(KRIG 知识图谱挂钩留 D 阶段);atomId 由 L7 block atomization rename 为 id 承接
 */

import type { NodeSpec } from 'prosemirror-model';
import type { BlockSpec } from '../../types';
import { audioBlockNodeView } from './node-view';

const audioBlockNodeSpec: NodeSpec = {
  group: 'block',
  content: 'block',          // 同 image — 单段 caption,'block' group 兼容
  draggable: true,
  selectable: true,
  attrs: {
    src: { default: null },        // media:// / https:// / data:
    title: { default: 'Audio' },
    mimeType: { default: null },
    duration: { default: null },   // 秒数(可选)
    // L7 block atomization (decision 026 §3.1.1 / §4 / §4.4 字面 rename atomId→id):
    // block atom 稳定 ULID,与 atom.id 同步
    id: { default: null },
    // sub-phase 022: 标注 eBook 时承载定位元数据 (default null, decision 022 §1.3.1)
    bookAnchor: { default: null },
  },
  parseDOM: [
    {
      tag: 'div.krig-audio-block',
      getAttrs(node) {
        const el = node as HTMLElement;
        const durStr = el.getAttribute('data-duration');
        return {
          src: el.getAttribute('data-src') || null,
          title: el.getAttribute('data-title') || 'Audio',
          mimeType: el.getAttribute('data-mime') || null,
          duration: durStr ? Number(durStr) || null : null,
        };
      },
    },
  ],
  toDOM(node) {
    const attrs: Record<string, string> = { class: 'krig-audio-block' };
    if (node.attrs.src) attrs['data-src'] = node.attrs.src as string;
    if (node.attrs.title) attrs['data-title'] = node.attrs.title as string;
    if (node.attrs.mimeType) attrs['data-mime'] = node.attrs.mimeType as string;
    if (node.attrs.duration != null) attrs['data-duration'] = String(node.attrs.duration);
    return [
      'div',
      attrs,
      // serializer hint:实际渲染由 NodeView 接管;caption 走 contentDOM(PM)
      ['figcaption', { class: 'krig-audio-block__caption' }, 0],
    ];
  },
};

export const audioBlockSpec: BlockSpec = {
  id: 'audioBlock',
  displayName: 'Audio',
  spec: audioBlockNodeSpec,
  nodeView: audioBlockNodeView,
  containerRule: 'inline-only',
  cascadeBoundary: false,
};
