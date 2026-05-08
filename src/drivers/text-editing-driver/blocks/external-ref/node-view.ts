/**
 * externalRef NodeView — 两态外部引用卡片(L5-B3.14)
 *
 * V1 → V2 直迁:src/plugins/note/blocks/external-ref.ts NodeView
 *
 * 行为:
 * - placeholder(无 href):pick file 按钮 + URL 输入(支持 https:// 或 file:///)
 * - card(有 href):kind 图标(📁/🌐)+ title + 路径/host 摘要 + [打开] +
 *   (kind=file)[Finder 显示]
 *
 * file picker → file:// URI(走 webUtils.getPathForFile / electronAPI.getFilePath);
 * 失败时 placeholder 显红字提示(决策 Q4 = B,UX 友好)
 */

import type { NodeViewConstructor } from 'prosemirror-view';
import type { Node as PMNode } from 'prosemirror-model';

interface DecodedHref {
  kind: 'file' | 'url';
  display: string;
  localPath: string | null;
}

function decodeHref(href: string): DecodedHref {
  if (href.startsWith('file:')) {
    try {
      const u = new URL(href);
      const p = decodeURIComponent(u.pathname);
      return { kind: 'file', display: p, localPath: p };
    } catch {
      return { kind: 'file', display: href, localPath: href.replace(/^file:\/\//, '') };
    }
  }
  try {
    const u = new URL(href);
    return { kind: 'url', display: u.host + u.pathname, localPath: null };
  } catch {
    return { kind: 'url', display: href, localPath: null };
  }
}

/** File 对象 → file:// URI(通过 electronAPI.getFilePath / webUtils);失败返空串 */
function fileToFileHref(file: File): string {
  const p = window.electronAPI?.getFilePath?.(file) || '';
  if (!p) return '';
  // POSIX 路径编码(本阶段 macOS-only)
  const enc = p.split('/').map((s) => (s ? encodeURIComponent(s) : '')).join('/');
  return `file://${enc}`;
}

function openHref(href: string): void {
  if (!href) return;
  if (href.startsWith('file:')) {
    const d = decodeHref(href);
    if (d.localPath) void window.electronAPI?.openPath?.(d.localPath);
  } else {
    void window.electronAPI?.openExternal?.(href);
  }
}

function showHrefInFinder(href: string): void {
  const d = decodeHref(href);
  if (d.localPath) void window.electronAPI?.showItemInFolder?.(d.localPath);
}

export const externalRefNodeView: NodeViewConstructor = (initialNode, view, getPos) => {
  let node = initialNode;
  const dom = document.createElement('div');
  dom.classList.add('krig-external-ref');
  dom.setAttribute('contenteditable', 'false');

  function updateAttrs(attrs: Record<string, unknown>): void {
    const pos = typeof getPos === 'function' ? getPos() : undefined;
    if (pos == null) return;
    let tr = view.state.tr;
    for (const [k, v] of Object.entries(attrs)) {
      tr = tr.setNodeAttribute(pos, k, v);
    }
    view.dispatch(tr);
  }

  function renderPlaceholder(errorMsg?: string): void {
    dom.innerHTML = '';
    const inner = document.createElement('div');
    inner.classList.add('krig-external-ref__placeholder');

    const iconEl = document.createElement('div');
    iconEl.classList.add('krig-external-ref__icon');
    iconEl.textContent = '🔗';
    inner.appendChild(iconEl);

    const ctrls = document.createElement('div');
    ctrls.classList.add('krig-external-ref__ctrls');

    // pick file
    const pickBtn = document.createElement('button');
    pickBtn.classList.add('krig-external-ref__btn');
    pickBtn.textContent = 'Pick a file';
    pickBtn.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      const input = document.createElement('input');
      input.type = 'file';
      input.addEventListener('change', () => {
        const f = input.files?.[0];
        if (!f) return;
        const href = fileToFileHref(f);
        if (!href) {
          // 失败提示(Blob URL / 拖入 web 来源等无 disk path 场景)
          renderPlaceholder('无法解析文件路径,请改用下方 URL 输入');
          return;
        }
        updateAttrs({
          kind: 'file',
          href,
          title: f.name,
          mimeType: f.type || '',
          size: f.size ?? null,
          modifiedAt: f.lastModified ?? null,
        });
      });
      input.click();
    });
    ctrls.appendChild(pickBtn);

    // url embed
    const urlInput = document.createElement('input');
    urlInput.type = 'text';
    urlInput.classList.add('krig-external-ref__url');
    urlInput.placeholder = 'https://... or file:///...';
    urlInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const raw = urlInput.value.trim();
        if (!raw) return;
        const isFile = raw.startsWith('file:') || raw.startsWith('/');
        const href = isFile && raw.startsWith('/')
          ? `file://${raw.split('/').map((s) => (s ? encodeURIComponent(s) : '')).join('/')}`
          : raw;
        updateAttrs({ kind: isFile ? 'file' : 'url', href, title: '' });
      }
    });
    ctrls.appendChild(urlInput);

    inner.appendChild(ctrls);

    if (errorMsg) {
      const err = document.createElement('div');
      err.classList.add('krig-external-ref__error');
      err.textContent = errorMsg;
      inner.appendChild(err);
    }

    dom.appendChild(inner);
  }

  function renderCard(n: PMNode): void {
    dom.innerHTML = '';
    const kind = (n.attrs.kind as 'file' | 'url') || 'url';
    const href = (n.attrs.href as string) || '';
    const title = (n.attrs.title as string) || '';
    const decoded = decodeHref(href);

    const inner = document.createElement('div');
    inner.classList.add('krig-external-ref__card');

    const iconEl = document.createElement('div');
    iconEl.classList.add('krig-external-ref__icon');
    iconEl.textContent = kind === 'file' ? '📁' : '🌐';
    inner.appendChild(iconEl);

    const meta = document.createElement('div');
    meta.classList.add('krig-external-ref__meta');

    const titleEl = document.createElement('div');
    titleEl.classList.add('krig-external-ref__title');
    titleEl.textContent = title || decoded.display || '(无标题)';
    meta.appendChild(titleEl);

    const subEl = document.createElement('div');
    subEl.classList.add('krig-external-ref__sub');
    subEl.textContent = kind === 'file' ? (decoded.localPath || '') : (decoded.display || '');
    meta.appendChild(subEl);

    inner.appendChild(meta);

    const actions = document.createElement('div');
    actions.classList.add('krig-external-ref__actions');

    const openBtn = document.createElement('button');
    openBtn.classList.add('krig-external-ref__btn');
    openBtn.textContent = '打开';
    openBtn.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      openHref((node.attrs.href as string) || '');
    });
    actions.appendChild(openBtn);

    if (kind === 'file') {
      const revealBtn = document.createElement('button');
      revealBtn.classList.add('krig-external-ref__btn');
      revealBtn.textContent = '在 Finder 显示';
      revealBtn.addEventListener('click', (e) => {
        e.preventDefault(); e.stopPropagation();
        showHrefInFinder((node.attrs.href as string) || '');
      });
      actions.appendChild(revealBtn);
    }

    inner.appendChild(actions);
    dom.appendChild(inner);
  }

  function paint(n: PMNode): void {
    if (n.attrs.href) renderCard(n);
    else renderPlaceholder();
  }

  paint(node);

  return {
    dom,
    update(updated) {
      if (updated.type.name !== 'externalRef') return false;
      const hadHref = !!node.attrs.href;
      const hasHref = !!updated.attrs.href;
      node = updated;
      if (hadHref !== hasHref) paint(node);
      else if (hasHref) renderCard(node);
      return true;
    },
    stopEvent() { return true; },
    ignoreMutation() { return true; },
  };
};
