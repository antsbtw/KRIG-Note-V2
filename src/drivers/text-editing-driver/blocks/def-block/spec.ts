/**
 * defBlock — 定义块(`00 §2.5`,正式名称见 `§2.5.7`)
 *
 * ⭐⭐ **note 的一等能力**:给块写「定义」—— 属性、关系、样式。
 * graph(mind / 画板 / BPMN)只是**调用者**,各自定义词表与含义(`00 §2.5.9`)。
 *
 * ── 为什么是真块,不是「paragraph 里塞两行 +++」──────────
 * ⚠️ 前一版规格(`00 §2.5.2`)写的是「就是 paragraph,零新块」,那是在
 * 「def 归 mind」的前提下为了不动 note 本体。归属改判后前提没了:
 * def 既然是 note 的能力,就该有真块 —— 靠记号硬凑的形态没有 attrs、
 * 折叠状态无处安放、序列化每次都要重新猜边界。
 *
 * ── content: 'text*' ──────────────────────────────────
 * ⭐ 对齐 codeBlock:纯文本、无 marks、`code: true` 让 PM 走代码区键盘语义
 * (Enter = 换行而非拆块)—— def 块本就是**逐行的词法**,富文本进来只会
 * 让「逐字节往返」失守。⚠️ 词法本身在 lexicon.ts,本块不解释任何 key。
 *
 * ── attrs ─────────────────────────────────────────────
 * - `id`     block atom 稳定 ULID(decision 026;⚠️ 缺了会 dissect throw → 改动静默不保存)
 * - `for`    ⭐ 归属(用户 2026-09-13 拍板「甲为主 + 乙可选」):
 *            **默认 null = 定义紧挨它前面那个块**(位置约定,手写零负担);
 *            程序化场景可显式写目标 blockId,挪动不失联。
 * - `open`   折叠态(用户拍板**默认折叠**);⚠️ 新插入时由插入方置 true 便于当场写。
 *            ⭐ 折叠态塌成一条双线:不显内容、无 handle、完全不可交互(只能点开)。
 *            ⚠️ 故它的删除入口在 backspace-decision 第 7.5 步(下一段行首 Backspace)。
 */

import type { NodeSpec } from 'prosemirror-model';
import type { BlockSpec } from '../../types';
import { defBlockNodeView } from './node-view';

const defBlockNodeSpec: NodeSpec = {
  content: 'text*',
  marks: '',
  group: 'block',
  code: true,
  defining: true,
  attrs: {
    // L7 block atomization (decision 026 §3.1.1 / §4): block atom 稳定 ULID,与 atom.id 同步
    id: { default: null },
    // ⭐ 甲为主 + 乙可选:null = 定义上一个块;显式 blockId = 定向绑定
    for: { default: null },
    // ⭐ 用户拍板默认折叠(长文档里每个节点下杵着几行 id:/shape: 太吵)
    open: { default: false },
  },
  parseDOM: [
    {
      tag: 'div.krig-def-block',
      preserveWhitespace: 'full',
      getAttrs(node) {
        const el = node as HTMLElement;
        return {
          for: el.getAttribute('data-for') || null,
          open: el.getAttribute('data-open') === 'true',
        };
      },
    },
  ],
  toDOM(node) {
    const attrs: Record<string, string> = {
      class: 'krig-def-block',
      'data-open': String(node.attrs.open === true),
    };
    if (node.attrs.for) attrs['data-for'] = node.attrs.for as string;
    return ['div', attrs, ['pre', { class: 'krig-def-block__body' }, 0]];
  },
};

export const defBlockSpec: BlockSpec = {
  id: 'defBlock',
  displayName: 'Definition',
  spec: defBlockNodeSpec,
  nodeView: defBlockNodeView,
  containerRule: 'inline-only',
  cascadeBoundary: true,
};
