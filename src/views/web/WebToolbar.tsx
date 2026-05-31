/**
 * WebToolbar — WebView 内部工具栏(对齐 V1 简化版)
 *
 * 布局:[← →] [↻] | URL bar | [翻译] [▾]
 *
 * 砍 V1 的:书签按钮(Q6=A)/ SlotToggle / closeSlot(留 slot UX epic)
 * L5-B4.2 加:翻译按钮(toggle 双栏翻译模式)
 * L5-B4.2.2 加:翻译按钮旁小箭头 ▾(展开语言下拉,选语言写 per-ws state + banner 重启)
 */

import {
  useState,
  useCallback,
  useEffect,
  useRef,
  type KeyboardEvent,
  type RefObject,
} from 'react';
import { LANG_OPTIONS } from './translate-view/lang-defaults';
import { resolveOmniboxInput } from './omnibox';
import { queryHistory, type WebHistoryEntry } from './web-history';

interface WebToolbarProps {
  url: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  /** L5-B4.2:翻译模式(右栏 web-translate-view)是否激活 */
  translateActive: boolean;
  /** L5-B4.2.2:当前 per-ws 持久化的目标语言(zh-CN / ja / ko / en)*/
  currentTargetLang: string;
  onNavigate: (url: string) => void;
  onGoBack: () => void;
  onGoForward: () => void;
  onReload: () => void;
  /** L5-B4.2:点翻译按钮 — toggle 双栏翻译模式 */
  onToggleTranslate: () => void;
  /** L5-B4.2.2:用户从下拉菜单选了新语言(参数是 lang code) */
  onSelectLang: (lang: string) => void;
  /** P0(⌘L):WebView 注入的 URL input ref,用于 focus+select 地址栏 */
  urlInputRef?: RefObject<HTMLInputElement | null>;
}

