/**
 * drag-and-drop capability — 对外类型(Wave 5 / D4)
 */

export type { DropTargetRegistration } from './index';

/** view 诊断路径用 */
export interface DndDiagnosticApi {
  readonly dropTargetCount: number;
}
