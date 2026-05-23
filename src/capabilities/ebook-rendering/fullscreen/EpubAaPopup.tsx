/**
 * EpubAaPopup — EPUB 阅读偏好 popup(对齐 Apple Books Reading Styles)
 *
 * 两个独立维度:
 * - EpubTheme(风格):  Original / Quiet / Paper / Bold / Calm / Focus (6 卡)
 * - EpubAppearance(明暗): Light / Dark / Automatic (moon 按钮弹菜单切换)
 *
 * 三行结构:
 * 1. 顶部胶囊 — [A 小] [A 大] · moon 圆按钮(点出 Light/Dark/Auto 三选菜单)
 * 2-3. 主题卡 2 行 × 3 列 — 每卡用该主题"当前 appearance"下的真实配色 + 字重预览
 *
 * 用法:
 * - fullscreen panel 内:面板自管 state + 直接调用本组件
 * - view 内 toolbar:走 popup-registry,EBookAaPopup wrapper 注入 state
 */

import { useState, useRef, useEffect } from 'react';
import type { EpubTheme, EpubAppearance } from '../types';
import './epub-aa-popup.css';

interface EpubAaPopupProps {
  fontSize: number;
  theme: EpubTheme;
  appearance: EpubAppearance;
  onFontSizeChange: (size: number) => void;
  onThemeChange: (theme: EpubTheme) => void;
  onAppearanceChange: (appearance: EpubAppearance) => void;
}

const FONT_MIN = 60;
const FONT_MAX = 200;
const FONT_STEP = 10;

interface ThemeOption {
  id: EpubTheme;
  label: string;
  weight: number;
  light: { bg: string; fg: string };
  dark: { bg: string; fg: string };
}

// 镜像 THEME_DEFINITIONS 让 popup 卡片预览跟真实渲染一致
const THEMES: ThemeOption[] = [
  { id: 'original', label: 'Original', weight: 400,
    light: { bg: '#ffffff', fg: '#1a1a1a' }, dark:  { bg: '#1e1e1e', fg: '#e8e8eb' } },
  { id: 'quiet',    label: 'Quiet',    weight: 300,
    light: { bg: '#262626', fg: '#9a9a9d' }, dark:  { bg: '#1e1e1e', fg: '#9a9a9d' } },
  { id: 'paper',    label: 'Paper',    weight: 400,
    light: { bg: '#f5efe0', fg: '#3a3128' }, dark:  { bg: '#2a2620', fg: '#e8dcc4' } },
  { id: 'bold',     label: 'Bold',     weight: 700,
    light: { bg: '#ffffff', fg: '#000000' }, dark:  { bg: '#1e1e1e', fg: '#ffffff' } },
  { id: 'calm',     label: 'Calm',     weight: 400,
    light: { bg: '#e8dfc8', fg: '#4a3a2a' }, dark:  { bg: '#3a342c', fg: '#e8dcc4' } },
  { id: 'focus',    label: 'Focus',    weight: 400,
    light: { bg: '#f0ead5', fg: '#3a3528' }, dark:  { bg: '#2a2520', fg: '#d4c8a8' } },
];

/** 解析 appearance 显示用(popup 预览要知道当前到底是 light 还是 dark)
 *  auto 同 EPUBRenderer.resolveAppearance,跟 prefers-color-scheme */
function resolveDisplayAppearance(a: EpubAppearance): 'light' | 'dark' {
  if (a !== 'auto') return a;
  if (typeof window !== 'undefined'
      && window.matchMedia?.('(prefers-color-scheme: dark)').matches) {
    return 'dark';
  }
  return 'light';
}

