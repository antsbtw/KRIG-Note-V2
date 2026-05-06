/**
 * undo-redo scope 集成 — L5-A 占位 noop
 *
 * 见 DESIGN.md v0.2.1 § 5.3。
 * L5-B 加 prosemirror-history 时实施。
 */

/** Host 实例 mount 时调,返回 unregister 函数 */
export function registerUndoScope(_scope: string): () => void {
  // L5-A:noop 占位
  return () => {};
}
