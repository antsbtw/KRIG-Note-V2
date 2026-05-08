/**
 * undo-redo capability — 对外类型(Wave 5 / D4)
 */

export type { UndoScopeRegistration } from './index';

/** view 诊断路径用 */
export interface UndoRedoDiagnosticApi {
  readonly scopeCount: number;
}