export function EpubAaPopup({
  fontSize,
  theme,
  appearance,
  onFontSizeChange,
  onThemeChange,
  onAppearanceChange,
}: EpubAaPopupProps) {
  const [appearanceMenuOpen, setAppearanceMenuOpen] = useState(false);
  const moonRef = useRef<HTMLButtonElement | null>(null);
  // appearance 实际表现的明暗(用于卡片预览着色)
  const displayMode = resolveDisplayAppearance(appearance);

  // 点 popup 外关闭 appearance 菜单(popup 自身也是浮层,简单 window mousedown 守门)
  useEffect(() => {
    if (!appearanceMenuOpen) return;
    const handler = (e: MouseEvent): void => {
      const target = e.target as HTMLElement;
      if (!target.closest?.('.krig-epub-aa-popup__appearance-menu')
          && target !== moonRef.current) {
        setAppearanceMenuOpen(false);
      }
    };
    // 下一帧挂,避免点 moon 触发的 mousedown 立即被这个 handler 关掉
    const t = setTimeout(() => window.addEventListener('mousedown', handler), 0);
    return () => {
      clearTimeout(t);
      window.removeEventListener('mousedown', handler);
    };
  }, [appearanceMenuOpen]);

  const handleFontMinus = (): void => {
    if (fontSize <= FONT_MIN) return;
    onFontSizeChange(Math.max(FONT_MIN, fontSize - FONT_STEP));
  };
  const handleFontPlus = (): void => {
    if (fontSize >= FONT_MAX) return;
    onFontSizeChange(Math.min(FONT_MAX, fontSize + FONT_STEP));
  };
  const handleAppearancePick = (a: EpubAppearance): void => {
    onAppearanceChange(a);
    setAppearanceMenuOpen(false);
  };

  return (
    <div className="krig-epub-aa-popup">
      {/* 顶部:字号小/大 胶囊 + moon 圆按钮 */}
      <div className="krig-epub-aa-popup__top-row">
        <div className="krig-epub-aa-popup__font-pill">
          <button
            type="button"
            className="krig-epub-aa-popup__pill-btn"
            onMouseDown={(e) => e.preventDefault()}
            onClick={handleFontMinus}
            disabled={fontSize <= FONT_MIN}
            aria-label="缩小字号"
          >
            <span className="krig-epub-aa-popup__font-small">A</span>
          </button>
          <div className="krig-epub-aa-popup__pill-divider" />
          <button
            type="button"
            className="krig-epub-aa-popup__pill-btn"
            onMouseDown={(e) => e.preventDefault()}
            onClick={handleFontPlus}
            disabled={fontSize >= FONT_MAX}
            aria-label="放大字号"
          >
            <span className="krig-epub-aa-popup__font-large">A</span>
          </button>
        </div>
        <div className="krig-epub-aa-popup__moon-wrap">
          <button
            ref={moonRef}
            type="button"
            className="krig-epub-aa-popup__moon-btn"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setAppearanceMenuOpen((o) => !o)}
            aria-label="明暗模式"
            title="明暗模式"
            aria-expanded={appearanceMenuOpen}
          >
            🌙
          </button>
          {appearanceMenuOpen && (
            <div className="krig-epub-aa-popup__appearance-menu" role="menu">
              <button
                type="button"
                className="krig-epub-aa-popup__appearance-item"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => handleAppearancePick('light')}
                role="menuitemradio"
                aria-checked={appearance === 'light'}
              >
                <span className="krig-epub-aa-popup__appearance-icon">☀️</span>
                <span>Light</span>
                {appearance === 'light' && <span className="krig-epub-aa-popup__appearance-check">✓</span>}
              </button>
              <button
                type="button"
                className="krig-epub-aa-popup__appearance-item"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => handleAppearancePick('dark')}
                role="menuitemradio"
                aria-checked={appearance === 'dark'}
              >
                <span className="krig-epub-aa-popup__appearance-icon">🌙</span>
                <span>Dark</span>
                {appearance === 'dark' && <span className="krig-epub-aa-popup__appearance-check">✓</span>}
              </button>
              <button
                type="button"
                className="krig-epub-aa-popup__appearance-item"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => handleAppearancePick('auto')}
                role="menuitemradio"
                aria-checked={appearance === 'auto'}
              >
                <span className="krig-epub-aa-popup__appearance-icon">◐</span>
                <span>Automatic</span>
                {appearance === 'auto' && <span className="krig-epub-aa-popup__appearance-check">✓</span>}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* 主题卡 — 2 行 × 3 列;颜色 = 该主题在当前 appearance 下的变体 */}
      <div className="krig-epub-aa-popup__theme-grid">
        {THEMES.map((t) => {
          const c = displayMode === 'dark' ? t.dark : t.light;
          return (
            <button
              key={t.id}
              type="button"
              className={`krig-epub-aa-popup__theme-card ${theme === t.id ? 'krig-epub-aa-popup__theme-card--active' : ''}`}
              style={{ background: c.bg, color: c.fg, fontWeight: t.weight }}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onThemeChange(t.id)}
              aria-label={t.label}
              aria-pressed={theme === t.id}
            >
              <span className="krig-epub-aa-popup__theme-preview">
                <span className="krig-epub-aa-popup__theme-preview-big">大</span>
                <span className="krig-epub-aa-popup__theme-preview-small">小</span>
              </span>
              <span className="krig-epub-aa-popup__theme-label">{t.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
