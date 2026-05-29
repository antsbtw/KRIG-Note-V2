/**
 * content-ingest capability 对外类型契约 (5B Stage 7 重做 — 规范字面对齐)
 *
 * 输入: 各源原生格式 (markdown / KRIG_IMPORT JSON / 未来扩展)
 * 输出: PmAtomDraft[] 集合 + warnings
 *
 * **禁止**: 不导出 PM doc / PMNode[] / DriverSerialized 形态.
 *           不调用 noteCap / createNote (capability 边界纪律).
 *           不引入 V1 遗留 atom 中间形态 (Stage 7 已物理删除原 V1 import 类型).
 *
 * 规范依据:
 *  - atom/spec.md §1: `Atom<D> = { domain, payload: AtomPayloadOf<D> }`
 *  - persistence/spec.md §6 PE4: atom.id 由 storage 层生成 (业务层不预设)
 *  - PmAtomDraft 是 import-pipeline 专用中间形态 (@semantic/types/pm-atom-draft.ts)
 */

import type { PmAtomDraft, AtomFrom } from '@semantic/types';

export type { PmAtomDraft, AtomFrom } from '@semantic/types';

export interface MarkdownToAtomsOptions {
  /** 强制首块 paragraph 加 attrs.isTitle = true 字面承载 title */
  titleHint?: string;
  from?: Partial<AtomFrom>;
}

export interface MarkdownToAtomsResult {
  atoms: PmAtomDraft[];
  warnings: string[];
}

export interface KrigImportChapter {
  fileName?: string;
  bookName?: string;
  title?: string;
  pageStart?: number;
  pageEnd?: number;
  pages?: Array<{ pageNumber: number; atoms: unknown[] }>;
}

export interface KrigImportBatch {
  type?: string;
  chapters?: KrigImportChapter[];
  bookName?: string;
}

export interface KrigChapterResult {
  title: string;
  bookName: string;
  atoms: PmAtomDraft[];
  warnings: string[];
}

export interface KrigBatchToAtomsResult {
  chapters: KrigChapterResult[];
}

export interface ContentIngestApi {
  markdownToAtoms(md: string, options?: MarkdownToAtomsOptions): Promise<MarkdownToAtomsResult>;
  krigBatchToAtoms(batch: KrigImportBatch): Promise<KrigBatchToAtomsResult>;
}
