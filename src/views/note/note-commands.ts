/**
 * NoteView 命令注册
 *
 * 见 DESIGN.md v0.2.3 § 6。
 */

import { commandRegistry } from '@slot/command-registry/command-registry';
import { workspaceManager } from '@workspace/workspace-state/workspace-manager';
import { createNote, deleteNote, setActiveNote, getNoteWsState } from './data-model';

/** 确保 slotBinding.left = 'note-view'(用户从 NavSide 点动作时可能没切到 NoteView)*/
function ensureNoteViewActive(wsId: string): void {
  const ws = workspaceManager.get(wsId);
  if (!ws) return;
  if (ws.slotBinding.left === 'note-view') return;
  workspaceManager.update(wsId, {
    slotBinding: { ...ws.slotBinding, left: 'note-view' },
  });
}

export function registerNoteCommands(): void {
  commandRegistry.register('note-view.create-note', () => {
    const wsId = workspaceManager.getActiveId();
    if (!wsId) return;
    createNote(wsId);
    ensureNoteViewActive(wsId);
  });

  commandRegistry.register('note-view.delete-active', () => {
    const wsId = workspaceManager.getActiveId();
    if (!wsId) return;
    const ws = workspaceManager.get(wsId);
    if (!ws) return;
    const state = getNoteWsState(ws);
    if (state.activeNoteId) deleteNote(state.activeNoteId);
  });

  commandRegistry.register('note-view.set-active', (noteId: unknown) => {
    if (typeof noteId !== 'string') return;
    const wsId = workspaceManager.getActiveId();
    if (!wsId) return;
    setActiveNote(wsId, noteId);
    ensureNoteViewActive(wsId);
  });
}
