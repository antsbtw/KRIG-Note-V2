/**
 * data-tab — videoBlock 'data' Tab(L5-B3.19.a 基础版 → L5-B3.19.e 完整版)
 *
 * 本段(e):加 download status row(idle / downloading 45% / done + localFilePath)。
 * 仅显示状态,不含下载按钮(按钮在 actionBar)。
 */

import type { Node as PMNode } from 'prosemirror-model';

export type DownloadPhase = 'idle' | 'downloading' | 'done';

export interface DownloadStatusInfo {
  phase: DownloadPhase;
  percent?: number;
  localFilePath?: string | null;
}

export interface DataTab {
  el: HTMLElement;
  /** title 文本编辑变化(节流由 node-view 协调,本组件直推)*/
  onTitleChange(cb: (title: string) => void): () => void;
  /** L5-B3.19.e:由 node-view 调,更新下载状态显示 */
  setDownloadStatus(info: DownloadStatusInfo): void;
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

  // ── L5-B3.19.e download status row ──
  const dlRow = document.createElement('div');
  dlRow.className = 'krig-video-block__data-row';
  const dlLabel = document.createElement('label');
  dlLabel.className = 'krig-video-block__data-label';
  dlLabel.textContent = 'Download';
  dlRow.appendChild(dlLabel);
  const dlVal = document.createElement('div');
  dlVal.className = 'krig-video-block__data-value krig-video-block__data-download';
  dlVal.textContent = '未下载(点 actionBar 上的 ⬇)';
  dlRow.appendChild(dlVal);
  el.appendChild(dlRow);

  function applyDownloadStatus(info: DownloadStatusInfo): void {
    if (info.phase === 'idle') {
      dlVal.textContent = '未下载(点 actionBar 上的 ⬇)';
      dlVal.classList.remove('krig-video-block__data-download--done');
    } else if (info.phase === 'downloading') {
      const pct = info.percent != null ? Math.round(info.percent) : 0;
      dlVal.textContent = `下载中... ${pct}%`;
      dlVal.classList.remove('krig-video-block__data-download--done');
    } else {
      // done
      const path = info.localFilePath || '(已下载)';
      dlVal.textContent = path;
      dlVal.classList.add('krig-video-block__data-download--done');
    }
  }
  // 初次:基于 attrs.localFilePath 推断
  applyDownloadStatus({
    phase: node.attrs.localFilePath ? 'done' : 'idle',
    localFilePath: (node.attrs.localFilePath as string | null) || null,
  });

  return {
    el,
    onTitleChange(cb) {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    setDownloadStatus(info) {
      applyDownloadStatus(info);
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
