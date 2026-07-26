/**
 * import-orchestrator capability — 阶段 C（导入到 note 收敛）
 *
 * 职责：统一「批量落库编排」——所有 batch 导入路径（Markdown / Word / 剪藏 / PDF）
 * 拿到标准 CreateNoteBatchItem[] 后的落库动作（调 createNotesBatch、broadcastMode、
 * failures→结果归一）收进唯一入口 importDraftsToNotes，三处 view 改调它。
 *
 * **不在 content-ingest 内**（那层铁律「只转换、不落库、不导 PM 形态、不调 noteCap」）。
 * **不在 note capability 内**（保持 note 纯 CRUD）。
 * 经 requireCapabilityApi('note') 单向消费 note capability，不改落库层内部。
 *
 * 消费方式：view / 下游 capability 走 requireCapabilityApi('import-orchestrator')，
 * 与它们拿 noteCap 同款（不直 import internal）。
 */

import { capabilityRegistry } from '@slot/capability-registry/capability-registry';
import { importDraftsToNotes } from './internal/orchestrate';
import type { ImportOrchestratorApi } from './types';

export type {
  ImportOrchestratorApi,
  ImportOptions,
  ImportResult,
  ImportFailure,
  CreateNoteBatchItem,
  CreateNoteBatchFailure,
} from './types';

// 直接命名导出（对齐 content-ingest：既注册 registry，也可直 import 供测试/同层复用）。
export { importDraftsToNotes } from './internal/orchestrate';

const api: ImportOrchestratorApi = { importDraftsToNotes };

capabilityRegistry.register({
  id: 'import-orchestrator',
  api,
});
