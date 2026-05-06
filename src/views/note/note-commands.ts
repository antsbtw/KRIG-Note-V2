/**
 * NoteView 命令注册
 *
 * 见 DESIGN.md v0.2.2 § 6。
 *
 * 注册 view 命名空间命令('note-view.*'),符合 driver 协议铁律 6b。
 * capability 命名空间命令('clipboard.copy' 等)由 driver 注册。
 */

import { commandRegistry } from '@slot/command-registry/command-registry';
import { workspaceManager } from '@workspace/workspace-state/workspace-manager';
import { createNote, deleteNote, setActiveNote, getNotePluginState } from './data-model';

export function registerNoteCommands(): void {
  commandRegistry.register('note-view.create-note', () => {
    const wsId = workspaceManager.getActiveId();
    if (wsId) createNote(wsId);
  });

  commandRegistry.register('note-view.delete-active', () => {
    const wsId = workspaceManager.getActiveId();
    if (!wsId) return;
    const ws = workspaceManager.get(wsId);
    if (!ws) return;
    const state = getNotePluginState(ws);
    if (state.activeNoteId) deleteNote(wsId, state.activeNoteId);
  });

  commandRegistry.register('note-view.set-active', (noteId: unknown) => {
    if (typeof noteId !== 'string') return;
    const wsId = workspaceManager.getActiveId();
    if (wsId) setActiveNote(wsId, noteId);
  });
}
