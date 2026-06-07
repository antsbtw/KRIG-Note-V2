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
 * 内向偏置映射 anchor/head。
 *
 * anchor/head 是「块的 before-pos / after-pos」边界。after-pos 同时是下一块的 before-pos
 * (块边界点),用默认 assoc(+1)映射会把它推进下一块内部 → 选区从单块错扩成双块
 * (Tab 缩进 / Cmd+Z 撤销后选区染到相邻块的根因)。
 *
 * 修法:两端各自向**选区内侧**收 —— 数值大的一端用 assoc=-1(咬住本块尾,不进下一块),
 * 数值小的一端用 assoc=+1(咬住本块头)。这样块边界点稳定停在选中范围内,不漂移。
 */
function mapInward(
  mapping: Mappable,
  anchor: number,
  head: number,
): { anchor: number; head: number } {
  const anchorIsHigher = anchor >= head;
  return {
    anchor: mapping.map(anchor, anchorIsHigher ? -1 : 1),
    head: mapping.map(head, anchorIsHigher ? 1 : -1),
  };
}

/**
 * MultipleNodeSelection bookmark — 持久化锚点(history / collab 用)
 */
class MultipleNodeSelectionBookmark implements SelectionBookmark {
  constructor(
    readonly anchor: number,
    readonly head: number,
  ) {}

  map(mapping: Mappable): MultipleNodeSelectionBookmark {
    const m = mapInward(mapping, this.anchor, this.head);
    return new MultipleNodeSelectionBookmark(m.anchor, m.head);
  }

  resolve(doc: PMNode): Selection {
    const $anchor = doc.resolve(Math.min(this.anchor, doc.content.size));
    const $head = doc.resolve(Math.min(this.head, doc.content.size));
    // 与 MultipleNodeSelection.map 同款防御:bookmark 在 mapping 后可能落到
    // depth=0 / 跨 parent / 单点位置 — 构造器会抛 RangeError。history undo
    // 调本方法还原选区时一旦抛错会让整个 undo 失败(框定后 Cmd+Z 卡死的根因)。
    // 抛错就 fallback 到 head 附近的 text selection,保证 undo 完成。
    try {
      return MultipleNodeSelection.create($anchor, $head);
    } catch {
      return Selection.near($head);
    }
  }
}

/**
 * 把 ResolvedPos 归一化为 (parent + parentDepth + childIdx) 形式。
 *
 * 同一个 sibling layer 在 PM 里有两种 $pos 表达:
 *  1. $pos 落在 child 内部某处:depth = childDepth,parent 在 depth-1
 *  2. $pos 落在 atom child 的 before/after 间隙(atom 无 inside):depth = parentDepth
 *
 * 归一化让 MNS 同时接纳两种表达,关键是表达"同一 sibling 层"的能力 — atom 与
 * 非 atom 邻居能共存于同一 MNS。
 */
function normalizeParentInfo(
  $pos: ResolvedPos,
): { parent: PMNode; parentDepth: number; idx: number } {
  if ($pos.depth === 0) {
    // doc 顶层间隙:parent = doc 自身,idx = $pos.index(0)
    return { parent: $pos.parent, parentDepth: 0, idx: $pos.index(0) };
  }
  // depth >= 1: $pos 在某 child 内部,parent 在 depth-1
  return {
    parent: $pos.node($pos.depth - 1),
    parentDepth: $pos.depth - 1,
    idx: $pos.index($pos.depth - 1),
  };
}

/**
 * MultipleNodeSelection — 同级多块选区
 */
export class MultipleNodeSelection extends Selection {
  /** 归一化后的 parent + sibling 范围(idx 升序) */
  readonly parent: PMNode;
  readonly parentDepth: number;
  readonly anchorIdx: number;
  readonly headIdx: number;

