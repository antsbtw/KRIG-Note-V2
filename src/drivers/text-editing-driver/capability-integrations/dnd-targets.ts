/**
 * drag-and-drop dropTarget 集成 — L5-A 占位 noop
 *
 * 见 DESIGN.md v0.2.1 § 5.4。
 * L5-B 加块拖动手柄时实施。
 */

export function registerDropTargets(_instanceId: string): () => void {
  // L5-A:noop 占位
  return () => {};
}
