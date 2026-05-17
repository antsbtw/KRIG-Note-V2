/**
 * selection 集成 — 实例隔离 source + 真变才 emit + activeMarks/activeBlockType/activeLevel
 *
 * 见 DESIGN.md v0.2.1 § 5.1 + L5B2 设计 § 3.5。
 *
 * 性能优化(L5-B2):每个 instance 自维护 lastSnapshot,真变才 emit;
 *  避免每次 transaction 都触发订阅者(Toolbar 等)重渲。
 */

import type { EditorState } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { selection, type SelectionKind, type SelectionPayload } from '@capabilities/selection';
import { MultipleNodeSelection } from '../plugins/_shared/multiple-node-selection';

const SOURCE_PREFIX = 'text-editing-driver:';

interface SelectionSnapshot {
  isEmpty: boolean;
  from: number;
  to: number;
  anchor: number;
  head: number;
  marksKey: string;       // activeMarks join('|')
  blockType: string;
  level: number | null;
  kind: SelectionKind;
  positionsKey: string;   // MNS 选中块的 before pos join('|'),仅 block/multi-block 用
}

/** 实例 ID → 上次快照(diff 用)*/
const lastSnapshots = new Map<string, SelectionSnapshot>();

export function buildSourceId(instanceId: string): string {
  return `${SOURCE_PREFIX}${instanceId}`;
}

export function registerSelectionSource(instanceId: string): () => void {
  const source = buildSourceId(instanceId);
  selection.registerSource({ source });
  return () => {
    selection.unregisterSource(source);
    lastSnapshots.delete(instanceId);
  };
}

export function emitSelectionChanged(view: EditorView, instanceId: string): void {
  const state = view.state;
  const sel = state.selection;
  const $from = sel.$from;
  const node = $from.node($from.depth);

  const activeMarks = computeActiveMarks(state);
  const blockType = node.type.name;
  const level = (node.attrs.level as number | null) ?? null;

  // 识别 MultipleNodeSelection → block / multi-block kind;否则 text
  let kind: SelectionKind = 'text';
  let positions: number[] = [];
  if (sel instanceof MultipleNodeSelection) {
    const nodes = sel.nodes;
    kind = nodes.length === 1 ? 'block' : 'multi-block';
    // 算每块在 doc 内的 before pos
    const parent = sel.$anchorPos.node(sel.$anchorPos.depth - 1);
    const minIdx = Math.min(
      sel.$anchorPos.index(sel.$anchorPos.depth - 1),
      sel.$headPos.index(sel.$headPos.depth - 1),
    );
    const parentDepth = sel.$anchorPos.depth - 1;
    const parentStart = parentDepth === 0 ? -1 : sel.$anchorPos.before(parentDepth);
    let offset = parentStart === -1 ? 0 : parentStart + 1;
    for (let i = 0; i < parent.childCount; i++) {
      if (i >= minIdx && i < minIdx + nodes.length) positions.push(offset);
      offset += parent.child(i).nodeSize;
    }
  }

  const snapshot: SelectionSnapshot = {
    isEmpty: sel.empty,
    from: sel.from,
    to: sel.to,
    anchor: sel.anchor,
    head: sel.head,
    marksKey: activeMarks.join('|'),
    blockType,
    level,
    kind,
    positionsKey: positions.join('|'),
  };

  // 真变才 emit
  const prev = lastSnapshots.get(instanceId);
  if (prev && shallowEqualSnapshot(prev, snapshot)) return;
  lastSnapshots.set(instanceId, snapshot);

  const payload: SelectionPayload = {
    source: buildSourceId(instanceId),
    // block selection 不算 empty(有内容);text selection 看 sel.empty
    isEmpty: kind === 'text' ? sel.empty : false,
    kind,
    from: sel.from,
    to: sel.to,
    anchor: sel.anchor,
    head: sel.head,
    activeMarks,
    activeBlockType: blockType,
    activeLevel: level,
    ...(positions.length > 0 ? { positions } : {}),
  };
  selection.emit(payload);
}

function shallowEqualSnapshot(a: SelectionSnapshot, b: SelectionSnapshot): boolean {
  return (
    a.isEmpty === b.isEmpty &&
    a.from === b.from &&
    a.to === b.to &&
    a.anchor === b.anchor &&
    a.head === b.head &&
    a.marksKey === b.marksKey &&
    a.blockType === b.blockType &&
    a.level === b.level &&
    a.kind === b.kind &&
    a.positionsKey === b.positionsKey
  );
}

/**
 * 计算当前激活的 marks(同 api.ts.computeActiveMarks 同款逻辑)
 *
 * - 选区空:storedMarks 优先,否则 $from.marks()
 * - 选区非空:rangeHasMark(至少一个位置激活)
 */
function computeActiveMarks(state: EditorState): string[] {
  const { from, to, empty, $from } = state.selection;
  const result = new Set<string>();

  if (empty) {
    const marks = state.storedMarks ?? $from.marks();
    for (const m of marks) result.add(m.type.name);
    return Array.from(result).sort();
  }

  for (const name of Object.keys(state.schema.marks)) {
    const markType = state.schema.marks[name];
    if (state.doc.rangeHasMark(from, to, markType)) {
      result.add(name);
    }
  }
  return Array.from(result).sort();
}
