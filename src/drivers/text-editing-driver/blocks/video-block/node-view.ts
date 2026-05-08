/**
 * videoBlock NodeView — placeholder ↔ youtube/direct 播放器(L5-B3.16)
 *
 * V1 → V2 直迁(砍字幕系统 / 砍 Vimeo/generic):src/plugins/note/blocks/video-block.ts
 *
 * 三态:
 * - placeholder(无 src)         :🎞 + Choose file + URL embed(支持 mp4 / YouTube URL)
 * - youtube(YouTube URL)        :<iframe> 16/9 比例(rel=0,无 jsapi)
 * - direct(mp4 / mov / media://):<video controls preload=metadata> + 下载按钮(http(s))
 *
 * destroy:停止 video 播放 + 清空 src 防内存泄漏(对齐 audio)
 */

import type { NodeViewConstructor } from 'prosemirror-view';
import type { Node as PMNode } from 'prosemirror-model';
import { mediaPutBase64, mediaDownload } from '@storage/media-store';

type EmbedType = 'youtube' | 'direct';

function detectEmbedType(url: string): EmbedType {
  if (/(?:youtube\.com\/(?:watch|embed|shorts)|youtu\.be\/)/i.test(url)) return 'youtube';
  return 'direct';
}

function extractYouTubeId(url: string): string | null {
  const m = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{11})/);
  return m?.[1] ?? null;
}

function toYouTubeEmbedUrl(id: string): string {
  // rel=0:不显示相关视频建议;无 enablejsapi(字幕系统才需要,留 Phase D)
  return `https://www.youtube.com/embed/${id}?rel=0`;
}

