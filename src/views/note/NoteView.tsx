/**
 * NoteView — view 主组件
 *
 * 见 DESIGN.md v0.2.3 § 4。
 *
 * 订阅两层:
 * - workspaceManager:取当前 ws.activeNoteId(per-workspace)
 * - noteStore:取笔记数据(全局共享)
 */

import { useSyncExternalStore, useCallback } from 'react';
import { textEditingDriver } from '@drivers/text-editing-driver';
import type { DriverSerialized } from '@drivers/text-editing-driver';
import { workspaceManager } from '@workspace/workspace-state/workspace-manager';
import { noteStore } from './note-store';
import { getNoteWsState, updateNote, deriveTitle } from './data-model';
import './note.css';

interface NoteViewProps {
  workspaceId: string;
  payload?: unknown;
}

export function NoteView({ workspaceId }: NoteViewProps) {
  // 订阅当前 ws 的 activeNoteId(per-workspace)
  const wsState = useSyncExternalStore(
    (cb) => workspaceManager.subscribe(cb),
    () => {
      const ws = workspaceManager.get(workspaceId);
      return ws ? getNoteWsState(ws) : null;
    },
  );

  // 订阅 noteStore — 任何笔记内容改了都触发重渲(其他 Workspace 改也广播过来)
  useSyncExternalStore(
    (cb) => noteStore.subscribe(cb),
    () => noteStore.count, // 数字稳定,容器变化触发重渲
  );

  // 取当前活跃笔记
  const activeNote = wsState?.activeNoteId ? noteStore.get(wsState.activeNoteId) : null;

  const handleDocChange = useCallback(
    (newDoc: DriverSerialized) => {
      if (!wsState?.activeNoteId) return;
      const newTitle = deriveTitle(newDoc);
      updateNote(wsState.activeNoteId, { doc: newDoc, title: newTitle });
    },
    [wsState?.activeNoteId],
  );

  if (!wsState) {
    return <div className="krig-note-empty">Workspace 未就绪</div>;
  }

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
      <div className="krig-note-view-content">
        <textEditingDriver.Host
          config={{
            instanceId: workspaceId,
            undoScope: 'note-view.pm',
            viewId: 'note-view',
          }}
          doc={activeNote.doc}
          onChange={handleDocChange}
        />
      </div>
    </div>
  );
}
