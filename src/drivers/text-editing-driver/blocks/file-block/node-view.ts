/**
 * fileBlock NodeView — 两态附件卡片(L5-B3.14)
 *
 * V1 → V2 直迁:src/plugins/note/blocks/file-block.ts NodeView
 *
 * 行为:
 * - placeholder(无 src):file picker + URL embed
 * - card(有 src):MIME 图标 + 文件名 + MIME · 大小 + [打开] [Finder 显示]
 * - 上传:FileReader → mediaPutBase64 → media:// URL → setNodeAttribute
 * - 打开:media:// → mediaResolvePath → openPath;file:// → openPath;http(s) → openExternal
 * - 在 Finder 显示:resolveToLocalPath → showItemInFolder
 */

import type { NodeViewConstructor } from 'prosemirror-view';
import type { Node as PMNode } from 'prosemirror-model';
import { mediaPutBase64, mediaResolvePath } from '@capabilities/media-storage';

function iconForMime(mime: string): string {
  if (!mime) return '📎';
  if (mime.startsWith('image/')) return '🖼';
  if (mime.startsWith('video/')) return '🎞';
  if (mime.startsWith('audio/')) return '🔊';
  if (mime === 'application/pdf') return '📕';
  if (mime === 'application/zip' || mime === 'application/x-tar' || mime === 'application/x-7z-compressed') return '🗜';
  if (mime.startsWith('text/') || mime === 'application/json' || mime === 'application/xml') return '📄';
  if (mime.includes('spreadsheet') || mime === 'text/csv') return '📊';
  if (mime.includes('wordprocessing') || mime === 'application/msword') return '📝';
  if (mime.includes('presentation')) return '📽';
  return '📎';
}

function formatSize(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

/** src(media:// / file:// / 绝对路径)→ 本地路径 */
async function resolveToLocalPath(src: string): Promise<string | null> {
  if (!src) return null;
  if (src.startsWith('media://')) return mediaResolvePath(src);
  if (src.startsWith('file://')) {
    try { return decodeURIComponent(new URL(src).pathname); } catch { return null; }
  }
  if (src.startsWith('/')) return src;
  return null;
}

/** 打开 src(media:// / file:// → openPath;http(s) → openExternal)*/
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

export const fileBlockNodeView: NodeViewConstructor = (initialNode, view, getPos) => {
  let node = initialNode;
  const dom = document.createElement('div');
  dom.classList.add('krig-file-block');
  dom.setAttribute('contenteditable', 'false');

  function updateAttrs(attrs: Record<string, unknown>): void {
    const pos = typeof getPos === 'function' ? getPos() : undefined;
    if (pos == null) return;
    let tr = view.state.tr;
    for (const [key, value] of Object.entries(attrs)) {
      tr = tr.setNodeAttribute(pos, key, value);
    }
    tr.setMeta('addToHistory', false); // 内部 attr 同步不进 undo 栈
    view.dispatch(tr);
  }

  async function ingestFile(file: File): Promise<void> {
    const reader = new FileReader();
    reader.onload = async () => {
      if (view.isDestroyed) return;
      const dataUrl = reader.result as string;
      if (!dataUrl) return;
      const mime = file.type || 'application/octet-stream';
      const r = await mediaPutBase64(dataUrl, mime, file.name);
      if (view.isDestroyed) return;
      if (r.success && r.mediaUrl) {
        updateAttrs({
          src: r.mediaUrl,
          mediaId: r.mediaId || '',
          filename: file.name,
          mimeType: mime,
          size: file.size ?? null,
          source: 'user-uploaded',
        });
      } else {
        console.warn('[fileBlock] mediaPutBase64 failed:', r.error);
      }
    };
    reader.readAsDataURL(file);
  }

  function renderPlaceholder(): void {
    dom.innerHTML = '';
    const inner = document.createElement('div');
    inner.classList.add('krig-file-block__placeholder');

    const iconEl = document.createElement('div');
    iconEl.classList.add('krig-file-block__icon');
    iconEl.textContent = '📎';
    inner.appendChild(iconEl);

    const ctrls = document.createElement('div');
    ctrls.classList.add('krig-file-block__ctrls');

    // upload
    const uploadBtn = document.createElement('button');
    uploadBtn.classList.add('krig-file-block__btn');
    uploadBtn.textContent = 'Choose file';
    uploadBtn.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      const input = document.createElement('input');
      input.type = 'file';
      input.addEventListener('change', () => {
        const f = input.files?.[0];
        if (f) void ingestFile(f);
      });
      input.click();
    });
    ctrls.appendChild(uploadBtn);

    // url embed
    const urlInput = document.createElement('input');
    urlInput.type = 'text';
    urlInput.classList.add('krig-file-block__url');
    urlInput.placeholder = 'media://files/... or URL';
    urlInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const url = urlInput.value.trim();
        if (url) updateAttrs({ src: url, filename: (node.attrs.filename as string) || 'file' });
      }
    });
    ctrls.appendChild(urlInput);

    inner.appendChild(ctrls);
    dom.appendChild(inner);
  }

  function renderCard(n: PMNode): void {
    dom.innerHTML = '';
    const inner = document.createElement('div');
    inner.classList.add('krig-file-block__card');

    const iconEl = document.createElement('div');
    iconEl.classList.add('krig-file-block__icon');
    iconEl.textContent = iconForMime((n.attrs.mimeType as string) || '');
    inner.appendChild(iconEl);

    const meta = document.createElement('div');
    meta.classList.add('krig-file-block__meta');

    const nameEl = document.createElement('div');
    nameEl.classList.add('krig-file-block__name');
    nameEl.textContent = (n.attrs.filename as string) || '(未命名)';
    meta.appendChild(nameEl);

    const subEl = document.createElement('div');
    subEl.classList.add('krig-file-block__sub');
    const bits: string[] = [];
    if (n.attrs.mimeType) bits.push(n.attrs.mimeType as string);
    const sz = formatSize(n.attrs.size as number | null | undefined);
    if (sz) bits.push(sz);
    subEl.textContent = bits.join(' · ');
    meta.appendChild(subEl);

    inner.appendChild(meta);

    const actions = document.createElement('div');
    actions.classList.add('krig-file-block__actions');

    const openBtn = document.createElement('button');
    openBtn.classList.add('krig-file-block__btn');
    openBtn.textContent = '打开';
    openBtn.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      const src = (node.attrs.src as string) || '';
      void openSrc(src);
    });
    actions.appendChild(openBtn);

    const revealBtn = document.createElement('button');
    revealBtn.classList.add('krig-file-block__btn');
    revealBtn.textContent = '在 Finder 显示';
    revealBtn.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      const src = (node.attrs.src as string) || '';
      void showInFinder(src);
    });
    actions.appendChild(revealBtn);

    inner.appendChild(actions);
    dom.appendChild(inner);
  }

  function paint(n: PMNode): void {
    if (n.attrs.src) renderCard(n);
    else renderPlaceholder();
  }

  paint(node);

  return {
    dom,
    update(updated) {
      if (updated.type.name !== 'fileBlock') return false;
      const hadSrc = !!node.attrs.src;
      const hasSrc = !!updated.attrs.src;
      node = updated;
      if (hadSrc !== hasSrc) paint(node);
      else if (hasSrc) renderCard(node);
      return true;
    },
    stopEvent() { return true; },
    ignoreMutation() { return true; },
  };
};
