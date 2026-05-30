/**
 * intent-log 公共出口(SP-3 数据层可靠性 intent-log 体系)
 *
 * 详 docs/tasks/2026-05-30-data-layer-reliability-design.md §3。
 */
export type { IntentEntity, IntentOp, IntentStatus, CreateIntentInput } from './types';
export {
  createIntent,
  deleteIntent,
  listPendingIntents,
  createIntentViaTx,
  advanceIntentCursorViaTx,
  deleteIntentViaTx,
} from './intent-store';
export { registerIntentResolver, sweepPendingIntents, type IntentResolver } from './sweeper';
