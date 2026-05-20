/**
 * note capability — renderer 端薄包装 (decision 012 §3.4 方案 A)
 *
 * 实施位置:src/platform/main/note/ (capability-impl + handlers)
 * 本文件:把 window.electronAPI.noteXxx 扁平驼峰 alias 成业务名 (createNote / listNotes / ...)
 *
 * 设计师批复 P1:V2 扁平驼峰惯例,renderer 端 capability 包装层吸收命名差异。
 *
 * W5 严格态:Registry 注册 + api 字段(view 通过 requireCapabilityApi 间接路由)
 * W5 边界 A 临时允许项:同时保留模块级 export(driver/slot 内部消费可直 import,
 * 跟 ebook-library / learning 同模式)。
 *
 * 边界:
 * - view 层走 requireCapabilityApi<NoteCapabilityApi>('note') 间接路由
 * - 拿到 NoteInfo.doc 仍是 DriverSerialized 信封 (路径 Y 决议)
 *
 * 副作用:模块加载时触发 clearLegacyLocalStorage (idempotent,L5-alive 已先调一次)
 */

import { capabilityRegistry } from '@slot/capability-registry/capability-registry';
import { clearLegacyLocalStorage } from './migration';
import type {
  NoteCapabilityApi,
  NoteInfo,
  NoteDocEnvelope,
  NoteDocContentChangedPayload,
} from './types';

export type {
  NoteCapabilityApi,
  NoteInfo,
  NoteDocEnvelope,
  NoteDocContentChangedPayload,
  NoteDocOrigin,
} from './types';
export { clearLegacyLocalStorage };

// 模块加载时清一次 V1 残留 (idempotent + 防御性,即便 L5-alive 路径未跑也兜底)
clearLegacyLocalStorage();

async function createNote(
  initialDoc: NoteDocEnvelope | null = null,
  folderId: string | null = null,
): Promise<NoteInfo> {
  return window.electronAPI.noteCreate(initialDoc, folderId);
}
async function listNotes(): Promise<NoteInfo[]> {
  return window.electronAPI.noteList();
}
async function getNote(id: string): Promise<NoteInfo | null> {
  return window.electronAPI.noteGet(id);
}
async function updateNote(id: string, doc: NoteDocEnvelope): Promise<NoteInfo | null> {
  return window.electronAPI.noteUpdate(id, doc);
}
async function moveNote(noteId: string, newFolderId: string | null): Promise<void> {
  return window.electronAPI.noteMove(noteId, newFolderId);
}
async function deleteNote(id: string): Promise<void> {
  return window.electronAPI.noteDelete(id);
}
function onListChanged(callback: (list: NoteInfo[]) => void): () => void {
  return window.electronAPI.onNoteListChanged(callback);
}
function onDocContentChanged(
  callback: (payload: NoteDocContentChangedPayload) => void,
): () => void {
  return window.electronAPI.onNoteDocContentChanged(callback);
}

export const noteCapability: NoteCapabilityApi = {
  createNote,
  listNotes,
  getNote,
  updateNote,
  moveNote,
  deleteNote,
  onListChanged,
  onDocContentChanged,
};

// W5 严格态:Registry 注册 — view 走 requireCapabilityApi<NoteCapabilityApi>('note')
capabilityRegistry.register({
  id: 'note',
  api: noteCapability,
});
