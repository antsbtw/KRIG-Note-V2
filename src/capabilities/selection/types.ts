/**
 * selection capability — 对外类型(Wave 5 / D4 强制 types.ts)
 *
 * view 端 import:
 *   import type { SelectionDiagnosticApi } from '@capabilities/selection/types';
 *
 * 注意:driver 端仍可通过 @capabilities/selection 直 import 完整 instance 调
 * registerSource / emit / subscribe 等(W5 不在 driver 路径范围)。
 */

export type { SelectionPayload, SelectionKind } from './index';

/** view 诊断路径(L5-alive)用 — 仅诊断字段,不含业务方法 */
export interface SelectionDiagnosticApi {
  /** 已注册 source 数(诊断用)*/
  readonly sourceCount: number;
}
