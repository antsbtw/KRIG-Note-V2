/**
 * videoBlock NodeView — placeholder ↔ youtube/direct 播放器 + transcript 编辑(L5-B3.16/19.1)
 *
 * V1 → V2 直迁(砍字幕系统 / 砍 Vimeo/generic):src/plugins/note/blocks/video-block.ts
 *
 * 三态:
 * - placeholder(无 src)         :🎞 + Choose file + URL embed(支持 mp4 / YouTube URL)
 * - youtube(YouTube URL)        :<iframe> 16/9 比例(rel=0,无 jsapi)+ 折叠 transcript 区
 * - direct(mp4 / mov / media://):<video controls preload=metadata> + 下载按钮(http(s))+ 折叠 transcript 区
 *
 * L5-B3.19.1 新增:
 * - direct + youtube 两个播放态下方都加折叠 transcript textarea(Q3=A 一致行为)
 * - cues 缓存(NodeView 闭包内,B3.19.2 CC 浮层用;本段无消费方,只保数据流路径)
 * - 500ms debounce 写 attrs.transcript(避免每个字符 dispatch)
 *
 * destroy:停止 video 播放 + 清空 src + flush transcript debounce(防数据丢失)+ 移除 timer
 */

import type { NodeViewConstructor } from 'prosemirror-view';
import type { Node as PMNode } from 'prosemirror-model';
import { mediaPutBase64, mediaDownload } from '@capabilities/media-storage';
import { parseSubtitleCuesFromText, type SubtitleCue } from './subtitles';

