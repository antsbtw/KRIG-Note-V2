/**
 * NoteView — view 主组件
 *
 * 见 DESIGN.md v0.2.3 § 4。
 *
 * 订阅两层:
 * - workspaceManager:取当前 ws.activeNoteId(per-workspace)
 * - noteStore:取笔记数据(全局共享)
 */

import { useSyncExternalStore, useCallback, useEffect } from 'react';
import { textEditingDriver, textEditingDriverApi } from '@drivers/text-editing-driver';
import type { DriverSerialized } from '@drivers/text-editing-driver';
import { workspaceManager } from '@workspace/workspace-state/workspace-manager';
import { popupController } from '@slot/triggers/popup-controller';
import { noteStore } from './note-store';
import { getNoteWsState, updateNote, deriveTitle } from './data-model';
import { takePendingAnchor } from './link-click-integration';
import {
  setCurrentNoteId,
  goBack,
  goForward,
  canGoBack,
  canGoForward,
} from './note-navigation-history';
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
  const activeNoteId = wsState?.activeNoteId ?? null;

  const handleDocChange = useCallback(
    (newDoc: DriverSerialized) => {
      if (!wsState?.activeNoteId) return;
      const newTitle = deriveTitle(newDoc);
      updateNote(wsState.activeNoteId, { doc: newDoc, title: newTitle });
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
      textEditingDriverApi.scrollToAnchor(workspaceId, anchor);
    }, 100);
    return () => window.clearTimeout(t);
  }, [activeNoteId, workspaceId]);

  // L5-B3.4:全局 keymap — Cmd+K 弹 LinkPanel / Cmd+[ goBack / Cmd+] goForward
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      // Cmd+K → 选中文字时弹 LinkPanel(对齐 V1 Q7=A 必须有选区)
      if (e.key === 'k' || e.key === 'K') {
        // 只在 NoteView 主区域 focus 时触发(简化:检查 active element 是否在 .krig-note-view 内)
        const wsId = workspaceManager.getActiveId();
        if (!wsId) return;
        // 选区为空就不弹(避免误触)
        const sel = window.getSelection();
        if (!sel || sel.isCollapsed) return;
        e.preventDefault();
        // anchor 用 floating-toolbar 的 link 按钮(若可见);否则用选区中点
        const linkBtn = document.querySelector(
          '.krig-floating-toolbar [title="🔗"], .krig-floating-toolbar-item[title="🔗"]',
        );
        if (linkBtn instanceof Element) {
          popupController.show('note-view.popup.link', linkBtn);
        } else {
          // fallback:用选区 rect 模拟一个虚拟 anchor
          const range = sel.getRangeAt(0);
          const rect = range.getBoundingClientRect();
          // 用 div 临时做 anchor(只取它的 BoundingClientRect)
          const fake = document.createElement('div');
          fake.style.position = 'fixed';
          fake.style.left = `${rect.left}px`;
          fake.style.top = `${rect.bottom}px`;
          fake.style.width = '1px';
          fake.style.height = '1px';
          document.body.appendChild(fake);
          popupController.show('note-view.popup.link', fake);
          window.setTimeout(() => fake.remove(), 0);
        }
        return;
      }
      // Cmd+[ goBack / Cmd+] goForward
      if (e.key === '[') {
        if (canGoBack()) {
          e.preventDefault();
          goBack();
        }
        return;
      }
      if (e.key === ']') {
        if (canGoForward()) {
          e.preventDefault();
          goForward();
        }
        return;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

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
