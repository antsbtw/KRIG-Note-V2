/**
 * SearchBar — 文本搜索栏(L5-C3,Cmd+F 触发)
 *
 * V1 → V2 直迁:src/plugins/ebook/components/SearchBar.tsx(72 行)。
 * 改 CSS 类前缀对齐 V2 命名(.search-bar* → .krig-ebook-search-bar*)。
 *
 * view 端用法:Toolbar 触发 → setVisible(true);Cmd+F keymap 同样触发。
 * 搜索逻辑由 useSearch hook 封装,view 端只 import { SearchBar, useSearch }。
 */

import { useState, useCallback, useRef, useEffect, type ChangeEvent, type KeyboardEvent } from 'react';
import type { SearchResult } from '../Host';

interface SearchBarProps {
  visible: boolean;
  results: SearchResult[];
  currentIndex: number;
  onSearch: (query: string) => void;
  onNext: () => void;
  onPrev: () => void;
  onClose: () => void;
}

export function SearchBar({
  visible,
  results,
  currentIndex,
  onSearch,
  onNext,
  onPrev,
  onClose,
}: SearchBarProps) {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (visible) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [visible]);

  const handleChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const val = e.target.value;
      setQuery(val);
      onSearch(val);
    },
    [onSearch],
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        if (e.shiftKey) onPrev();
        else onNext();
      } else if (e.key === 'Escape') {
        onClose();
      }
    },
    [onNext, onPrev, onClose],
  );

  if (!visible) return null;

  return (
    <div className="krig-ebook-search-bar">
      <input
        ref={inputRef}
        className="krig-ebook-search-bar__input"
        value={query}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder="搜索..."
      />
      <span className="krig-ebook-search-bar__count">
        {results.length > 0
          ? `${currentIndex + 1} / ${results.length}`
          : query
            ? '无结果'
            : ''}
      </span>
      <button
        className="krig-ebook-search-bar__btn"
        onClick={onPrev}
        disabled={results.length === 0}
        title="上一个 (Shift+Enter)"
      >
        ‹
      </button>
      <button
        className="krig-ebook-search-bar__btn"
        onClick={onNext}
        disabled={results.length === 0}
        title="下一个 (Enter)"
      >
        ›
      </button>
      <button
        className="krig-ebook-search-bar__btn"
        onClick={onClose}
        title="关闭 (Esc)"
      >
        ✕
      </button>
    </div>
  );
}
