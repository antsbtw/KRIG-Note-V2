/**
 * WebToolbar — WebView 内部工具栏(对齐 V1 简化版)
 *
 * 布局:[← →] [↻] | URL bar | [翻译]
 *
 * 砍 V1 的:书签按钮(Q6=A)/ SlotToggle / closeSlot(留 slot UX epic)
 * L5-B4.2 加:翻译按钮(toggle 双栏翻译模式)
 */

import { useState, useCallback, type KeyboardEvent } from 'react';

interface WebToolbarProps {
  url: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  /** L5-B4.2:翻译模式(右栏 web-translate-view)是否激活 */
  translateActive: boolean;
  onNavigate: (url: string) => void;
  onGoBack: () => void;
  onGoForward: () => void;
  onReload: () => void;
  /** L5-B4.2:点翻译按钮 — toggle 双栏翻译模式 */
  onToggleTranslate: () => void;
}

export function WebToolbar({
  url,
  loading,
  canGoBack,
  canGoForward,
  translateActive,
  onNavigate,
  onGoBack,
  onGoForward,
  onReload,
  onToggleTranslate,
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

      {/* 右侧 actions 区(L5-B4.2:翻译按钮)*/}
      <div className="krig-web-toolbar__actions">
        <button
          type="button"
          className={`krig-web-toolbar__btn${translateActive ? ' active' : ''}`}
          onClick={onToggleTranslate}
          title={translateActive ? '关闭翻译' : '双栏翻译'}
          aria-label="双栏翻译"
        >
          {/* SVG icon 对齐 V1 — 简化轮廓 */}
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 5h7" />
            <path d="M9 3v2c0 4.418-2.239 8-5 8" />
            <path d="M5 9c0 2.144 2.952 3.908 6.7 4" />
            <path d="M12 20l4-9 4 9" />
            <path d="M14.5 16.5h5" />
          </svg>
        </button>
      </div>
    </div>
  );
}