export const videoBlockNodeView: NodeViewConstructor = (initialNode, view, getPos) => {
  let node = initialNode;

  const dom = document.createElement('div');
  dom.className = 'krig-video-block';

  const playerWrap = document.createElement('div');
  playerWrap.className = 'krig-video-block__player';
  playerWrap.contentEditable = 'false';
  dom.appendChild(playerWrap);

  const captionDOM = document.createElement('figcaption');
  captionDOM.className = 'krig-video-block__caption';
  dom.appendChild(captionDOM);

  let videoEl: HTMLVideoElement | null = null;

  function updateAttrs(patch: Record<string, unknown>): void {
    const pos = typeof getPos === 'function' ? getPos() : undefined;
    if (pos == null) return;
    let tr = view.state.tr;
    for (const [key, value] of Object.entries(patch)) {
      tr = tr.setNodeAttribute(pos, key, value);
    }
    view.dispatch(tr);
  }

  function disposeVideo(): void {
    if (videoEl) {
      videoEl.pause();
      videoEl.src = '';
      videoEl = null;
    }
  }

  function buildPlaceholder(): void {
    disposeVideo();
    playerWrap.innerHTML = '';

    const ph = document.createElement('div');
    ph.className = 'krig-video-block__placeholder';

    const icon = document.createElement('span');
    icon.className = 'krig-video-block__placeholder-icon';
    icon.textContent = '🎞';
    ph.appendChild(icon);

    const actions = document.createElement('div');
    actions.className = 'krig-video-block__placeholder-actions';

    // Upload
    const uploadBtn = document.createElement('button');
    uploadBtn.type = 'button';
    uploadBtn.className = 'krig-video-block__placeholder-btn';
    uploadBtn.textContent = 'Upload';
    uploadBtn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'video/*';
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
              embedType: 'direct',
              title: file.name.replace(/\.[^.]+$/, ''),
              mimeType: file.type || null,
            });
          } else {
            console.warn('[videoBlock] mediaPutBase64 failed:', r.error);
            updateAttrs({
              src: dataUrl,
              embedType: 'direct',
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

    // URL embed(支持 mp4 / YouTube)
    const urlInput = document.createElement('input');
    urlInput.type = 'text';
    urlInput.className = 'krig-video-block__placeholder-url';
    urlInput.placeholder = 'mp4 URL or YouTube link...';
    urlInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const url = urlInput.value.trim();
        if (url) {
          const embedType = detectEmbedType(url);
          updateAttrs({ src: url, embedType });
        }
      }
    });
    actions.appendChild(urlInput);

    ph.appendChild(actions);
    playerWrap.appendChild(ph);
  }

  function buildYouTubeEmbed(n: PMNode): void {
    disposeVideo();
    playerWrap.innerHTML = '';

    const src = n.attrs.src as string;
    const videoId = extractYouTubeId(src);
    if (!videoId) {
      // src 标了 youtube 但解析不出 ID — 退化到 direct 试试
      buildDirectVideo(n);
      return;
    }

    // title
    if (n.attrs.title && n.attrs.title !== 'Video') {
      const titleEl = document.createElement('div');
      titleEl.className = 'krig-video-block__title';
      titleEl.textContent = n.attrs.title as string;
      playerWrap.appendChild(titleEl);
    }

    const iframe = document.createElement('iframe');
    iframe.src = toYouTubeEmbedUrl(videoId);
    iframe.setAttribute('allowfullscreen', '');
    iframe.setAttribute(
      'allow',
      'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture',
    );
    iframe.className = 'krig-video-block__iframe';
    playerWrap.appendChild(iframe);
  }

  function buildDirectVideo(n: PMNode): void {
    disposeVideo();
    playerWrap.innerHTML = '';

    if (n.attrs.title && n.attrs.title !== 'Video') {
      const titleEl = document.createElement('div');
      titleEl.className = 'krig-video-block__title';
      titleEl.textContent = n.attrs.title as string;
      playerWrap.appendChild(titleEl);
    }

    videoEl = document.createElement('video');
    videoEl.src = n.attrs.src as string;
    videoEl.controls = true;
    videoEl.preload = 'metadata';
    videoEl.className = 'krig-video-block__video';
    playerWrap.appendChild(videoEl);

    // 下载按钮(仅 http(s) 源)
    const src = n.attrs.src as string;
    if (src.startsWith('http://') || src.startsWith('https://')) {
      const downloadBtn = document.createElement('button');
      downloadBtn.type = 'button';
      downloadBtn.className = 'krig-video-block__download-btn';
      downloadBtn.textContent = '⬇';
      downloadBtn.title = '下载到本地媒体库';
      downloadBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        downloadBtn.textContent = '⏳';
        downloadBtn.disabled = true;
        try {
          const r = await mediaDownload(src, 'video');
          if (view.isDestroyed) return;
          if (r.success && r.mediaUrl) {
            updateAttrs({ src: r.mediaUrl });
            downloadBtn.textContent = '✅';
          } else {
            console.warn('[videoBlock] mediaDownload failed:', r.error);
            downloadBtn.textContent = '❌';
          }
        } catch (err) {
          console.warn('[videoBlock] mediaDownload threw:', err);
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
    if (!n.attrs.src) {
      buildPlaceholder();
      return;
    }
    const embedType = (n.attrs.embedType as EmbedType | null) ?? detectEmbedType(n.attrs.src as string);
    if (embedType === 'youtube') buildYouTubeEmbed(n);
    else buildDirectVideo(n);
  }

  paint(node);

  return {
    dom,
    contentDOM: captionDOM,
    update(updated) {
      if (updated.type.name !== 'videoBlock') return false;
      const oldSrc = node.attrs.src;
      const oldEmbed = node.attrs.embedType;
      const oldTitle = node.attrs.title;
      node = updated;
      // src / embedType 变 → 整体重渲;仅 title 变 → 局部刷新
      if (oldSrc !== updated.attrs.src || oldEmbed !== updated.attrs.embedType) {
        paint(updated);
      } else if (oldTitle !== updated.attrs.title) {
        const titleEl = playerWrap.querySelector('.krig-video-block__title');
        if (titleEl) {
          titleEl.textContent = (updated.attrs.title as string) || 'Video';
        }
      }
      return true;
    },
    stopEvent(event) {
      const target = event.target as HTMLElement | null;
      if (target?.closest(
        'video, iframe, .krig-video-block__placeholder, .krig-video-block__download-btn',
      )) {
        return true;
      }
      return false;
    },
    destroy() {
      disposeVideo();
    },
  };
};
