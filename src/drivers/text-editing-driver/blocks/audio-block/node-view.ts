/**
 * audioBlock NodeView — 两态播放器(L5-B3.16)
 *
 * V1 → V2 直迁:src/plugins/note/blocks/audio-block.ts NodeView 部分
 *
 * 行为:
 * - placeholder(无 src):🎵 + Choose file 按钮 + URL embed 输入框
 * - player(有 src):title + <audio controls> + 下载按钮(http(s) 源)
 * - upload:FileReader → mediaPutBase64 → media:// URL → setNodeAttribute
 * - download(http(s) src):mediaDownload → src 替换为 media:// + 隐藏按钮
 * - destroy:暂停 audio + 清空 src 防内存泄漏(切笔记不残留声音 — 风险 § 10.2)
 *
 * caption:contentDOM 由 PM 接管,渲染时 NodeView 仅维护 wrapper 内的 player UI
 */

import type { NodeViewConstructor } from 'prosemirror-view';
import type { Node as PMNode } from 'prosemirror-model';
import { mediaPutBase64, mediaDownload } from '@capabilities/media-storage';

export const audioBlockNodeView: NodeViewConstructor = (initialNode, view, getPos) => {
  let node = initialNode;

  const dom = document.createElement('div');
  dom.className = 'krig-audio-block';

  // player 区(contentEditable=false,完全 NodeView 控制)
  const playerWrap = document.createElement('div');
  playerWrap.className = 'krig-audio-block__player';
  playerWrap.contentEditable = 'false';
  dom.appendChild(playerWrap);

  // caption 区(contentDOM,PM 接管)
  const captionDOM = document.createElement('figcaption');
  captionDOM.className = 'krig-audio-block__caption';
  dom.appendChild(captionDOM);

  // 当前 audio 引用(destroy 时释放)
  let audioEl: HTMLAudioElement | null = null;

  function updateAttrs(patch: Record<string, unknown>): void {
    const pos = typeof getPos === 'function' ? getPos() : undefined;
    if (pos == null) return;
    let tr = view.state.tr;
    for (const [key, value] of Object.entries(patch)) {
      tr = tr.setNodeAttribute(pos, key, value);
    }
    tr.setMeta('addToHistory', false); // 内部 attr 同步不进 undo 栈
    view.dispatch(tr);
  }

  function disposeAudio(): void {
    if (audioEl) {
      audioEl.pause();
      audioEl.src = '';
      audioEl = null;
    }
  }

  function buildPlaceholder(): void {
    disposeAudio();
    playerWrap.innerHTML = '';

    const ph = document.createElement('div');
    ph.className = 'krig-audio-block__placeholder';

    const icon = document.createElement('span');
    icon.className = 'krig-audio-block__placeholder-icon';
    icon.textContent = '🎵';
    ph.appendChild(icon);

    const actions = document.createElement('div');
    actions.className = 'krig-audio-block__placeholder-actions';

    // Upload
    const uploadBtn = document.createElement('button');
    uploadBtn.type = 'button';
    uploadBtn.className = 'krig-audio-block__placeholder-btn';
    uploadBtn.textContent = 'Upload';
    uploadBtn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'audio/*';
      input.addEventListener('change', () => {
        const file = input.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async () => {
          if (view.isDestroyed) return;
          const dataUrl = reader.result as string;
          const r = await mediaPutBase64(dataUrl, file.type, file.name);
          if (view.isDestroyed) return;
          if (r.success && r.mediaUrl) {
            updateAttrs({
              src: r.mediaUrl,
              title: file.name.replace(/\.[^.]+$/, ''),
              mimeType: file.type || null,
            });
          } else {
            console.warn('[audioBlock] mediaPutBase64 failed:', r.error);
            // session 内 fallback(刷新丢)
            updateAttrs({
              src: dataUrl,
              title: file.name.replace(/\.[^.]+$/, ''),
              mimeType: file.type || null,
            });
          }
        };
        reader.readAsDataURL(file);
      });
      input.click();
    });
    actions.appendChild(uploadBtn);

    // URL embed
    const urlInput = document.createElement('input');
    urlInput.type = 'text';
    urlInput.className = 'krig-audio-block__placeholder-url';
    urlInput.placeholder = 'Paste audio URL (.mp3, .ogg, .wav)...';
    urlInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const url = urlInput.value.trim();
        if (url) updateAttrs({ src: url });
      }
    });
    actions.appendChild(urlInput);

    ph.appendChild(actions);
    playerWrap.appendChild(ph);
  }

  function buildPlayer(n: PMNode): void {
    disposeAudio();
    playerWrap.innerHTML = '';

    // title
    const titleEl = document.createElement('div');
    titleEl.className = 'krig-audio-block__title';
    titleEl.textContent = (n.attrs.title as string) || 'Audio';
    playerWrap.appendChild(titleEl);

    // 播放器
    audioEl = document.createElement('audio');
    audioEl.src = n.attrs.src as string;
    audioEl.controls = true;
    audioEl.preload = 'metadata';
    audioEl.className = 'krig-audio-block__audio';
    playerWrap.appendChild(audioEl);

    // 下载按钮(仅 http(s) 源 — 已是 media:// 不需要)
    const src = n.attrs.src as string;
    if (src.startsWith('http://') || src.startsWith('https://')) {
      const downloadBtn = document.createElement('button');
      downloadBtn.type = 'button';
      downloadBtn.className = 'krig-audio-block__download-btn';
      downloadBtn.textContent = '⬇';
      downloadBtn.title = '下载到本地媒体库';
      downloadBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        downloadBtn.textContent = '⏳';
        downloadBtn.disabled = true;
        try {
          const r = await mediaDownload(src, 'audio');
          if (view.isDestroyed) return;
          if (r.success && r.mediaUrl) {
            updateAttrs({ src: r.mediaUrl });
            downloadBtn.textContent = '✅';
          } else {
            console.warn('[audioBlock] mediaDownload failed:', r.error);
            downloadBtn.textContent = '❌';
          }
        } catch (err) {
          console.warn('[audioBlock] mediaDownload threw:', err);
          downloadBtn.textContent = '❌';
        }
        setTimeout(() => {
          if (downloadBtn.isConnected) {
            downloadBtn.textContent = '⬇';
            downloadBtn.disabled = false;
          }
        }, 2000);
      });
      playerWrap.appendChild(downloadBtn);
    }
  }

  function paint(n: PMNode): void {
    if (n.attrs.src) buildPlayer(n);
    else buildPlaceholder();
  }

  paint(node);

  return {
    dom,
    contentDOM: captionDOM,
    update(updated) {
      if (updated.type.name !== 'audioBlock') return false;
      const hadSrc = !!node.attrs.src;
      const hasSrc = !!updated.attrs.src;
      const oldSrc = node.attrs.src;
      const oldTitle = node.attrs.title;
      node = updated;
      if (hadSrc !== hasSrc) {
        // 态切换 → 整体重渲
        paint(node);
      } else if (hasSrc) {
        // 同 player 态 — src 变 / title 变 → 局部刷新
        if (oldSrc !== updated.attrs.src) {
          buildPlayer(updated);
        } else if (oldTitle !== updated.attrs.title) {
          const titleEl = playerWrap.querySelector('.krig-audio-block__title');
          if (titleEl) titleEl.textContent = (updated.attrs.title as string) || 'Audio';
        }
      }
      return true;
    },
    stopEvent(event) {
      // audio 控件交互(play / pause / volume)由浏览器自处理
      const target = event.target as HTMLElement | null;
      if (target?.closest('audio, .krig-audio-block__placeholder, .krig-audio-block__download-btn')) {
        return true;
      }
      return false;
    },
    destroy() {
      disposeAudio();
    },
  };
};
