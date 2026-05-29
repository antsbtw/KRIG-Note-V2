/**
 * content-ingest capability — 5B Stage 5(设计 §7.1.3)
 *
 * 职责: 各源原生格式(markdown / KRIG_IMPORT JSON / 未来扩展)→ 归一化的 V2-Atom 集合.
 * **禁止** 调 noteCap.createNote / 产 PM doc — 那是上层编排的事(Stage 7).
 *
 * 共依赖: STRUCTURAL_CONTAINER_TYPES from @semantic/types/structural(5B §7.3.1).
 *
 * Stage 6 待办: 删除 text-editing 内 sanitize-atoms.ts / md-to-pm.ts 的 capability 公开导出,
 *   view 端(markdown-import.ts / extraction-import.ts)改走 content-ingest API.
 */

import { capabilityRegistry } from '@slot/capability-registry/capability-registry';
import { markdownToAtoms } from './internal/markdown-to-atoms';
import { krigBatchToAtoms } from './internal/krig-batch-to-atoms';
import type { ContentIngestApi } from './types';

export type {
  ContentIngestApi,
  MarkdownToAtomsOptions,
  MarkdownToAtomsResult,
  KrigChapterResult,
  KrigBatchToAtomsResult,
  KrigImportBatch,
  KrigImportChapter,
  PmAtomDraft,
  AtomFrom,
} from './types';
export { markdownToAtoms } from './internal/markdown-to-atoms';
export { krigBatchToAtoms } from './internal/krig-batch-to-atoms';

const api: ContentIngestApi = { markdownToAtoms, krigBatchToAtoms };

capabilityRegistry.register({
  id: 'content-ingest',
  api,
});
