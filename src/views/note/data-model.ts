/**
 * NoteView 数据模型 + pluginStates helper
 *
 * 见 DESIGN.md v0.2.2 § 3。
 *
 * - Note.doc 用 DriverSerialized 信封(Q-N2=A)
 * - per-workspace 隔离(Q12=A)
 * - 标题自动派生(Q13=B,从 doc 第一段文字)
 */

import { workspaceManager } from '@workspace/workspace-state/workspace-manager';
import type { WorkspaceState } from '@workspace/workspace-state/workspace-state';
import { createEmptyDoc, extractFirstParagraphText } from '@drivers/text-editing-driver';
import type { DriverSerialized } from '@drivers/text-editing-driver';

export interface Note {
  id: string;
  title: string;
  doc: DriverSerialized;
  createdAt: number;
  updatedAt: number;
}

export interface NotePluginState {
  notes: Record<string, Note>;
  activeNoteId: string | null;
  counter: number;
}

const STORE_KEY = 'note';

/**
 * 默认状态(冻结的常量引用,避免 useSyncExternalStore 死循环)
 *
 * 关键:必须返回稳定引用,否则 React 每次 getSnapshot 都看到新对象,
 * 触发 "Maximum update depth exceeded"(memory 已记 L3/L4/L3.5 同款 bug)。
 */
const DEFAULT_STATE: NotePluginState = Object.freeze({
  notes: Object.freeze({}) as Record<string, Note>,
  activeNoteId: null,
  counter: 0,
}) as NotePluginState;

function defaultState(): NotePluginState {
  return DEFAULT_STATE;
}

export function getNotePluginState(ws: WorkspaceState): NotePluginState {
  return (ws.pluginStates[STORE_KEY] as NotePluginState | undefined) ?? defaultState();
}

function writeState(workspaceId: string, ws: WorkspaceState, newState: NotePluginState): void {
  workspaceManager.update(workspaceId, {
    pluginStates: {
      ...ws.pluginStates,
      [STORE_KEY]: newState,
    },
  });
}

/** 标题派生:从 doc 第一段提取,空则 '未命名' */
export function deriveTitle(doc: DriverSerialized): string {
  const text = extractFirstParagraphText(doc);
  return text || '未命名';
}

export function createNote(workspaceId: string): string | null {
  const ws = workspaceManager.get(workspaceId);
  if (!ws) return null;
  const state = getNotePluginState(ws);
  const newCounter = state.counter + 1;
  const id = `note-${newCounter}`;

  const newNote: Note = {
    id,
    title: '未命名',
    doc: createEmptyDoc(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  writeState(workspaceId, ws, {
    notes: { ...state.notes, [id]: newNote },
    counter: newCounter,
    activeNoteId: id,
  });
  return id;
}

export function updateNote(workspaceId: string, noteId: string, patch: Partial<Note>): void {
  const ws = workspaceManager.get(workspaceId);
  if (!ws) return;
  const state = getNotePluginState(ws);
  const existing = state.notes[noteId];
  if (!existing) return;

  writeState(workspaceId, ws, {
    ...state,
    notes: {
      ...state.notes,
      [noteId]: { ...existing, ...patch, id: existing.id, updatedAt: Date.now() },
    },
  });
}

export function deleteNote(workspaceId: string, noteId: string): void {
  const ws = workspaceManager.get(workspaceId);
  if (!ws) return;
  const state = getNotePluginState(ws);
  if (!state.notes[noteId]) return;

  const newNotes = { ...state.notes };
  delete newNotes[noteId];

  // 删的是 active,要切到列表第一条(或 null)
  let newActiveId = state.activeNoteId;
  if (state.activeNoteId === noteId) {
    const remaining = Object.keys(newNotes);
    newActiveId = remaining[0] ?? null;
  }

  writeState(workspaceId, ws, {
    ...state,
    notes: newNotes,
    activeNoteId: newActiveId,
  });
}

export function setActiveNote(workspaceId: string, noteId: string | null): void {
  const ws = workspaceManager.get(workspaceId);
  if (!ws) return;
  const state = getNotePluginState(ws);
  if (state.activeNoteId === noteId) return;

  writeState(workspaceId, ws, { ...state, activeNoteId: noteId });
}
