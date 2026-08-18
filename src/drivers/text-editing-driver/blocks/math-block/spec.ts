/**
 * mathBlock — 块级数学公式 LaTeX block(L5-B3.6)
 *
 * V1 → V2 直迁:src/plugins/note/blocks/math-block.ts
 *
 * 两态:
 * - rendered:KaTeX 渲染 displayMode(默认显示)
 * - edit:LaTeX 源码 + 实时预览(双击 / 单击空块进入)
 *
 * NodeSpec:content='text*' + code:true,文本节点装 LaTeX 源码;NodeView 渲染
 *
 * attrs:
 *   color    rendered KaTeX 文本色(覆盖 default)
 *   bgColor  整块背景色
 */

import type { NodeSpec } from 'prosemirror-model';
import type { BlockSpec } from '../../types';
import { mathBlockNodeView } from './node-view';

const mathBlockNodeSpec: NodeSpec = {
  content: 'text*',
  group: 'block',
  code: true,
  defining: true,
  // 不含 inline marks(纯 LaTeX 源码,bold/italic 等没意义)
  marks: '',
  attrs: {
    // L7 block atomization (decision 026 §3.1.1 / §4): block atom 稳定 ULID,与 atom.id 同步
    id: { default: null },
    color: { default: null },
    bgColor: { default: null },
    // sub-phase 022: 标注 eBook 时承载定位元数据 (default null, decision 022 §1.3.1)
    bookAnchor: { default: null },
  },
  parseDOM: [
    {
      tag: 'div.krig-math-block',
      preserveWhitespace: 'full',
      getAttrs(node) {
        const el = node as HTMLElement;
        return {
          color: el.getAttribute('data-color') || null,
          bgColor: el.getAttribute('data-bg-color') || null,
        };
      },
    },
  ],
  toDOM(node) {
    const attrs: Record<string, string> = { class: 'krig-math-block' };
    if (node.attrs.color) attrs['data-color'] = node.attrs.color as string;
    if (node.attrs.bgColor) attrs['data-bg-color'] = node.attrs.bgColor as string;
    // 内层**不能**用 <pre>:复制粘贴时 DOMParser 自顶向下解析,外层 div 命中本 block 后
    // 进内容区找 text*,而内层 <pre> 会命中 codeBlock 的 `tag: 'pre'` 规则解析成**块级**
    // 节点 —— text* 装不下块 → PM 就地关掉 mathBlock、把 codeBlock 提为兄弟节点,
    // 结果公式源码整个被 codeBlock 拿走、mathBlock 剩空壳(粘贴后一个空公式框 + 一个代码块)。
    // 本元素只用于剪贴板/导出序列化(屏幕渲染走 node-view 自建 DOM),故换 div 无视觉影响;
    // 空白由 parseDOM 的 preserveWhitespace:'full' 保证,不依赖 <pre> 标签语义。
    return ['div', attrs, ['div', { class: 'krig-math-block__code' }, 0]];
  },
};

export const mathBlockSpec: BlockSpec = {
  id: 'mathBlock',
  displayName: 'Math Block',
  spec: mathBlockNodeSpec,
  nodeView: mathBlockNodeView,
  containerRule: 'inline-only',
  cascadeBoundary: false,
};
