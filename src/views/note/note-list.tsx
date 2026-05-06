/**
 * 笔记列表 — NavSide 内容渲染组件
 *
 * 见 DESIGN.md v0.2.3 § 5.2。
 *
 * 数据源:全局 noteStore(跨 Workspace 共享)+ 当前 ws activeNoteId(per-workspace 高亮)
 */

import { useSyncExternalStore } from 'react';
import { useActiveWorkspaceId, useWorkspace } from '@workspace/workspace-instance/use-workspace';
import { commandRegistry } from '@slot/command-registry/command-registry';
import { noteStore } from './note-store';
import { getNoteWsState, deleteNote } from './data-model';

function formatTime(ts: number): string {
  const diff = Date.now() - ts;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} 天前`;
  return new Date(ts).toLocaleDateString();
}

export function NoteList() {
  // 订阅全局 noteStore(NavSide 显所有笔记,跨 Workspace 共享)
  const allNotes = useSyncExternalStore(
    (cb) => noteStore.subscribe(cb),
    () => noteStore.getAll(),
  );

  // 订阅当前 ws 的 activeNoteId(per-workspace 高亮)
  const wsId = useActiveWorkspaceId();
  const ws = useWorkspace(wsId);
  const wsState = ws ? getNoteWsState(ws) : null;
  const activeId = wsState?.activeNoteId ?? null;

  if (!wsId) return null;

  const sortedNotes = [...allNotes].sort((a, b) => b.updatedAt - a.updatedAt);

  if (sortedNotes.length === 0) {
    return (
      <div className="krig-note-list-empty">
        还没有笔记<br />
        点 [+ 笔记] 创建
      </div>
    );
  }

  return (
    <ul className="krig-note-list">
      {sortedNotes.map((note) => (
        <li
          key={note.id}
          className={`krig-note-list-item${note.id === activeId ? ' active' : ''}`}
          onClick={() => commandRegistry.execute('note-view.set-active', note.id)}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (window.confirm(`删除"${note.title}"?`)) {
              deleteNote(note.id);
            }
          }}
        >
          <div className="krig-note-list-title">{note.title}</div>
          <div className="krig-note-list-time">{formatTime(note.updatedAt)}</div>
        </li>
      ))}
    </ul>
  );
}
