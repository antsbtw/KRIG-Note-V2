/**
 * note + folder IPC 共享类型 (decision 012)
 *
 * main / renderer 进程边界上的数据契约。
 *
 * 边界总结 (路径 Y):
 * - view ↔ capability:NoteInfo.doc = DriverSerialized 信封 (本文件)
 * - capability 内部 ↔ storage:裸 PmPayload (driver 信封压缩到 capability 内部)
 *
 * NoteDocEnvelope 是 DriverSerialized 的结构等价体,本文件不 import @drivers
 * 以保持 shared 层 0 跨层依赖。
 */

/** PM doc 信封 — 结构等价于 @drivers/text-editing-driver DriverSerialized */
export interface NoteDocEnvelope<TPayload = unknown> {
  format: string;       // 'pm-doc-json'
  version: string;      // '0.1'
  payload: TPayload;
}

/** 笔记业务视图 (atom + 派生 title + 派生 folderId) */
export interface NoteInfo {
  id: string;
  /** 派生自 doc 首段文本 */
  title: string;
  /** DriverSerialized 信封 (format:'pm-doc-json',version:'0.1') */
  doc: NoteDocEnvelope;
  /** 派生:user:krig:inFolder 边的 object;null = 根级 */
  folderId: string | null;
  createdAt: number;
  updatedAt: number;
}

/** 文件夹业务视图 (atom + 派生 parentId) */
export interface FolderInfo {
  id: string;
  /** atom.payload.payload.title (folder 上是真实业务字段) */
  title: string;
  /** 派生:user:krig:inFolder 边的 object;null = 根级 */
  parentId: string | null;
  createdAt: number;
  updatedAt: number;
}

/**
 * 视图归属标记 (decision 021 §4.1 + §10.C-1 + decision 022 §4.3 兼容约束落地).
 *
 * folder atom 通过 user:krig:folderForView 边表达 view 归属:
 * - 'note'  → object literal '__view__/note'
 * - 'graph' → object literal '__view__/graph'
 * - 'ebook' → object literal '__view__/ebook'  (decision 022, sub-phase 022)
 *
 * SSOT 位置 (§10.C-1 偏离登记, 2026-05-13): 跟 FolderInfo 同模式归到
 * shared/ipc/ IPC 契约层, 避免 shared/ipc/electron-api.d.ts 反向 import @capabilities/
 * (V2 分层 lint 规则 no-restricted-imports 禁止).
 * capability folder/types.ts re-export 该类型给消费者.
 */
export type FolderViewType = 'note' | 'graph' | 'ebook' | 'thought';

/**
 * NOTE_DOC_CONTENT_CHANGED origin 常量
 *
 * 用常量而非裸字符串 union — 避免散落字面值拼写漂移(如 'ebook-reading-thoughts' /
 * 'ebook_reading_thought');任何调用方写 broadcast 时引用此常量, IDE 自动补全 +
 * grep 可查所有使用点。
 */
export const NOTE_DOC_ORIGIN = {
  /** renderer 通过 NOTE_UPDATE IPC 进来的用户编辑 */
  NOTE_EDITOR: 'note-editor',
  /** ebook capability addReadingThoughtBlock / removeReadingThoughtBlock 触发 */
  EBOOK_READING_THOUGHT: 'ebook-reading-thought',
  /** extraction-import 路径创建/更新(本 PR 暂不接入, 留 followup) */
  EXTRACTION_IMPORT: 'extraction-import',
  /** 启动时 migration 修正 doc (留 followup) */
  MIGRATION: 'migration',
} as const;

export type NoteDocOrigin = typeof NOTE_DOC_ORIGIN[keyof typeof NOTE_DOC_ORIGIN];

/**
 * NOTE_DOC_CONTENT_CHANGED payload — 单个 note 的 doc 变化推送
 *
 * 跟 NOTE_LIST_CHANGED 的区别:
 * - NOTE_LIST_CHANGED:整个 list 元数据(title / folderId / updatedAt 等), 所有订阅者收
 * - NOTE_DOC_CONTENT_CHANGED:单个 noteId+doc payload, 发起 renderer **不收**(防 echo 回灌)
 *
 * emitterId:有时表示"NOTE_UPDATE 经 IPC handler 进来的发起 renderer", main 内部直接
 * 调 updateNote(ebook capability 等)时 undefined。main broadcast 时据此排除该 renderer。
 */
export interface NoteDocContentChangedPayload {
  noteId: string;
  doc: NoteDocEnvelope;
  origin: NoteDocOrigin;
  updatedAt: number;
  /** 仅 origin=NOTE_EDITOR 时有 — 发起更新的 renderer webContents.id */
  emitterId?: number;
}
