/**
 * NoteOpenPopup — Toolbar "Open" 按钮的搜索打开笔记弹层
 *
 * V1 对照:src/plugins/note/components/OpenFilePopup.tsx(view 内嵌组件)
 * V2 改造:popup-registry 模式(对齐 NoteLinkSearchPanel / LinkPanel),
 *          toolbar 用 popup-trigger kind 调 popupController.show 弹起本组件。
 *
 * 行为:
 * - 默认列出当前所有笔记(按 title 升序);输入过滤(title 含 query,大小写不敏感)
 * - ↑/↓ 导航;Enter 选中切到当前 ws;Esc 关闭(popup-binding 已挂)
 * - 点项 = 选中
 * - 选中走 navigateToNote(推 back 栈)+ setActiveNote(切当前 ws)+ onClose
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { PopupCloseProps } from '@slot/interaction-registries/popup-registry/popup-types';
import { workspaceManager } from '@workspace/workspace-state/workspace-manager';
import { useAllNotes } from '../use-notes-folders';
import { setActiveNote } from '../data-model';
import { navigateToNote } from '../note-navigation-history';
import './note-open-popup.css';

export function NoteOpenPopup({ onClose }: PopupCloseProps) {
  const allNotes = useAllNotes();
  const [query, setQuery] = useState('');
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const sorted = [...allNotes].sort((a, b) =>
      (a.title || '').localeCompare(b.title || '', 'zh'),
    );
    if (!q) return sorted;
    return sorted.filter(
      (n) => (n.title || '').toLowerCase().includes(q) || n.id.includes(q),
    );
  }, [allNotes, query]);

  useEffect(() => {
    setSelectedIdx(0);
  }, [query]);

  // 选中项滚入视野
  useEffect(() => {
    const item = listRef.current?.querySelector(
      '.krig-note-open-popup__item--active',
    ) as HTMLElement | null;
    item?.scrollIntoView({ block: 'nearest' });
  }, [selectedIdx]);

  function openNote(noteId: string): void {
    const wsId = workspaceManager.getActiveId();
    if (!wsId) return;
    navigateToNote(noteId);
    setActiveNote(wsId, noteId);
    onClose();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>): void {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIdx((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const target = filtered[selectedIdx];
      if (target) openNote(target.id);
    }
  }

  return (
    <div className="krig-note-open-popup">
      <input
        ref={inputRef}
        type="text"
        className="krig-note-open-popup__input"
        placeholder="搜索笔记..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={handleKeyDown}
      />
      <div ref={listRef} className="krig-note-open-popup__list">
        {filtered.length === 0 ? (
          <div className="krig-note-open-popup__empty">无匹配笔记</div>
        ) : (
          filtered.map((note, i) => (
            <div
              key={note.id}
              className={
                'krig-note-open-popup__item' +
                (i === selectedIdx ? ' krig-note-open-popup__item--active' : '')
              }
              onMouseDown={(e) => {
                e.preventDefault();
                openNote(note.id);
              }}
              onMouseEnter={() => setSelectedIdx(i)}
            >
              <span className="krig-note-open-popup__icon">📄</span>
              <span className="krig-note-open-popup__label">
                {note.title || 'Untitled'}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
