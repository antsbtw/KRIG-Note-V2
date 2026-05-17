/**
 * MultipleNodeSelection — 同级 sibling 多块选择(PM Selection 子类)
 *
 * 设计参考: BlockNote SideMenu/MultipleNodeSelection.ts (MPL-2.0)
 *   https://github.com/TypeCellOS/BlockNote/blob/main/packages/core/src/extensions/SideMenu/MultipleNodeSelection.ts
 *   Marijn (PM 作者) 在 https://discuss.prosemirror.net/t/2569 推荐的扩展方式。
 *
 * **核心约束**: anchor / head 两端必须位于**同一 parent 的两个 sibling 之间**。
 *   选区范围 = parent.children.slice(min, max+1) 的连续 child blocks。
 *   "块"边界由 _shared/handle-block.ts 的 resolveHandleBlock 决定(handle 视觉单元)。
 *
 * **PM 集成**:
 *   - Selection.jsonID 注册为 'multiple-node',让 tr.setSelection / undo/redo
 *     / clipboard serialization 全部走 PM 默认 pipeline。
 *   - content() 返回 Slice(openStart=openEnd=0),让 Copy/Cut/Drag 自动序列化。
 *   - replace() / replaceWith() 走 PM 默认,删除整组 sibling。
 *
 * **不实现**(由 PM 默认即可):
 *   - visible(): PM 自己看 from/to 画 ::selection;视觉额外的"整块罩底"由
 *     block-selection plugin 用 decoration 画。
 */

import { Selection, type SelectionBookmark } from 'prosemirror-state';
import {
  type Node as PMNode,
  type ResolvedPos,
  Slice,
  Fragment,
} from 'prosemirror-model';
import type { Mappable } from 'prosemirror-transform';

/**
 * MultipleNodeSelection bookmark — 持久化锚点(history / collab 用)
 */
class MultipleNodeSelectionBookmark implements SelectionBookmark {
  constructor(
    readonly anchor: number,
    readonly head: number,
  ) {}

  map(mapping: Mappable): MultipleNodeSelectionBookmark {
    return new MultipleNodeSelectionBookmark(
      mapping.map(this.anchor),
      mapping.map(this.head),
    );
  }

  resolve(doc: PMNode): Selection {
    const $anchor = doc.resolve(Math.min(this.anchor, doc.content.size));
    const $head = doc.resolve(Math.min(this.head, doc.content.size));
    return MultipleNodeSelection.create($anchor, $head);
  }
}

/**
 * MultipleNodeSelection — 同级多块选区
 */
export class MultipleNodeSelection extends Selection {
  /**
   * 构造:anchor/head 必须都解析到**同一 parent**(depth 相同 + parent 相同)。
   * 否则会抛 RangeError(调用方应先用 resolveHandleBlock 对齐两端再构造)。
   */
  constructor(
    public readonly $anchorPos: ResolvedPos,
    public readonly $headPos: ResolvedPos,
  ) {
    if ($anchorPos.depth !== $headPos.depth) {
      throw new RangeError('MultipleNodeSelection: anchor/head must be at same depth');
    }
    if ($anchorPos.depth < 1) {
      throw new RangeError('MultipleNodeSelection: depth must be >= 1');
    }
    // 取 anchor/head 在 parent 内的 index,确保 from <= to
    const anchorIdx = $anchorPos.index($anchorPos.depth - 1);
    const headIdx = $headPos.index($headPos.depth - 1);
    const minIdx = Math.min(anchorIdx, headIdx);
    const maxIdx = Math.max(anchorIdx, headIdx);
    const parent = $anchorPos.node($anchorPos.depth - 1);
    if (parent !== $headPos.node($headPos.depth - 1)) {
      throw new RangeError('MultipleNodeSelection: anchor/head must share the same parent');
    }
    // 计算 from / to 在 doc 内的 pos
    const parentStart =
      $anchorPos.depth - 1 === 0 ? -1 : $anchorPos.before($anchorPos.depth - 1);
    let offset = parentStart === -1 ? 0 : parentStart + 1;
    let from = offset;
    let to = offset;
    for (let i = 0; i < parent.childCount; i++) {
      const childSize = parent.child(i).nodeSize;
      if (i === minIdx) from = offset;
      offset += childSize;
      if (i === maxIdx) to = offset;
    }
    super($anchorPos.doc.resolve(from), $anchorPos.doc.resolve(to));
  }

  /** 选中的 sibling block 节点数组(升序) */
  get nodes(): PMNode[] {
    const parent = this.$anchorPos.node(this.$anchorPos.depth - 1);
    const anchorIdx = this.$anchorPos.index(this.$anchorPos.depth - 1);
    const headIdx = this.$headPos.index(this.$headPos.depth - 1);
    const minIdx = Math.min(anchorIdx, headIdx);
    const maxIdx = Math.max(anchorIdx, headIdx);
    const out: PMNode[] = [];
    for (let i = minIdx; i <= maxIdx; i++) out.push(parent.child(i));
    return out;
  }

  /** PM 协议:序列化为 Slice 给 Copy/Cut/Drag 用 */
  override content(): Slice {
    return new Slice(Fragment.fromArray(this.nodes), 0, 0);
  }

  /** PM 协议:替换选区(删除整组)*/
  override replace(tr: import('prosemirror-state').Transaction, content: Slice = Slice.empty): void {
    if (content === Slice.empty) {
      tr.delete(this.from, this.to);
    } else {
      tr.replace(this.from, this.to, content);
    }
  }

  override eq(other: Selection): boolean {
    return (
      other instanceof MultipleNodeSelection &&
      other.anchor === this.anchor &&
      other.head === this.head
    );
  }

  override map(doc: PMNode, mapping: Mappable): Selection {
    const $anchor = doc.resolve(mapping.map(this.anchor));
    const $head = doc.resolve(mapping.map(this.head));
    try {
      return MultipleNodeSelection.create($anchor, $head);
    } catch {
      // doc 变化后 anchor/head 不再同级 → fallback 到 text selection 端点
      return Selection.near($head);
    }
  }

  override getBookmark(): SelectionBookmark {
    return new MultipleNodeSelectionBookmark(this.anchor, this.head);
  }

  override toJSON(): { type: 'multiple-node'; anchor: number; head: number } {
    return { type: 'multiple-node', anchor: this.anchor, head: this.head };
  }

  /** Selection.jsonID 反序列化入口 */
  static fromJSON(doc: PMNode, json: unknown): MultipleNodeSelection {
    if (
      typeof json !== 'object' ||
      json === null ||
      typeof (json as { anchor?: unknown }).anchor !== 'number' ||
      typeof (json as { head?: unknown }).head !== 'number'
    ) {
      throw new RangeError('MultipleNodeSelection.fromJSON: invalid input');
    }
    const j = json as { anchor: number; head: number };
    return MultipleNodeSelection.create(doc.resolve(j.anchor), doc.resolve(j.head));
  }

  /**
   * 工厂:接受 anchor/head 两个 ResolvedPos,构造 MultipleNodeSelection。
   *
   * 调用方需保证两端 $pos 已经对齐到同一 parent 下的 sibling 位置;
   * 否则构造器抛 RangeError。
   */
  static create($anchor: ResolvedPos, $head: ResolvedPos): MultipleNodeSelection {
    return new MultipleNodeSelection($anchor, $head);
  }
}

// 注册 Selection.jsonID — PM 走 transaction/history/clipboard 时识别类型
Selection.jsonID('multiple-node', MultipleNodeSelection);
