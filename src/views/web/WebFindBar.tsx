/**
 * WebFindBar — 页内查找栏(P0,⌘F)
 *
 * 输入即查;`3/12` 计数;上一个/下一个;Esc / × 关闭。
 * 命令式调用走 host.findInPage / stopFindInPage(WebView 注入 callbacks)。
 *
 * 自身只管 UI + 输入态;查找结果计数由 WebView 从 Host 的 onFoundInPage 拿到后传入。
 */

import { useEffect, useRef, useCallback, type KeyboardEvent } from 'react';

interface WebFindBarProps {
  /** 当前查找词(受控,由 WebView 持有,便于 Esc 清空)*/
  query: string;
  /** 当前命中序号(1-based,0 = 无)*/
  activeMatchOrdinal: number;
  /** 总命中数 */
  matches: number;
  onQueryChange: (q: string) => void;
  /** 下一个 / 上一个(forward) */
  onFindNext: (forward: boolean) => void;
  onClose: () => void;
}

export function WebFindBar({
  query,
  activeMatchOrdinal,
  matches,
  onQueryChange,
  onFindNext,
  onClose,
}: WebFindBarProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  // 打开时自动 focus + 选中(方便覆盖输入)
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    el.select();
  }, []);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        // shift+Enter = 上一个
        onFindNext(!e.shiftKey);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    },
    [onFindNext, onClose],
  );

  const hasQuery = query.trim().length > 0;
  const countLabel = !hasQuery ? '' : matches > 0 ? `${activeMatchOrdinal}/${matches}` : '0/0';

  return (
    <div className="krig-web-view__find-bar">
      <input
        ref={inputRef}
        className="krig-web-view__find-input"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="页内查找…"
        spellCheck={false}
        aria-label="页内查找"
      />
      <span className="krig-web-view__find-count">{countLabel}</span>
      <button
        type="button"
        className="krig-web-view__find-btn"
        onClick={() => onFindNext(false)}
        disabled={matches === 0}
        title="上一个 (⇧Enter)"
        aria-label="上一个"
      >
        ‹
      </button>
      <button
        type="button"
        className="krig-web-view__find-btn"
        onClick={() => onFindNext(true)}
        disabled={matches === 0}
        title="下一个 (Enter)"
        aria-label="下一个"
      >
        ›
      </button>
      <button
        type="button"
        className="krig-web-view__find-btn krig-web-view__find-close"
        onClick={onClose}
        title="关闭 (Esc)"
        aria-label="关闭查找"
      >
        ×
      </button>
    </div>
  );
}
