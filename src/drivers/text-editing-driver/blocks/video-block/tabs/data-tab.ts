/**
 * data-tab — videoBlock 'data' Tab(L5-B3.19.a 基础版)
 *
 * 本段:仅 title 编辑 + src readonly 显示 + duration / mimeType 显示。
 * 完整版(下载状态机 / localFilePath / metadata 编辑等)留 B3.19.e。
 */

import type { Node as PMNode } from 'prosemirror-model';

export interface DataTab {
  el: HTMLElement;
  /** title 文本编辑变化(节流由 node-view 协调,本组件直推)*/
  onTitleChange(cb: (title: string) => void): () => void;
  destroy(): void;
}

export function createDataTab(node: PMNode): DataTab {
  const el = document.createElement('div');
  el.className = 'krig-video-block__data-tab';
  el.contentEditable = 'false';

  const listeners = new Set<(title: string) => void>();

  // ── title row ──
  const titleRow = document.createElement('div');
  titleRow.className = 'krig-video-block__data-row';
  const titleLabel = document.createElement('label');
  titleLabel.className = 'krig-video-block__data-label';
  titleLabel.textContent = 'Title';
  titleRow.appendChild(titleLabel);
  const titleInput = document.createElement('input');
  titleInput.type = 'text';
  titleInput.className = 'krig-video-block__data-input';
  titleInput.value = (node.attrs.title as string) || '';
  titleInput.addEventListener('input', () => {
    listeners.forEach((cb) => cb(titleInput.value));
  });
  titleRow.appendChild(titleInput);
  el.appendChild(titleRow);

  // ── src row(readonly)──
  const srcRow = document.createElement('div');
  srcRow.className = 'krig-video-block__data-row';
  const srcLabel = document.createElement('label');
  srcLabel.className = 'krig-video-block__data-label';
  srcLabel.textContent = 'Source';
  srcRow.appendChild(srcLabel);
  const srcVal = document.createElement('div');
  srcVal.className = 'krig-video-block__data-value';
  srcVal.textContent = (node.attrs.src as string) || '(empty)';
  srcRow.appendChild(srcVal);
  el.appendChild(srcRow);

  // ── duration / mime(若有,readonly)──
  if (node.attrs.duration != null) {
    const dRow = document.createElement('div');
    dRow.className = 'krig-video-block__data-row';
    const dLabel = document.createElement('label');
    dLabel.className = 'krig-video-block__data-label';
    dLabel.textContent = 'Duration';
    dRow.appendChild(dLabel);
    const dVal = document.createElement('div');
    dVal.className = 'krig-video-block__data-value';
    dVal.textContent = formatDuration(node.attrs.duration as number);
    dRow.appendChild(dVal);
    el.appendChild(dRow);
  }

  if (node.attrs.mimeType) {
    const mRow = document.createElement('div');
    mRow.className = 'krig-video-block__data-row';
    const mLabel = document.createElement('label');
    mLabel.className = 'krig-video-block__data-label';
    mLabel.textContent = 'Mime';
    mRow.appendChild(mLabel);
    const mVal = document.createElement('div');
    mVal.className = 'krig-video-block__data-value';
    mVal.textContent = node.attrs.mimeType as string;
    mRow.appendChild(mVal);
    el.appendChild(mRow);
  }

  return {
    el,
    onTitleChange(cb) {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    destroy() {
      listeners.clear();
      el.remove();
    },
  };
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}
