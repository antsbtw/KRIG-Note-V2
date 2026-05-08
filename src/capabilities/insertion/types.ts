/**
 * insertion capability — 对外类型(Wave 5 / D4)
 */

export type { SafeguardRegistration } from './index';

/** view 诊断路径用 */
export interface InsertionDiagnosticApi {
  readonly safeguardCount: number;
}
