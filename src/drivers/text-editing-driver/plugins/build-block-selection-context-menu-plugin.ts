/**
 * block-selection 右键菜单 plugin
 *
 * 当 state.selection 是 MultipleNodeSelection 且右键落在选区内 → 弹 DOM 菜单
 * (复制 / 剪切 / 粘贴), 走 document.execCommand('copy'|'cut'|'paste') 触发 PM 默认
 * clipboard pipeline。
 *
 * 菜单外点击 / Esc / 滚动 → 自动关闭。
 */

import { Plugin } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { MultipleNodeSelection } from './_shared/multiple-node-selection';

let activeContextMenu: HTMLElement | null = null;

function dismissMenu(): void {
  if (activeContextMenu) {
    activeContextMenu.remove();
    activeContextMenu = null;
  }
}

function showMenu(view: EditorView, clientX: number, clientY: number): void {
  dismissMenu();

  const menu = document.createElement('div');
  menu.className = 'krig-block-selection-menu';
  menu.contentEditable = 'false';
  menu.style.cssText =
    `position: fixed; left: ${clientX}px; top: ${clientY}px; z-index: 1000;` +
    `min-width: 160px; padding: 4px 0;` +
    `background: #2a2a2a; color: #f3f6fa; border: 1px solid #444;` +
    `border-radius: 6px; box-shadow: 0 6px 24px rgba(0, 0, 0, 0.4);` +
    `font-size: 13px; user-select: none;` +
    `font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;`;

  const addItem = (label: string, shortcut: string, run: () => void): void => {
    const item = document.createElement('div');
    item.style.cssText =
      `display: flex; align-items: center; justify-content: space-between;` +
      `padding: 6px 12px; cursor: pointer;`;
    const labelEl = document.createElement('span');
    labelEl.textContent = label;
    const shortcutEl = document.createElement('span');
    shortcutEl.textContent = shortcut;
    shortcutEl.style.cssText = 'color: #888; margin-left: 16px; font-size: 11px;';
    item.appendChild(labelEl);
    item.appendChild(shortcutEl);
    item.addEventListener('mouseenter', () => {
      item.style.background = '#3a3a3a';
    });
    item.addEventListener('mouseleave', () => {
      item.style.background = 'transparent';
    });
    item.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      run();
      dismissMenu();
    });
    menu.appendChild(item);
  };

  const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform);
  const mod = isMac ? '⌘' : 'Ctrl+';

  const exec = (kind: 'copy' | 'cut' | 'paste'): void => {
    view.focus();
    try {
      document.execCommand(kind);
    } catch {
      console.warn(`[block-selection-menu] execCommand(${kind}) failed`);
    }
  };

  addItem('复制', `${mod}C`, () => exec('copy'));
  addItem('剪切', `${mod}X`, () => exec('cut'));
  addItem('粘贴', `${mod}V`, () => exec('paste'));

  document.body.appendChild(menu);
  activeContextMenu = menu;

  // 防溢出视口
  const r = menu.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  if (r.right > vw) menu.style.left = `${Math.max(0, vw - r.width - 8)}px`;
  if (r.bottom > vh) menu.style.top = `${Math.max(0, vh - r.height - 8)}px`;

  const dismiss = (): void => {
    dismissMenu();
    document.removeEventListener('mousedown', onOutside, true);
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('scroll', dismiss, true);
  };
  const onOutside = (e: MouseEvent): void => {
    if (activeContextMenu && !activeContextMenu.contains(e.target as globalThis.Node)) {
      dismiss();
    }
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') dismiss();
  };
  // 异步注册避免立即被自身 contextmenu 触发的事件序列误关
  setTimeout(() => {
    document.addEventListener('mousedown', onOutside, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', dismiss, true);
  }, 0);
}

export function buildBlockSelectionContextMenuPlugin(): Plugin {
  return new Plugin({
    props: {
      handleDOMEvents: {
        contextmenu(view, event) {
          const sel = view.state.selection;
          if (!(sel instanceof MultipleNodeSelection)) return false;
          const result = view.posAtCoords({ left: event.clientX, top: event.clientY });
          if (!result) return false;
          // 落点必须在选区范围内
          if (result.pos < sel.from || result.pos >= sel.to) return false;
          event.preventDefault();
          showMenu(view, event.clientX, event.clientY);
          return true;
        },
      },
    },
  });
}
