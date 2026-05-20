/**
 * EBookOpenPopup — Toolbar "Open" 按钮的搜索打开电子书弹层
 *
 * 对齐 NoteOpenPopup 结构:
 * - 默认列出全部书(按 displayName 升序);输入过滤(displayName 含 query)
 * - ↑/↓ 导航;Enter 选中切书;Esc 关闭(popup-binding 已挂)
 * - 选中走命令 `ebook-view.open-book`(已有,加载书 + setActiveBookId)
 *
 * 本组件不依赖 PopupCloseProps 外的任何 view 内部 state,
 * 任何 workspace 任何 view 都可复用(走 commandRegistry)。
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { PopupCloseProps } from '@slot/interaction-registries/popup-registry/popup-types';
import { commandRegistry } from '@slot/command-registry/command-registry';
import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import type { EBookLibraryApi } from '@capabilities/ebook-library/types';
import type { EBookInfo } from '@shared/ipc/ebook-types';
import './ebook-open-popup.css';

export function EBookOpenPopup({ onClose }: PopupCloseProps) {
  const library = useMemo(
    () => requireCapabilityApi<EBookLibraryApi>('ebook-library'),
    [],
  );

  const [books, setBooks] = useState<EBookInfo[]>([]);
  const [query, setQuery] = useState('');
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  // 拉书架 + 订阅变化(open 后 onBookshelfChanged 会刷新 lastOpenedAt 排序)
  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      void library.list().then((list) => {
        if (!cancelled) setBooks(list);
      });
    };
    refresh();
    const unsub = library.onBookshelfChanged(() => refresh());
    return () => {
      cancelled = true;
      unsub();
    };
  }, [library]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const sorted = [...books].sort((a, b) =>
      (a.displayName || '').localeCompare(b.displayName || '', 'zh'),
    );
    if (!q) return sorted;
    return sorted.filter((b) => {
      const name = (b.displayName || '').toLowerCase();
      const file = (b.fileName || '').toLowerCase();
      return name.includes(q) || file.includes(q) || b.id.includes(q);
    });
  }, [books, query]);

  useEffect(() => {
    setSelectedIdx(0);
  }, [query]);

  // 选中项滚入视野
  useEffect(() => {
    const item = listRef.current?.querySelector(
      '.krig-ebook-open-popup__item--active',
    ) as HTMLElement | null;
    item?.scrollIntoView({ block: 'nearest' });
  }, [selectedIdx]);

  function openBook(bookId: string): void {
    commandRegistry.execute('ebook-view.open-book', bookId);
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
      if (target) openBook(target.id);
    }
  }

  return (
    <div className="krig-ebook-open-popup">
      <input
        ref={inputRef}
        type="text"
        className="krig-ebook-open-popup__input"
        placeholder="搜索书籍..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={handleKeyDown}
      />
      <div ref={listRef} className="krig-ebook-open-popup__list">
        {filtered.length === 0 ? (
          <div className="krig-ebook-open-popup__empty">
            {books.length === 0 ? '书架为空' : '无匹配书籍'}
          </div>
        ) : (
          filtered.map((book, i) => (
            <div
              key={book.id}
              className={
                'krig-ebook-open-popup__item' +
                (i === selectedIdx ? ' krig-ebook-open-popup__item--active' : '')
              }
              onMouseDown={(e) => {
                e.preventDefault();
                openBook(book.id);
              }}
              onMouseEnter={() => setSelectedIdx(i)}
            >
              <span className="krig-ebook-open-popup__icon">
                {book.fileType === 'epub' ? '📖' : '📕'}
              </span>
              <span className="krig-ebook-open-popup__label">
                {book.displayName || book.fileName || 'Untitled'}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
