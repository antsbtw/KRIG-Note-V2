/**
 * content-ingest capability — 对外类型契约(5B Stage 5 / §3.3)
 *
 * 字面禁止: 不允许导出 PM doc / PMNode[] / DriverSerialized 形态的 API.
 * 字面规则: 输出统一为 V2-Atom 集合 + warning 数组.
 *
 * ── 类型 drift 说明(实施期发现,见 commit msg / 汇报)──
 *
 * 5B 设计 §3.3 字面写 `import type { Atom, AtomFrom } from '@semantic/types'`.
 * 落地查证:
 *  - `@semantic/types` 的 `Atom<D>` 是 `{ domain, payload }` 抽象壳(decision 010),
 *    与 sanitize-atoms / atomsToProseMirror 消费的"PM JSON 形态 atom"
 *    (`{ type, content, parentId, from, meta, attrs }`)**完全不是同一形态**.
 *  - `AtomFrom` 字面**不存在**作为命名类型 — 全仓库都是 inline
 *    `{ extractionType?, pdfPage?, extractedAt? }`(见 sanitize-atoms.ts:28 /
 *    atoms-to-pm.ts:63 / text-editing/types.ts:79).
 *  - `KrigImportBatch` 字面**不存在** — 仅 view/note/extraction-import.ts:59 内
 *    inline `BatchInput`.
 *
 * 决策: 本 capability 字面**本地定义** PM-JSON 形态 atom + from + batch 类型,
 * 与 @capabilities/text-editing/types AtomInput 字面同形(等 Stage 6 删原文件 +
 * view 改走本 capability 时可考虑收敛到单点). 不引 @semantic/types Atom — 那个
 * 是 storage atom shell 不是 import-pipeline 中间体.
 */

/**
 * Atom from(extraction 来源元数据) — 单点命名类型化(原代码全 inline).
 *
 * 字面字段对齐契约 `docs/10-business-design/ebook/PDF-Note-Atom数据契约-v2.md` §三.
 */
export interface AtomFrom {
  extractionType?: string;
  pdfPage?: number;
  extractedAt?: number;
}

/**
 * Atom JSON 中间形态(PM 节点 JSON + import-pipeline 元数据).
 *
 * 字面同形于 @capabilities/text-editing/types AtomInput(L5-C6 契约 §三).
 * 与 @semantic/types Atom<D> 不同 — 那是 storage atom shell;本类型是 import
 * 中间体,经 sanitize / table-adapter / atomsToProseMirror 处理后才进 storage.
 */
export interface Atom {
  id?: string | null;
  type: string;
  content?: Record<string, unknown>;
  parentId?: string;
  from?: AtomFrom;
  meta?: Record<string, unknown>;
  attrs?: Record<string, unknown>;
}

/**
 * KRIG_IMPORT batch(extraction-handler 注入脚本产物).
 *
 * 字面同形于 view/note/extraction-import.ts BatchInput(2026-05-28 grep 唯一来源).
 * Stage 5 字面: 保留 `tiptapContent` 字段名(契约 §4.7;Stage 8 才 rename pmContent).
 */
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

// ── API 契约(5B §3.3 字面) ──

export interface MarkdownToAtomsOptions {
  /** 强制首块 isTitle paragraph(markdown-import.ts:492 当前逻辑迁入) */
  titleHint?: string;
  /** from 信息(不指定时 from.extractionType='markdown' + extractedAt=Date.now()) */
  from?: Partial<AtomFrom>;
}

export interface MarkdownToAtomsResult {
  atoms: Atom[];
  warnings: string[];
}

export interface KrigChapterResult {
  title: string;
  bookName: string;
  atoms: Atom[];
  warnings: string[];
}

export interface KrigBatchToAtomsResult {
  chapters: KrigChapterResult[];
}

export interface ContentIngestApi {
  markdownToAtoms(
    md: string,
    options?: MarkdownToAtomsOptions,
  ): Promise<MarkdownToAtomsResult>;

  krigBatchToAtoms(
    batch: KrigImportBatch,
  ): Promise<KrigBatchToAtomsResult>;
}
