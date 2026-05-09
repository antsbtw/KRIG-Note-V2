/**
 * fullscreen-button — ⛶ 全屏播放(L5-B3.19.a)
 *
 * 触发 play-tab 容器的 requestFullscreen(包含 iframe / video + overlay)。
 */

export interface FullscreenButton {
  el: HTMLButtonElement;
  destroy(): void;
}

export function createFullscreenButton(getTargetEl: () => HTMLElement | null): FullscreenButton {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'krig-video-block__action-btn';
  btn.title = 'Fullscreen';
  btn.textContent = '⛶';

  btn.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const target = getTargetEl();
    target?.requestFullscreen?.().catch(() => {
      /* permission / context issue — ignore */
    });
  });

  return {
    el: btn,
    destroy() {
      btn.remove();
    },
  };
}
