/**
 * EPUB 阅读偏好持久化(localStorage)
 *
 * 字号 + 主题等用户偏好走 localStorage 而非 SurrealDB:
 * - 单机用户偏好,不需要跨设备同步
 * - 不需要 IPC/main 落盘开销
 * - 配合 V2 已有 localStorage 先例(canvas-rendering floating-inspector / note migration)
 *
 * key 命名空间:krig.ebook.reading.* 避免与其他模块冲突
 */

import type { EpubTheme, EpubAppearance } from '../types';

const KEY_FONT_SIZE = 'krig.ebook.reading.fontSize';
const KEY_THEME = 'krig.ebook.reading.theme';
const KEY_APPEARANCE = 'krig.ebook.reading.appearance';

const FONT_DEFAULT = 100;
/** 默认主题:Original 风格 */
const THEME_DEFAULT: EpubTheme = 'original';
/** 默认明暗模式:auto 跟随系统(V2 永久 dark 等价于 dark)*/
const APPEARANCE_DEFAULT: EpubAppearance = 'auto';

/** 旧主题名迁移到 6 主题体系 — 历次方案演进:
 *  v1: original/sepia/dark → v2: light/dark → v3: 6 主题(original/quiet/paper/bold/calm/focus)
 *  - 'light' (v2) → 'paper'  (新 light 主题)
 *  - 'dark'  (v2) → 'original' (新 dark 默认)
 *  - 'sepia' (v1) → 'calm'   (暖色调)
 *  - 已是 v3 6 主题之一 → 直接保留 */
function migrateLegacyTheme(raw: string | null): EpubTheme | null {
  if (raw === 'original' || raw === 'quiet' || raw === 'paper'
      || raw === 'bold' || raw === 'calm' || raw === 'focus') {
    return raw;
  }
  if (raw === 'light') return 'paper';
  if (raw === 'dark') return 'original';
  if (raw === 'sepia') return 'calm';
  return null;
}

export interface EpubReadingSettings {
  fontSize: number;
  theme: EpubTheme;
  appearance: EpubAppearance;
}

export function loadEpubReadingSettings(): EpubReadingSettings {
  let fontSize = FONT_DEFAULT;
  let theme = THEME_DEFAULT;
  let appearance = APPEARANCE_DEFAULT;
  try {
    const f = localStorage.getItem(KEY_FONT_SIZE);
    if (f) {
      const n = parseInt(f, 10);
      if (!isNaN(n) && n >= 60 && n <= 200) fontSize = n;
    }
    const raw = localStorage.getItem(KEY_THEME);
    const migrated = migrateLegacyTheme(raw);
    if (migrated) {
      theme = migrated;
      if (raw !== migrated) {
        try { localStorage.setItem(KEY_THEME, migrated); } catch { /* noop */ }
      }
    }
    const a = localStorage.getItem(KEY_APPEARANCE);
    if (a === 'light' || a === 'dark' || a === 'auto') appearance = a;
  } catch {
    // localStorage 不可用,返回默认
  }
  return { fontSize, theme, appearance };
}

export function saveEpubFontSize(size: number): void {
  try {
    localStorage.setItem(KEY_FONT_SIZE, String(size));
  } catch {
    // noop
  }
  notify();
}

export function saveEpubTheme(theme: EpubTheme): void {
  try {
    localStorage.setItem(KEY_THEME, theme);
  } catch {
    // noop
  }
  notify();
}

export function saveEpubAppearance(appearance: EpubAppearance): void {
  try {
    localStorage.setItem(KEY_APPEARANCE, appearance);
  } catch {
    // noop
  }
  notify();
}

// ── 跨组件订阅 — popup 改 settings 时通知 view 重新读 + 推 host ──

type Listener = (s: EpubReadingSettings) => void;
const listeners = new Set<Listener>();

function notify(): void {
  const s = loadEpubReadingSettings();
  listeners.forEach((l) => l(s));
}

/** 订阅 settings 变化(任一 saveEpub* 后触发)— EBookView 用来同步推 host */
export function subscribeEpubReadingSettings(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
