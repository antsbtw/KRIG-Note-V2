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
import { getBlockSelectionIndices } from '../plugins/build-block-selection-plugin';

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
  blockIndicesKey: string;  // block selection indices join('|')(block/multi-block 用)
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

  // 优先看 block-selection plugin state:有则覆盖 kind/positions
  const blockIndices = getBlockSelectionIndices(state);
  let kind: SelectionKind = 'text';
  let positions: number[] = [];
  if (blockIndices && blockIndices.length > 0) {
    kind = blockIndices.length === 1 ? 'block' : 'multi-block';
    // 把 top-level index 转 doc 内 before 位置(positions 字段语义:每块起点)
    let offset = 0;
    const docChildren = state.doc.childCount;
    for (let i = 0; i < docChildren; i++) {
      if (blockIndices.includes(i)) positions.push(offset);
      offset += state.doc.child(i).nodeSize;
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
    blockIndicesKey: positions.join('|'),
  };

  // 真变才 emit
  const prev = lastSnapshots.get(instanceId);
  if (prev && shallowEqualSnapshot(prev, snapshot)) return;
  lastSnapshots.set(instanceId, snapshot);

  const payload: SelectionPayload = {
    source: buildSourceId(instanceId),
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
    a.blockIndicesKey === b.blockIndicesKey
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
