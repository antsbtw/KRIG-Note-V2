/**
 * listItem — bullet-list / ordered-list 内部的列表项
 *
 * id 用驼峰(`listItem`)— PM content 表达式不支持节点 name 含短横线。
 * content: 'block+' — 用 group 'block' 引用(允许 paragraph / heading / list 等任意 block 嵌套)。
 */

import type { NodeSpec } from 'prosemirror-model';
import type { BlockSpec } from '../../types';

const INDENT_STEP_PX = 24;
const MAX_INDENT = 8;

const listItemNodeSpec: NodeSpec = {
  content: 'block+',
  defining: true,
  attrs: {
    // L7 block atomization (decision 026 §3.1.1 / §4): block atom 稳定 ULID,与 atom.id 同步
    id: { default: null },
    // sub-phase 022: 标注 eBook 时承载定位元数据 (default null, decision 022 §1.3.1)
    bookAnchor: { default: null },
    // 视觉缩进级数(0-8)。列表项 Tab = 整项右移(用户要的「整体右移一级」效果,
    // 非 sink 嵌套)。listItem 不是顶层 block,通用 block-indent-plugin(只遍历 doc 顶层)
    // 渲染不到,故直接在 toDOM 里出 margin-left。attrs 随 dissect/assemble 原样持久化。
    indent: { default: 0 },
  },
  parseDOM: [
    {
      tag: 'li',
      getAttrs: (dom) => {
        const el = dom as HTMLElement;
        const raw = el.getAttribute('data-indent');
        const n = raw ? parseInt(raw, 10) : 0;
        return { indent: Number.isFinite(n) ? Math.max(0, Math.min(MAX_INDENT, n)) : 0 };
      },
    },
  ],
  toDOM(node) {
    const indent = (node.attrs.indent as number | undefined) ?? 0;
    if (indent > 0) {
      return [
        'li',
        { 'data-indent': String(indent), style: `margin-left: ${indent * INDENT_STEP_PX}px` },
        0,
      ];
    }
    return ['li', 0];
  },
};

export const listItemSpec: BlockSpec = {
  id: 'listItem',
  displayName: 'List Item',
  spec: listItemNodeSpec,
  containerRule: 'block+',
  cascadeBoundary: false,
};
