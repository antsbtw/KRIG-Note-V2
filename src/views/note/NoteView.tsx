/**
 * NoteView — view 主组件
 *
 * 见 DESIGN.md v0.2.2 § 4。
 *
 * 装配 textEditingDriver.Host(driver 必经),通过 onChange 写回 pluginStates。
 */

import { useSyncExternalStore, useCallback } from 'react';
import { textEditingDriver } from '@drivers/text-editing-driver';
import type { DriverSerialized } from '@drivers/text-editing-driver';
import { workspaceManager } from '@workspace/workspace-state/workspace-manager';
import { getNotePluginState, updateNote, deriveTitle } from './data-model';
import './note.css';

interface NoteViewProps {
  workspaceId: string;
  payload?: unknown;
}

export function NoteView({ workspaceId }: NoteViewProps) {
  // 订阅 workspaceManager 取笔记状态
  const noteState = useSyncExternalStore(
    (cb) => workspaceManager.subscribe(cb),
    () => {
      const ws = workspaceManager.get(workspaceId);
      return ws ? getNotePluginState(ws) : null;
    },
  );

  const handleDocChange = useCallback(
    (newDoc: DriverSerialized) => {
      if (!noteState?.activeNoteId) return;
      const newTitle = deriveTitle(newDoc);
      updateNote(workspaceId, noteState.activeNoteId, {
        doc: newDoc,
        title: newTitle,
      });
    },
    [noteState?.activeNoteId, workspaceId],
  );

  if (!noteState) {
    return <div className="krig-note-empty">Workspace 未就绪</div>;
  }

  const activeNote = noteState.activeNoteId ? noteState.notes[noteState.activeNoteId] : null;

  if (!activeNote) {
    return (
      <div className="krig-note-empty">
        <div className="krig-note-empty-icon">📝</div>
        <div className="krig-note-empty-text">未选择笔记</div>
        <div className="krig-note-empty-hint">从左侧列表点选,或新建笔记</div>
      </div>
    );
  }

  return (
    <div className="krig-note-view">
      <textEditingDriver.Host
        config={{
          instanceId: workspaceId,        // P1.3 实例隔离
          undoScope: 'note-view.pm',      // 铁律 6b
        }}
        doc={activeNote.doc}
        onChange={handleDocChange}
      />
    </div>
  );
}
