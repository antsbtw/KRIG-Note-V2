/**
 * progress-bar — 下载进度条(L5-B3.19.e)
 *
 * 简单 DOM:bar 容器 + fill width%。挂在 play-tab 顶部 absolute(Qe-1=A 对齐 V1)。
 */

export interface ProgressBar {
  el: HTMLElement;
  setVisible(v: boolean): void;
  setPercent(p: number): void;
  destroy(): void;
}

export function createProgressBar(): ProgressBar {
  const el = document.createElement('div');
  el.className = 'krig-video-block__progress';
  el.style.display = 'none';

  const fill = document.createElement('div');
  fill.className = 'krig-video-block__progress-fill';
  fill.style.width = '0%';
  el.appendChild(fill);

  return {
    el,
    setVisible(v) {
      el.style.display = v ? '' : 'none';
    },
    setPercent(p) {
      fill.style.width = `${Math.min(100, Math.max(0, p))}%`;
    },
    destroy() {
      el.remove();
    },
  };
}
