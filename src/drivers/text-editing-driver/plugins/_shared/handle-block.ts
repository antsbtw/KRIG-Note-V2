/**
 * handle-block — "handle 视觉单元"块边界共享算法
 *
 * **职责**:把 PM doc 内的任意 pos 解析为对应"具体可拖动 block"边界。
 *   block-handle plugin 用它定位 ⋮⋮ 浮标;
 *   block-selection plugin 用它对齐"块"语义(选择/拖动/复制单位)。
 *
 * **规则**(对齐 Notion):
 *   1. 在 list 内 → 取 `listItem` / `taskItem` 层(list 项是独立 handle 单元,
 *      整组 list 不是"一块",每个 item 各自有 ⋮⋮)
 *   2. 否则 → 取**最深**的 `group='block'` 节点(callout > paragraph 命中
 *      内层 paragraph,而非外层 callout)
 *
 * 多块选择规则补充:
 *   - 选区永远在**同一 parent**(同级 sibling)内
 *   - 容器型 block(callout/toggle/blockquote 等)在它所在的 parent 中**整体算 1 块**;
 *     扩选撞到容器边界 → 容器作为一个 sibling 被纳入,不钻进去
 *
 * **副作用**:无,纯函数。
 */

import type { Node } from 'prosemirror-model';

export interface HandleBlockInfo {
  /** 块在 doc 内的 before pos */
  start: number;
  /** 块在 doc 内的 after pos */
  end: number;
  /** 块节点本身 */
  node: Node;
  /** 块在 doc tree 内的 depth(1 = top-level block,>1 = 嵌套)*/
  depth: number;
  /** 父节点(用于"同级 sibling 选择")*/
  parent: Node;
  /** 块在 parent 内的 child index */
  indexInParent: number;
  /** 父节点在 doc 内的 before pos;-1 表 parent = doc 自身 */
  parentStart: number;
}

/** pos → 对应 handle block;null 表 pos 不在合法 block 内 */
export function resolveHandleBlock(doc: Node, pos: number): HandleBlockInfo | null {
  const clamped = Math.max(0, Math.min(pos, doc.content.size));
  const $pos = doc.resolve(clamped);
  if ($pos.depth < 1) return null;

  // 先找 listItem / taskItem
  let targetDepth = -1;
  for (let d = $pos.depth; d >= 1; d--) {
    const node = $pos.node(d);
    if (node.type.name === 'listItem' || node.type.name === 'taskItem') {
      targetDepth = d;
      break;
    }
  }
  // 否则取最深 group='block'
  if (targetDepth < 0) {
    for (let d = $pos.depth; d >= 1; d--) {
      if ($pos.node(d).type.spec.group === 'block') {
        targetDepth = d;
        break;
      }
    }
  }
  if (targetDepth < 0) return null;

  const node = $pos.node(targetDepth);
  const start = $pos.before(targetDepth);
  const end = start + node.nodeSize;
  const parent = $pos.node(targetDepth - 1);
  const indexInParent = $pos.index(targetDepth - 1);
  const parentStart = targetDepth - 1 === 0 ? -1 : $pos.before(targetDepth - 1);

  return { start, end, node, depth: targetDepth, parent, indexInParent, parentStart };
}

export interface SiblingInfo {
  index: number;
  start: number;
  end: number;
  node: Node;
}

/**
 * 列出 parent 的所有 sibling block(给"同级扩选"用)。
 *
 * @param parent       父节点
 * @param parentStart  父节点在 doc 内的 before pos;-1 表 parent=doc
 */
export function listSiblings(parent: Node, parentStart: number): SiblingInfo[] {
  const out: SiblingInfo[] = [];
  let offset = parentStart === -1 ? 0 : parentStart + 1;
  for (let i = 0; i < parent.childCount; i++) {
    const node = parent.child(i);
    out.push({ index: i, start: offset, end: offset + node.nodeSize, node });
    offset += node.nodeSize;
  }
  return out;
}
