/**
 * generic-toolbar — 非 mermaid codeBlock 的 hover toolbar
 *
 * 视觉:[Language ∨] [Copy] [Fullscreen](Phase 3 启用 Fullscreen)
 *
 * 设计:
 * - DOM 在 NodeView 外层 div 内,但**不在** contentDOM(<code>)内 — ignoreMutation
 *   守门 toolbar 变化不让 PM 重渲(对齐 mermaid NodeView)
 * - lang button 点击 → openLangDropdown → onPick → 调 onLanguageChange 回调让
 *   NodeView 改 PM attrs
 * - Copy 按钮:writeText(contentDOM.textContent) → 1.5s 绿色反馈
 * - Fullscreen 按钮:调 onFullscreen 让 NodeView 触发 fullscreenOverlayController.show
 * - 共用 mermaid 的 CSS 类(`__toolbar` / `__toolbar-btn` / `__lang-label`)
 */
import { openLangDropdown, getLanguageLabel } from './lang-dropdown';

const ICON_COPY =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';

const ICON_CHEVRON =
  '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>';

const ICON_FULLSCREEN =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>';

export interface GenericToolbarOptions {
  /** 当前 attrs.language(''=plain) */
  initialLanguage: string;
  /** 用于复制按钮读源文本(NodeView 暴露的 <code>) */
  getCodeText: () => string;
  /** 切换语言时 NodeView 调 setNodeMarkup */
  onLanguageChange: (newLang: string) => void;
  /** 点击全屏按钮 — NodeView 反查 instanceId + getPos 后触发 fullscreen-overlay */
  onFullscreen: () => void;
}

export interface GenericToolbarHandle {
  /** toolbar 根元素 — NodeView appendChild 到 dom 内 */
  el: HTMLElement;
  /** PM 让 NodeView update 时同步当前语言显示 */
  setLanguage: (lang: string) => void;
  /** unmount 时由 NodeView destroy 调,清掉可能残留的 dropdown */
  destroy: () => void;
}

export function createGenericToolbar(opts: GenericToolbarOptions): GenericToolbarHandle {
  const root = document.createElement('div');
  root.className = 'krig-code-block__toolbar';
  root.setAttribute('contenteditable', 'false');

  // Language button — 点 → 打开 dropdown
  const langBtn = document.createElement('button');
  langBtn.type = 'button';
  langBtn.className = 'krig-code-block__lang-label krig-code-block__lang-btn';
  langBtn.title = '选择语言';

  const langText = document.createElement('span');
  langText.className = 'krig-code-block__lang-btn-text';
  langText.textContent = getLanguageLabel(opts.initialLanguage);
  langBtn.appendChild(langText);

  const chevron = document.createElement('span');
  chevron.className = 'krig-code-block__lang-btn-chevron';
  chevron.innerHTML = ICON_CHEVRON;
  langBtn.appendChild(chevron);

  let currentLanguage = opts.initialLanguage;

  langBtn.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    openLangDropdown({
      anchor: langBtn,
      currentId: currentLanguage,
      onPick: (newId) => {
        opts.onLanguageChange(newId);
        // 不立刻改 langText:NodeView update 走 setLanguage 同步,保证文案与 PM attrs 一致
      },
    });
  });
  root.appendChild(langBtn);

  // 右侧弹簧
  const spacer = document.createElement('div');
  spacer.style.flex = '1';
  root.appendChild(spacer);

  // Copy 按钮
  const copyBtn = document.createElement('button');
  copyBtn.type = 'button';
  copyBtn.className = 'krig-code-block__toolbar-btn';
  copyBtn.title = '复制代码';
  copyBtn.innerHTML = ICON_COPY;
  copyBtn.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const text = opts.getCodeText();
    void navigator.clipboard.writeText(text).then(() => {
      copyBtn.classList.add('krig-code-block__toolbar-btn--copied');
      copyBtn.title = '已复制!';
      setTimeout(() => {
        copyBtn.classList.remove('krig-code-block__toolbar-btn--copied');
        copyBtn.title = '复制代码';
      }, 1500);
    });
  });
  root.appendChild(copyBtn);

  // Fullscreen 按钮(Phase 3 启用)
  const fullscreenBtn = document.createElement('button');
  fullscreenBtn.type = 'button';
  fullscreenBtn.className = 'krig-code-block__toolbar-btn';
  fullscreenBtn.title = '全屏编辑';
  fullscreenBtn.innerHTML = ICON_FULLSCREEN;
  fullscreenBtn.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    opts.onFullscreen();
  });
  root.appendChild(fullscreenBtn);

  return {
    el: root,
    setLanguage: (lang: string) => {
      currentLanguage = lang;
      langText.textContent = getLanguageLabel(lang);
    },
    destroy: () => {
      // 当前实现 dropdown 是模块级 currentDropdown 守门,toolbar destroy 不主动关 —
      // dropdown mount 在 document.body,DOM 没在 NodeView dom 内,destroy 不会自动清,
      // 但用户切到其他 block 或点外侧 dropdown 自己会关
      // 显式触发 langBtn blur 让 doc mousedown handler 关掉(防御)
      langBtn.blur();
    },
  };
}
