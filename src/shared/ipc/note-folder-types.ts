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
