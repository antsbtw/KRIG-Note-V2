/**
 * resolve-context — 光标 → 键盘决策所需的事实 + 祖先栈
 *
 * keyboard-system.md §二「光标位置归一化」。任意键盘事件先归一成一组事实,
 * Enter/Backspace 决策链全由这些事实驱动。
 *
 * Phase 0(脚手架):纯函数,不挂载。Phase 1/2 决策链消费。
 */

import type { EditorState } from 'prosemirror-state';
import type { Node as PMNode, ResolvedPos } from 'prosemirror-model';
import type { KeyboardMeta } from '../types';

/** 单层祖先(从内到外栈中的一项)。 */
export interface AncestorLayer {
  /** 该层节点 */
  node: PMNode;
  /** 该层在 doc 中的 depth */
  depth: number;
  /** 该层节点的 before pos */
  before: number;
  /** 当前光标路径在该层 parent 内的 child index */
  index: number;
  /** 该层是否其 parent 的首个 child(沿光标路径) */
  isFirstChild: boolean;
  /** 该层是否其 parent 的末个 child(沿光标路径) */
  isLastChild: boolean;
}

/** 键盘决策上下文(keyboard-system.md §二的 4 个事实 + 栈)。 */
export interface KeyboardContext {
  state: EditorState;
  $from: ResolvedPos;
  /** 选区是否折叠(无选中) */
  empty: boolean;
  /** 光标所在 textblock(最内层 isTextblock 节点);非 textblock 光标时为 null */
  block: PMNode | null;
  /** block 的 depth(光标所在 textblock 的 depth) */
  blockDepth: number;
  /** 光标在当前块起点(行首) */
  atBlockStart: boolean;
  /** 光标在当前块终点(行尾) */
  atBlockEnd: boolean;
  /** 当前块是否空 */
  isEmptyBlock: boolean;
  /** 从内到外的祖先层栈(不含 doc 顶层;index 0 = 最内层容器) */
  ancestors: AncestorLayer[];
}

/**
 * 取节点的键盘元数据(BlockSpec.keyboard);keyboard-system.md §5.3。
 * Phase 1/2 会从 schema/blockSpec 注入查表;Phase 0 先留接口,默认空。
 */
export type KeyboardMetaLookup = (typeName: string) => KeyboardMeta | undefined;

/**
 * 归一化光标上下文。
 *
 * 仅处理折叠光标的「块级」事实;非折叠选区由决策链入口单独处理(replaceSelection/deleteSelection)。
 */
export function resolveKeyboardContext(state: EditorState): KeyboardContext {
  const sel = state.selection;
  const { $from, empty } = sel;

  // 光标所在 textblock:从 $from.depth 向内找最近 isTextblock
  let block: PMNode | null = null;
  let blockDepth = 0;
  for (let d = $from.depth; d >= 0; d--) {
    const n = $from.node(d);
    if (n.isTextblock) {
      block = n;
      blockDepth = d;
      break;
    }
  }

  const atBlockStart = block ? $from.parentOffset === 0 && $from.depth === blockDepth : false;
  const atBlockEnd = block ? $from.parentOffset === block.content.size && $from.depth === blockDepth : false;
  const isEmptyBlock = block ? block.content.size === 0 : false;

  // 祖先栈:从 blockDepth-1 向外到 1(depth 0 是 doc 顶层,不入栈)
  const ancestors: AncestorLayer[] = [];
  for (let d = blockDepth - 1; d >= 1; d--) {
    const node = $from.node(d);
    const parentIndex = $from.index(d - 1);
    const parent = $from.node(d - 1);
    ancestors.push({
      node,
      depth: d,
      before: $from.before(d),
      index: parentIndex,
      isFirstChild: parentIndex === 0,
      isLastChild: parentIndex === parent.childCount - 1,
    });
  }

  return {
    state,
    $from,
    empty,
    block,
    blockDepth,
    atBlockStart,
    atBlockEnd,
    isEmptyBlock,
    ancestors,
  };
}
