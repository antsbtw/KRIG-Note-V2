/**
 * fileLink NodeView — inline atom 文件 chip(L5-B3.14)
 *
 * V1 → V2 直迁:src/plugins/note/blocks/file-link.ts NodeView
 *
 * 行为:
 * - 渲染 📎 + filename(contenteditable=false)
 * - 单击 → 打开文件
 * - 右键 → 自绘小菜单(打开 / 在 Finder 显示 / 复制路径)
 *
 * 自绘 contextmenu(决策 Q3 = A,V1 同款简单内嵌)— 不接 V2 contextMenuRegistry
 * (那是 view 区域级菜单,inline atom 节点级单独菜单更直观)
 */

import type { NodeViewConstructor } from 'prosemirror-view';
import { mediaResolvePath } from '@capabilities/media-storage';

async function resolveToLocalPath(src: string): Promise<string | null> {
  if (!src) return null;
  if (src.startsWith('media://')) return mediaResolvePath(src);
  if (src.startsWith('file://')) {
    try { return decodeURIComponent(new URL(src).pathname); } catch { return null; }
  }
  if (src.startsWith('/')) return src;
  return null;
}

async function openSrc(src: string): Promise<void> {
  if (!src) return;
  if (src.startsWith('media://') || src.startsWith('file://') || src.startsWith('/')) {
    const p = await resolveToLocalPath(src);
    if (p) await window.electronAPI?.openPath?.(p);
    return;
  }
  await window.electronAPI?.openExternal?.(src);
}

async function showInFinder(src: string): Promise<void> {
  const p = await resolveToLocalPath(src);
  if (p) await window.electronAPI?.showItemInFolder?.(p);
}

export const fileLinkNodeView: NodeViewConstructor = (initialNode, _view, _getPos) => {
  let node = initialNode;
  const dom = document.createElement('span');
  dom.classList.add('krig-file-link');
  dom.setAttribute('contenteditable', 'false');

  let currentSrc = (node.attrs.src as string) || '';
  let currentFilename = (node.attrs.filename as string) || '';

  function render(): void {
    dom.innerHTML = '';
    const icon = document.createElement('span');
    icon.classList.add('krig-file-link__icon');
    icon.textContent = '📎';
    const name = document.createElement('span');
    name.classList.add('krig-file-link__name');
    name.textContent = currentFilename || 'file';
    dom.appendChild(icon);
    dom.appendChild(name);
    dom.title = currentSrc || '';
  }

  render();

  dom.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (currentSrc) void openSrc(currentSrc);
  });

  // 自绘右键菜单
  dom.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!currentSrc) return;
    showContextMenu(e.clientX, e.clientY, currentSrc);
  });

  return {
    dom,
    update(updated) {
      if (updated.type.name !== 'fileLink') return false;
      node = updated;
      const newSrc = (node.attrs.src as string) || '';
      const newFilename = (node.attrs.filename as string) || '';
      if (newSrc !== currentSrc || newFilename !== currentFilename) {
        currentSrc = newSrc;
        currentFilename = newFilename;
        render();
      }
      return true;
    },
    stopEvent() { return true; },
    ignoreMutation() { return true; },
  };
};

function showContextMenu(x: number, y: number, src: string): void {
  // 移除已有菜单(防双开)
  document.querySelector('.krig-file-link-menu')?.remove();

  const menu = document.createElement('div');
  menu.classList.add('krig-file-link-menu');
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;

  const items: Array<{ label: string; action: () => void | Promise<void> }> = [
    { label: '打开', action: () => openSrc(src) },
    { label: '在 Finder 中显示', action: () => showInFinder(src) },
    { label: '复制路径', action: () => navigator.clipboard.writeText(src) },
  ];

  for (const item of items) {
    const row = document.createElement('div');
    row.classList.add('krig-file-link-menu__item');
    row.textContent = item.label;
    row.addEventListener('click', () => {
      void item.action();
      menu.remove();
    });
    menu.appendChild(row);
  }

  document.body.appendChild(menu);

  // 点外关闭
  const dismiss = () => {
    menu.remove();
    document.removeEventListener('mousedown', dismiss);
  };
  setTimeout(() => document.addEventListener('mousedown', dismiss), 0);
}
