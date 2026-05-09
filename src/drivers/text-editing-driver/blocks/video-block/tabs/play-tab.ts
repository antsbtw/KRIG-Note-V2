/**
 * play-tab — videoBlock 'play' Tab(L5-B3.19.a)
 *
 * 职责:渲染播放器(YouTube iframe / <video> / vimeo / generic 占位)+ 暴露 player ref
 * 给 time-tracker 工厂。subtitle overlay / vocab panel 等组件挂在 overlayMount。
 *
 * 总设计 Q4=A:vimeo / generic 显"暂不支持(Phase D)"占位 + 重新输 URL 提示。
 */

import type { Node as PMNode } from 'prosemirror-model';
import type { EmbedType } from '../helpers/embed-detection';
import { extractYouTubeId, toYouTubeEmbedUrl } from '../helpers/embed-detection';

export type PlayerSource =
  | { videoEl: HTMLVideoElement }
  | { iframe: HTMLIFrameElement }
  | null;

export interface PlayTab {
  el: HTMLElement;
  /** time-tracker 工厂用;vimeo/generic/无效 src 返 null */
  getPlayerSource(): PlayerSource;
  /** subtitle overlay / vocab panel 等浮层挂这里 */
  overlayMount: HTMLElement;
  destroy(): void;
}

export function createPlayTab(node: PMNode): PlayTab {
  const el = document.createElement('div');
  el.className = 'krig-video-block__play-tab';
  el.contentEditable = 'false';

  const src = node.attrs.src as string | null;
  const embedType = node.attrs.embedType as EmbedType | null;
  const title = node.attrs.title as string | null;

  // ── title(可选)──
  if (title && title !== 'Video') {
    const titleEl = document.createElement('div');
    titleEl.className = 'krig-video-block__title';
    titleEl.textContent = title;
    el.appendChild(titleEl);
  }

  let source: PlayerSource = null;

  if (src) {
    if (embedType === 'youtube') {
      const id = extractYouTubeId(src);
      if (id) {
        const iframe = document.createElement('iframe');
        iframe.src = toYouTubeEmbedUrl(id);
        iframe.setAttribute('allowfullscreen', '');
        iframe.setAttribute(
          'allow',
          'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture',
        );
        iframe.className = 'krig-video-block__iframe';
        el.appendChild(iframe);
        source = { iframe };
      } else {
        // YouTube URL 但解析不出 ID — 显占位
        appendUnsupportedPlaceholder(el, 'YouTube URL 无法识别', src);
      }
    } else if (embedType === 'direct') {
      const videoEl = document.createElement('video');
      videoEl.src = src;
      videoEl.controls = true;
      videoEl.preload = 'metadata';
      videoEl.className = 'krig-video-block__video';
      el.appendChild(videoEl);
      source = { videoEl };
    } else if (embedType === 'vimeo') {
      appendUnsupportedPlaceholder(el, 'Vimeo 暂不支持(Phase D)', src);
    } else {
      // generic / 未知
      appendUnsupportedPlaceholder(el, '暂不支持的视频源(Phase D)', src);
    }
  }

  // overlay 挂载点(在 player 之上)
  const overlayMount = document.createElement('div');
  overlayMount.className = 'krig-video-block__overlay-mount';
  el.appendChild(overlayMount);

  return {
    el,
    getPlayerSource: () => source,
    overlayMount,
    destroy() {
      // <video> 释放(避免后台继续播音)
      if (source && 'videoEl' in source) {
        source.videoEl.pause();
        source.videoEl.src = '';
      }
      el.remove();
    },
  };
}

function appendUnsupportedPlaceholder(parent: HTMLElement, msg: string, src: string): void {
  const wrap = document.createElement('div');
  wrap.className = 'krig-video-block__unsupported';
  const icon = document.createElement('span');
  icon.className = 'krig-video-block__unsupported-icon';
  icon.textContent = '⚠';
  wrap.appendChild(icon);
  const msgEl = document.createElement('div');
  msgEl.className = 'krig-video-block__unsupported-msg';
  msgEl.textContent = msg;
  wrap.appendChild(msgEl);
  const srcEl = document.createElement('div');
  srcEl.className = 'krig-video-block__unsupported-src';
  srcEl.textContent = src;
  wrap.appendChild(srcEl);
  parent.appendChild(wrap);
}