export function WebToolbar({
  url,
  loading,
  canGoBack,
  canGoForward,
  translateActive,
  currentTargetLang,
  onNavigate,
  onGoBack,
  onGoForward,
  onReload,
  onToggleTranslate,
  onSelectLang,
  urlInputRef,
}: WebToolbarProps) {
  const [editing, setEditing] = useState(false);
  const [inputValue, setInputValue] = useState('');
  /** 语言菜单展开状态 */
  const [langMenuOpen, setLangMenuOpen] = useState(false);
  const langMenuRef = useRef<HTMLDivElement | null>(null);

  // ── 地址栏历史自动补全 ──
  /** 当前补全候选 */
  const [suggestions, setSuggestions] = useState<WebHistoryEntry[]>([]);
  /** 高亮候选索引(-1 = 无高亮,Enter 走当前输入框文字)*/
  const [highlightIdx, setHighlightIdx] = useState(-1);
  /** 首次 focus 全选标志:focus 时全选一次,之后正常放光标(对齐 Chrome)*/
  const selectedOnFocusRef = useRef(false);

  // ── 点菜单外区域关闭菜单 ──
  useEffect(() => {
    if (!langMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (!langMenuRef.current) return;
      if (!langMenuRef.current.contains(e.target as Node)) {
        setLangMenuOpen(false);
      }
    };
    // 下一帧再加 listener,避免捕获到打开菜单的那次 click
    const t = setTimeout(() => document.addEventListener('mousedown', handler), 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener('mousedown', handler);
    };
  }, [langMenuOpen]);

  const handleSelectLang = useCallback(
    (lang: string) => {
      setLangMenuOpen(false);
      onSelectLang(lang);
    },
    [onSelectLang],
  );

  const handleUrlFocus = useCallback(
    (e: React.FocusEvent<HTMLInputElement>) => {
      setInputValue(url);
      setEditing(true);
      // 首次 focus 全选(对齐 Chrome:点一下选中整条 URL,方便覆盖输入)
      e.target.select();
      selectedOnFocusRef.current = true;
    },
    [url],
  );

  // 阻止 focus 那一下 mouseup 把全选清掉(浏览器默认行为);仅首次拦,之后正常放光标
  const handleUrlMouseUp = useCallback((e: React.MouseEvent<HTMLInputElement>) => {
    if (selectedOnFocusRef.current) {
      e.preventDefault();
      selectedOnFocusRef.current = false;
    }
  }, []);

  const closeSuggestions = useCallback(() => {
    setSuggestions([]);
    setHighlightIdx(-1);
  }, []);

  const handleUrlBlur = useCallback(() => {
    setEditing(false);
    selectedOnFocusRef.current = false;
    // 延迟关候选,让候选项的 onMouseDown 先触发(否则 blur 先关掉点不到)
    setTimeout(closeSuggestions, 120);
  }, [closeSuggestions]);

  // 输入变化 → 查历史候选
  const handleUrlChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    setInputValue(v);
    setSuggestions(queryHistory(v));
    setHighlightIdx(-1);
  }, []);

  // 导航到某 URL(候选点击 / 选中回车走这里;原样 url 不再过 omnibox)
  const navigateToUrl = useCallback(
    (rawUrl: string, inputEl?: HTMLInputElement) => {
      if (!rawUrl) return;
      onNavigate(rawUrl);
      closeSuggestions();
      inputEl?.blur();
    },
    [onNavigate, closeSuggestions],
  );

  const handleUrlKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      const input = e.target as HTMLInputElement;
      if (e.key === 'ArrowDown') {
        if (suggestions.length === 0) return;
        e.preventDefault();
        setHighlightIdx((i) => (i + 1) % suggestions.length);
      } else if (e.key === 'ArrowUp') {
        if (suggestions.length === 0) return;
        e.preventDefault();
        setHighlightIdx((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
      } else if (e.key === 'Enter') {
        // 有高亮候选 → 直接打开候选 URL(已是完整 URL,不过 omnibox)
        if (highlightIdx >= 0 && highlightIdx < suggestions.length) {
          navigateToUrl(suggestions[highlightIdx].url, input);
          return;
        }
        // 否则:omnibox 判别 — 像 URL 当 URL,否则拼搜索引擎(见 omnibox.ts)
        const resolved = resolveOmniboxInput(inputValue);
        if (!resolved) return;
        navigateToUrl(resolved, input);
      } else if (e.key === 'Escape') {
        if (suggestions.length > 0) {
          // 先关候选,不退出编辑
          closeSuggestions();
          return;
        }
        setEditing(false);
        setInputValue('');
        input.blur();
      }
    },
    [inputValue, suggestions, highlightIdx, navigateToUrl, closeSuggestions],
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
          ref={urlInputRef}
          className="krig-web-toolbar__url-input"
          value={editing ? inputValue : displayUrl}
          onChange={handleUrlChange}
          onFocus={handleUrlFocus}
          onMouseUp={handleUrlMouseUp}
          onBlur={handleUrlBlur}
          onKeyDown={handleUrlKeyDown}
          placeholder="输入网址..."
          spellCheck={false}
          autoComplete="off"
        />
        {editing && suggestions.length > 0 && (
          <ul className="krig-web-toolbar__suggestions" role="listbox">
            {suggestions.map((s, i) => (
              <li
                key={s.url}
                role="option"
                aria-selected={i === highlightIdx}
                className={`krig-web-toolbar__suggestion${
                  i === highlightIdx ? ' active' : ''
                }`}
                // mousedown(非 click)— 在 input blur 之前触发,否则 blur 先关掉点不到
                onMouseDown={(e) => {
                  e.preventDefault();
                  navigateToUrl(s.url, urlInputRef?.current ?? undefined);
                }}
                onMouseEnter={() => setHighlightIdx(i)}
              >
                <span className="krig-web-toolbar__suggestion-url">
                  {s.url.replace(/^https?:\/\//, '')}
                </span>
                {s.title && (
                  <span className="krig-web-toolbar__suggestion-title">{s.title}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* 右侧 actions 区(翻译按钮 + 语言下拉箭头)*/}
      <div className="krig-web-toolbar__actions">
        <div className="krig-web-toolbar__translate-group" ref={langMenuRef}>
          <button
            type="button"
            className={`krig-web-toolbar__btn krig-web-toolbar__translate-btn${translateActive ? ' active' : ''}`}
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
          <button
            type="button"
            className="krig-web-toolbar__btn krig-web-toolbar__translate-caret"
            onClick={() => setLangMenuOpen((v) => !v)}
            title="选择目标语言"
            aria-label="选择目标语言"
            aria-expanded={langMenuOpen}
          >
            ▾
          </button>
          {langMenuOpen && (
            <div className="krig-web-toolbar__lang-menu" role="menu">
              {LANG_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  role="menuitem"
                  className={`krig-web-toolbar__lang-item${
                    opt.value === currentTargetLang ? ' active' : ''
                  }`}
                  onClick={() => handleSelectLang(opt.value)}
                >
                  <span className="krig-web-toolbar__lang-check">
                    {opt.value === currentTargetLang ? '✓' : ''}
                  </span>
                  <span className="krig-web-toolbar__lang-label">{opt.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