  /**
   * 构造:anchor/head 必须能归一化到**同一 parent**。
   *
   * 允许的两种 $pos 形式(对齐 PM resolve 自然行为):
   *  - $pos 落在 child 内部(常规情况,depth = childDepth)
   *  - $pos 落在 atom child 的间隙(depth = parentDepth) — 支持 hr 等无内容叶子
   *
   * 不同 form 的 $pos 只要归一化后 parent 相同 + parentDepth 相同 即合法。
   */
  constructor(
    public readonly $anchorPos: ResolvedPos,
    public readonly $headPos: ResolvedPos,
  ) {
    const a = normalizeParentInfo($anchorPos);
    const h = normalizeParentInfo($headPos);
    if (a.parentDepth !== h.parentDepth) {
      throw new RangeError('MultipleNodeSelection: anchor/head normalize to different parent depth');
    }
    if (a.parent !== h.parent) {
      throw new RangeError('MultipleNodeSelection: anchor/head must share the same parent');
    }
    const minIdx = Math.min(a.idx, h.idx);
    const maxIdx = Math.max(a.idx, h.idx);
    // 计算 from / to 在 doc 内的 pos:
    // - parentDepth=0 时 parent 是 doc 顶层,parentStart 设 -1(下方循环从 offset=0 起)
    // - parentDepth>=1 时需要 parent 的 before pos,从两端中取 depth > parentDepth
    //   的一端调 .before(parentDepth)(atom 端 depth===parentDepth 不可调,会抛错)
    const sourcePos = $anchorPos.depth > a.parentDepth ? $anchorPos : $headPos;
    const parentStart =
      a.parentDepth === 0 ? -1 :
      sourcePos.depth > a.parentDepth ? sourcePos.before(a.parentDepth) :
      -1; // 两端都是 atom + parentDepth=0 时走上面分支;若 parentDepth>=1 但都是 atom 不可能存在
    let offset = parentStart === -1 ? 0 : parentStart + 1;
    let from = offset;
    let to = offset;
    for (let i = 0; i < a.parent.childCount; i++) {
      const childSize = a.parent.child(i).nodeSize;
      if (i === minIdx) from = offset;
      offset += childSize;
      if (i === maxIdx) to = offset;
    }
    super($anchorPos.doc.resolve(from), $anchorPos.doc.resolve(to));
    this.parent = a.parent;
    this.parentDepth = a.parentDepth;
    this.anchorIdx = a.idx;
    this.headIdx = h.idx;
  }

  /** 选中的 sibling block 节点数组(升序) */
  get nodes(): PMNode[] {
    const minIdx = Math.min(this.anchorIdx, this.headIdx);
    const maxIdx = Math.max(this.anchorIdx, this.headIdx);
    const out: PMNode[] = [];
    for (let i = minIdx; i <= maxIdx; i++) out.push(this.parent.child(i));
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
    // 映射用**内部** $anchorPos/$headPos(指向块内容内部 / atom 间隙),而非基类 anchor/head
    // (= 归一化后的 from/to 块边界)。块边界点同时是相邻块边界,任何 assoc 都可能漂进相邻块
    // (Tab 缩进 / Cmd+Z 后单块错扩双块的根因);内部位不在块边界上,映射稳定不漂。
    // 仍叠加内向偏置兜底 atom 间隙端。
    const m = mapInward(mapping, this.$anchorPos.pos, this.$headPos.pos);
    const $anchor = doc.resolve(m.anchor);
    const $head = doc.resolve(m.head);
    try {
      return MultipleNodeSelection.create($anchor, $head);
    } catch {
      // doc 变化后 anchor/head 不再同 parent → fallback 到 text selection
      return Selection.near($head);
    }
  }

  override getBookmark(): SelectionBookmark {
    // 存**内部** $anchorPos/$headPos(非块边界 from/to)—— 与 map 同理,边界点 undo 后会漂进
    // 相邻块。内部位稳定,bookmark.resolve 还原选区精确不扩块(Cmd+Z 单块错扩双块的修复)。
    return new MultipleNodeSelectionBookmark(this.$anchorPos.pos, this.$headPos.pos);
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
// guard:重复 import 同一模块时不应重复注册(PM 第二次会抛 RangeError)
// 注:Selection.jsonID 没有公开查询 API,用 try/catch 防御
interface GlobalWithRegistrationFlag {
  __krigMultipleNodeSelectionRegistered?: boolean;
}
const g = globalThis as unknown as GlobalWithRegistrationFlag;
if (!g.__krigMultipleNodeSelectionRegistered) {
  Selection.jsonID('multiple-node', MultipleNodeSelection);
  g.__krigMultipleNodeSelectionRegistered = true;
}
