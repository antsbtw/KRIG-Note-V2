/**
 * NoteView — view 主组件
 *
 * 见 DESIGN.md v0.2.3 § 4。
 *
 * 订阅两层:
 * - workspaceManager:取当前 ws.activeNoteId(per-workspace)
 * - noteCapability:取笔记数据(全局共享,通过 useAllNotes hook + IPC 广播)
 */

import { useMemo, useSyncExternalStore, useCallback, useEffect } from 'react';
import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import type { DriverSerialized, TextEditingApi } from '@capabilities/text-editing/types';
import { workspaceManager } from '@workspace/workspace-state/workspace-manager';
import { useAllNotes } from './use-notes-folders';
import { getNoteWsState, updateNote } from './data-model';
import { takePendingAnchor } from './link-click-integration';
import { setCurrentNoteId } from './note-navigation-history';
import { useExtractionImport } from './use-extraction-import';
import './note.css';

interface NoteViewProps {
  workspaceId: string;
  payload?: unknown;
}

export function NoteView({ workspaceId }: NoteViewProps) {
  // W5 C4:间接路由拿 text-editing capability(useMemo 缓存,React identity 稳定)
  const textEditing = useMemo(
    () => requireCapabilityApi<TextEditingApi>('text-editing'),
    [],
  );

  // 订阅当前 ws 的 activeNoteId(per-workspace)
  const wsState = useSyncExternalStore(
    (cb) => workspaceManager.subscribe(cb),
    () => {
      const ws = workspaceManager.get(workspaceId);
      return ws ? getNoteWsState(ws) : null;
    },
  );

  // 订阅 noteCapability — onListChanged 推送(所有 ws 共享视图)
  const allNotes = useAllNotes();

  // 取当前活跃笔记
  const activeNoteId = wsState?.activeNoteId ?? null;
  const activeNote = activeNoteId ? allNotes.find((n) => n.id === activeNoteId) ?? null : null;

  // L5-C6:订阅 main 推送的 atom batch JSON → 落 noteCapability
  // (主进程广播,所有 NoteView 都收到 — 创建逻辑幂等去重,多挂无害)
  useExtractionImport();

  const handleDocChange = useCallback(
    (newDoc: DriverSerialized) => {
      if (!wsState?.activeNoteId) return;
      // L7-sub2:title 派生自 doc 首段文本 (capability 内自动算),view 不传 title
      void updateNote(wsState.activeNoteId, { doc: newDoc });
    },
    [wsState?.activeNoteId],
  );

  // L5-B3.4:同步当前 noteId 到导航历史栈(切笔记时)
  useEffect(() => {
    setCurrentNoteId(activeNoteId);
  }, [activeNoteId]);

  // L5-B3.4:笔记加载后 flush pendingAnchor(link-click 跨文档跳转的滚动)
  useEffect(() => {
    if (!activeNoteId) return;
    const anchor = takePendingAnchor();
    if (!anchor) return;
    // 等编辑器装配 + DOM 渲染完成
    const t = window.setTimeout(() => {
      textEditing.api.scrollToAnchor(workspaceId, anchor);
    }, 100);
    return () => window.clearTimeout(t);
  }, [activeNoteId, workspaceId]);

  // W4.1:全局 keymap(Cmd+K / Cmd+[ / Cmd+])改为 ViewDefinition.keymap 声明式注册,
  // 见 views/note/index.ts + note-commands.ts(note-view.popup-link / go-back / go-forward)

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

  const Host = textEditing.Host;
  return (
    <div className="krig-note-view" data-view-id="note-view">
      <div className="krig-note-view-content">
        <Host
          config={{
            instanceId: workspaceId,
            undoScope: 'text-editing.pm',
            viewId: 'note-view',
          }}
          doc={activeNote.doc}
          onChange={handleDocChange}
        />
      </div>
    </div>
  );
}
