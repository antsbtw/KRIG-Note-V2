/**
 * STRUCTURAL_CONTAINER_TYPES — 结构性容器集合(单点 source of truth)
 *
 * 5A 拍板 + 5B §7.3.1 拍板:
 * - 从原 6 项 {table, tableRow, bulletList, orderedList, taskList, columnList}
 *   降为 **5 项** {tableRow, bulletList, orderedList, taskList, columnList}
 * - **不含 `table`**(5A 拍板 table 是 atom)
 * - 集中到 semantic 层单点 export,所有消费方走 import,**不允许独立 hardcode**
 *
 * 五处消费方(2026-05-28 5B Stage 2 收敛后):
 * 1. src/platform/main/note/assemble-pm-doc.ts
 * 2. src/platform/main/note/dissect-pm-doc.ts
 * 3. src/drivers/text-editing-driver/plugins/build-auto-block-id-plugin.ts
 * 4. src/capabilities/text-editing/converters/atoms-to-pm.ts
 * 5. src/platform/main/note/capability-impl.ts (injectIdsForCreate)
 *
 * 未来加新结构性容器(如 grid / flexbox / layout — 决议 026 §13.8 前瞻):
 * 只需改本文件,五处消费方字面自动跟随。
 *
 * **集合内容字面一致是决议 026 §3.1.2 修订附记字面登记的硬契约。**
 */

export const STRUCTURAL_CONTAINER_TYPES = new Set<string>([
  'tableRow',
  'bulletList',
  'orderedList',
  'taskList',
  'columnList',
]);

export type StructuralContainerType =
  | 'tableRow'
  | 'bulletList'
  | 'orderedList'
  | 'taskList'
  | 'columnList';