const TRANSCRIPT_DEBOUNCE_MS = 500;

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

  // L5-B3.19.1:字幕 cues 缓存(NodeView 闭包,direct + youtube 共用)
  // B3.19.2 CC 浮层会消费 — 本段只保数据流路径(parse 后存,无渲染消费方,
  // 故此处尚无读取者;eslint disable 是 B3.19.2 之前的过渡)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  let cuesCache: SubtitleCue[] = [];

  // L5-B3.19.1:transcript textarea debounce 计时器(避免每字符 dispatch)
  // destroy 时 flush + clear,避免数据丢失
  let transcriptDebounceTimer: number | null = null;
  let pendingTranscript: string | null = null;

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

  /** 重算 cues(transcript 变化或 paint 时调)*/
  function recomputeCues(): void {
    cuesCache = parseSubtitleCuesFromText((node.attrs.transcript as string) || '');
  }

  /** flush pending debounce(切笔记 / destroy 前调,避免数据丢失)*/
  function flushTranscript(): void {
    if (transcriptDebounceTimer != null) {
      window.clearTimeout(transcriptDebounceTimer);
      transcriptDebounceTimer = null;
    }
    if (pendingTranscript != null) {
      const text = pendingTranscript;
      pendingTranscript = null;
      // dispatch attr 写入(view 未销毁时)
      if (!view.isDestroyed) {
        updateAttrs({ transcript: text });
      }
    }
  }

  /**
   * 公共辅助:在 playerWrap 末尾追加折叠 transcript 区(direct + youtube 共用,
   * Q3=A 一致行为)
   *
   * 结构:
   *   <div .krig-video-block__transcript>
   *     <button .krig-video-block__transcript-toggle>Transcript [Show ▾]</button>
   *     <textarea .krig-video-block__transcript-area> (default 折叠)
   *   </div>
   *
   * default 折叠状态**不持久化**(每次开都默认折叠 — 避免每个 video block 大块字幕区铺屏)
   */
  function appendTranscriptArea(n: PMNode): void {
    const wrap = document.createElement('div');
    wrap.className = 'krig-video-block__transcript';

    const toggleBtn = document.createElement('button');
    toggleBtn.type = 'button';
    toggleBtn.className = 'krig-video-block__transcript-toggle';
    const initialText = (n.attrs.transcript as string) || '';
    const labelHidden = initialText
      ? `Transcript (${initialText.split('\n').filter((l) => l.trim()).length} lines) [Show ▾]`
      : 'Transcript [Show ▾]';
    const labelShown = initialText
      ? `Transcript (${initialText.split('\n').filter((l) => l.trim()).length} lines) [Hide ▴]`
      : 'Transcript [Hide ▴]';
    toggleBtn.textContent = labelHidden;
    wrap.appendChild(toggleBtn);

    const textarea = document.createElement('textarea');
    textarea.className = 'krig-video-block__transcript-area';
    textarea.placeholder = '[MM:SS] text\n[00:05] Subtitle line\n...';
    textarea.value = initialText;
    textarea.style.display = 'none'; // default 折叠
    wrap.appendChild(textarea);

    let expanded = false;
    toggleBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      expanded = !expanded;
      textarea.style.display = expanded ? 'block' : 'none';
      toggleBtn.textContent = expanded ? labelShown : labelHidden;
      if (expanded) {
        // 自动 focus 让用户立即输入
        setTimeout(() => textarea.focus(), 0);
      }
    });

    // textarea 输入 → debounce 500ms 写 attrs
    textarea.addEventListener('input', () => {
      const text = textarea.value;
      pendingTranscript = text;
      if (transcriptDebounceTimer != null) {
        window.clearTimeout(transcriptDebounceTimer);
      }
      transcriptDebounceTimer = window.setTimeout(() => {
        transcriptDebounceTimer = null;
        if (pendingTranscript != null && !view.isDestroyed) {
          const t = pendingTranscript;
          pendingTranscript = null;
          updateAttrs({ transcript: t });
          // 不直接 recomputeCues — update() 收到 attr 变化会触发 paint → recomputeCues
        }
      }, TRANSCRIPT_DEBOUNCE_MS);
    });

    playerWrap.appendChild(wrap);
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

    // L5-B3.19.1:youtube 模式也支持 transcript 编辑(Q3=A)
    appendTranscriptArea(n);
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

    // L5-B3.19.1:direct 模式也支持 transcript 编辑(Q3=A)
    appendTranscriptArea(n);
  }

  function paint(n: PMNode): void {
    if (!n.attrs.src) {
      buildPlaceholder();
      return;
    }
    const embedType = (n.attrs.embedType as EmbedType | null) ?? detectEmbedType(n.attrs.src as string);
    if (embedType === 'youtube') buildYouTubeEmbed(n);
    else buildDirectVideo(n);
    // L5-B3.19.1:paint 完后重算 cues 缓存(buildXxx 内调过 appendTranscriptArea)
    recomputeCues();
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
      const oldTranscript = node.attrs.transcript;
      node = updated;
      // src / embedType 变 → 整体重渲;transcript 变 → 也整体重渲(简化:重建 transcript 区
      // + 重算 cues;粒度优化留 Phase D);仅 title 变 → 局部刷新
      if (oldSrc !== updated.attrs.src || oldEmbed !== updated.attrs.embedType) {
        paint(updated);
      } else if (oldTranscript !== updated.attrs.transcript) {
        // textarea 输入触发的 attr 变化:debounce 写回时,textarea 已含最新值,
        // 无需 dispatch 时本地 sync(避免 cursor jump)— 但 paint 会重建 textarea
        // 失去 focus 和光标位置。妥协:本段简单 paint;Phase D 优化为局部 cues 重算
        // 不重建 textarea。
        // 实际行为:debounce 触发 dispatch → update → 这里 paint → textarea 重建,
        // 因 textarea 默认折叠,用户当前若在编辑会看到光标跳。**短期可接受**(用户编辑时
        // textarea 是展开状态,debounce 落下后 textarea 重建仍展开?— 不,折叠状态不持久化,
        // 重建后回折叠)。
        // → 改方案:transcript 变化只重算 cues 缓存,不重 paint(textarea 由用户自己输入
        // 已经是最新)。
        recomputeCues();
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
        'video, iframe, .krig-video-block__placeholder, .krig-video-block__download-btn, ' +
          '.krig-video-block__transcript, .krig-video-block__transcript-toggle, ' +
          '.krig-video-block__transcript-area',
      )) {
        return true;
      }
      return false;
    },
    destroy() {
      // L5-B3.19.1:flush pending debounce(避免数据丢失,风险 6.3 预案)
      flushTranscript();
      disposeVideo();
    },
  };
};
