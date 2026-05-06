/**
 * selection 集成 — 实例隔离 source
 *
 * 见 DESIGN.md v0.2.1 § 5.1。
 */

import type { EditorView } from 'prosemirror-view';
import { selection } from '@capabilities/selection';

const SOURCE_PREFIX = 'text-editing-driver:';

/** 实例 source ID 格式 */
export function buildSourceId(instanceId: string): string {
  return `${SOURCE_PREFIX}${instanceId}`;
}

/** Host 实例 mount 时调,返回 unregister 函数 */
export function registerSelectionSource(instanceId: string): () => void {
  const source = buildSourceId(instanceId);
  selection.registerSource({ source });
  return () => selection.unregisterSource(source);
}

/** Host 在 dispatchTransaction 时调,emit 当前选区(带实例 source)*/
export function emitSelectionChanged(view: EditorView, instanceId: string): void {
  const sel = view.state.selection;
  selection.emit({
    source: buildSourceId(instanceId),
    isEmpty: sel.empty,
    kind: 'text',
    from: sel.from,
    to: sel.to,
    anchor: sel.anchor,
    head: sel.head,
  });
}
