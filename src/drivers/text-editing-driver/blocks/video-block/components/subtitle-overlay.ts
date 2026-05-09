/**
 * subtitle-overlay — CC 浮层 DOM(L5-B3.19.a)
 *
 * 渲染当前激活的 cue 文本(由 node-view 订阅 time-tracker.onTimeUpdate +
 * cc-button.onStateChange,组合后调 setActiveCue)。
 *
 * 挂在 play-tab.overlayMount 内。
 */

import type { SubtitleCue } from '../helpers/subtitle-parser';

export interface SubtitleOverlay {
  el: HTMLElement;
  /** 渲染当前 cue(null = 隐藏)*/
  setActiveCue(cue: SubtitleCue | null): void;
  destroy(): void;
}

export function createSubtitleOverlay(): SubtitleOverlay {
  const el = document.createElement('div');
  el.className = 'krig-video-block__subtitle-overlay';
  el.style.display = 'none';

  const textEl = document.createElement('span');
  textEl.className = 'krig-video-block__subtitle-text';
  el.appendChild(textEl);

  let lastText = '';

  return {
    el,
    setActiveCue(cue) {
      if (cue == null) {
        if (el.style.display !== 'none') el.style.display = 'none';
        return;
      }
      if (cue.text !== lastText) {
        textEl.textContent = cue.text;
        lastText = cue.text;
      }
      if (el.style.display === 'none') el.style.display = '';
    },
    destroy() {
      el.remove();
    },
  };
}
