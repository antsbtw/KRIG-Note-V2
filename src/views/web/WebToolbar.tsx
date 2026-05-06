/**
 * WebToolbar — WebView 内部工具栏(对齐 V1 简化版)
 *
 * 布局:[← →] [↻] | URL bar
 *
 * 砍 V1 的:书签按钮(Q6=A)/ 翻译按钮 / SlotToggle / closeSlot(留 slot UX epic)
 */

import { useState, useCallback, type KeyboardEvent } from 'react';

interface WebToolbarProps {
  url: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  onNavigate: (url: string) => void;
  onGoBack: () => void;
  onGoForward: () => void;
  onReload: () => void;
}

export function WebToolbar({
  url,
  loading,
  canGoBack,
  canGoForward,
  onNavigate,
  onGoBack,
  onGoForward,
  onReload,
}: WebToolbarProps) {
  const [editing, setEditing] = useState(false);
  const [inputValue, setInputValue] = useState('');

  const handleUrlFocus = useCallback(() => {
    setInputValue(url);
    setEditing(true);
  }, [url]);

  const handleUrlBlur = useCallback(() => {
    setEditing(false);
  }, []);

  const handleUrlKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        const trimmed = inputValue.trim();
        if (!trimmed) return;
        // 自动补 https://(对齐 V1 行为)
        const normalized = /^https?:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`;
        onNavigate(normalized);
        (e.target as HTMLInputElement).blur();
      } else if (e.key === 'Escape') {
        setEditing(false);
        setInputValue('');
        (e.target as HTMLInputElement).blur();
      }
    },
    [inputValue, onNavigate],
  );

  // 显示简洁 URL(去掉协议前缀,对齐 V1)
  const displayUrl = url.replace(/^https?:\/\//, '');

  return (
    <div className="krig-web-toolbar">
      <div className="krig-web-toolbar__nav">
        <button
          type="button"
          className="krig-web-toolbar__btn"
          onClick={onGoBack}
          disabled={!canGoBack}
          title="后退 (⌘[)"
          aria-label="后退"
        >
          ‹
        </button>
        <button
          type="button"
          className="krig-web-toolbar__btn"
          onClick={onGoForward}
          disabled={!canGoForward}
          title="前进 (⌘])"
          aria-label="前进"
        >
          ›
        </button>
        <button
          type="button"
          className="krig-web-toolbar__btn"
          onClick={onReload}
          title="刷新 (⌘R)"
          aria-label={loading ? '停止加载' : '刷新'}
        >
          {loading ? '✕' : '↻'}
        </button>
      </div>

      <div className="krig-web-toolbar__url">
        <input
          className="krig-web-toolbar__url-input"
          value={editing ? inputValue : displayUrl}
          onChange={(e) => setInputValue(e.target.value)}
          onFocus={handleUrlFocus}
          onBlur={handleUrlBlur}
          onKeyDown={handleUrlKeyDown}
          placeholder="输入网址..."
          spellCheck={false}
        />
      </div>
    </div>
  );
}
