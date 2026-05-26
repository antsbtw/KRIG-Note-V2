/**
 * Vocab Tooltip — ebook 生词浮窗(PDF / EPUB 共享单例)
 *
 * 单例规则:全 app 共一个 tooltipEl 挂在 document.body,fixed 定位,
 * 任意时刻最多一个 vocab hover 状态。PDF 与 EPUB 都通过 showTooltip(word, defs, anchor)
 * 触发,internal scheduleHide / hideNow 共享。
 *
 * 抽离自 src/views/ebook/pdf-vocab-highlight/index.ts(2026-05-26 加 EPUB
 * 生词高亮时拆出);为兼顾 EPUB 在 iframe 内的 hover 场景,anchor 必须是
 * **viewport coordinates**(fixed 定位坐标系)— iframe 内调用方需先把
 * iframe 内 rect 加上 iframeRect.left/top 后再传。
 *
 * 样式:沿用 .krig-pdf-vocab-tooltip class 名(已合入 main 多版,改名风险
 * 大于收益);新增 EPUB 调用方一并复用此 class,只暴露行为不暴露 DOM。
 */

import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import type { LearningApi } from '@capabilities/learning/types';

const TOOLTIP_CLASS = 'krig-pdf-vocab-tooltip';

let tooltipEl: HTMLDivElement | null = null;
let hideTimer: number | null = null;
let ttsAudio: HTMLAudioElement | null = null;
let ttsObjectUrl: string | null = null;

function ensureTooltipEl(): HTMLDivElement {
  if (tooltipEl) return tooltipEl;
  tooltipEl = document.createElement('div');
  tooltipEl.className = TOOLTIP_CLASS;
  tooltipEl.style.display = 'none';
  document.body.appendChild(tooltipEl);
  tooltipEl.addEventListener('mouseenter', () => {
    if (hideTimer) {
      window.clearTimeout(hideTimer);
      hideTimer = null;
    }
  });
  tooltipEl.addEventListener('mouseleave', () => scheduleHide());
  return tooltipEl;
}

export interface VocabTooltipPayload {
  word: string;
  definition: string;
  phonetic?: string;
}

/**
 * 显示 tooltip。
 * @param payload word + definition + (可选)phonetic
 * @param anchor viewport coordinates(fixed 坐标系)— iframe 内调用方需自行加 iframeRect 偏移
 */
export function showTooltip(payload: VocabTooltipPayload, anchor: DOMRect): void {
  const { word, definition, phonetic } = payload;
  if (!definition) return;
  const el = ensureTooltipEl();

  if (hideTimer) {
    window.clearTimeout(hideTimer);
    hideTimer = null;
  }

  const shortDef =
    definition.length > 200 ? definition.slice(0, 200) + '...' : definition;
  el.innerHTML = `
    <div class="${TOOLTIP_CLASS}__header">
      <span class="${TOOLTIP_CLASS}__word">${escapeHtml(word)}</span>
      ${phonetic ? `<span class="${TOOLTIP_CLASS}__phonetic">${escapeHtml(phonetic)}</span>` : ''}
      <button class="${TOOLTIP_CLASS}__tts" title="发音">&#x1f50a;</button>
    </div>
    <div class="${TOOLTIP_CLASS}__def">${escapeHtml(shortDef)}</div>
  `;

  const ttsBtn = el.querySelector<HTMLButtonElement>(`.${TOOLTIP_CLASS}__tts`);
  if (ttsBtn) {
    ttsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      void playTTS(word);
    });
  }

  el.style.display = 'block';
  el.style.left = `${anchor.left}px`;
  el.style.top = `${anchor.bottom + 6}px`;

  // 边界检测:右出 / 底出时翻转
  requestAnimationFrame(() => {
    if (!tooltipEl) return;
    const tr = tooltipEl.getBoundingClientRect();
    if (tr.right > window.innerWidth - 8) {
      tooltipEl.style.left = `${window.innerWidth - tr.width - 8}px`;
    }
    if (tr.bottom > window.innerHeight - 8) {
      tooltipEl.style.top = `${anchor.top - tr.height - 6}px`;
    }
  });
}

export function scheduleHide(): void {
  if (hideTimer) window.clearTimeout(hideTimer);
  hideTimer = window.setTimeout(() => {
    hideTooltipNow();
  }, 200);
}

export function hideTooltipNow(): void {
  if (hideTimer) {
    window.clearTimeout(hideTimer);
    hideTimer = null;
  }
  if (tooltipEl) tooltipEl.style.display = 'none';
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function playTTS(word: string): Promise<void> {
  if (ttsAudio) {
    ttsAudio.pause();
    ttsAudio = null;
  }
  if (ttsObjectUrl) {
    URL.revokeObjectURL(ttsObjectUrl);
    ttsObjectUrl = null;
  }
  const learning = requireCapabilityApi<LearningApi>('learning');
  const buf = await learning.tts(word, 'en');
  if (!buf) return;
  const blob = new Blob([buf], { type: 'audio/mpeg' });
  ttsObjectUrl = URL.createObjectURL(blob);
  ttsAudio = new Audio(ttsObjectUrl);
  ttsAudio.play().catch(() => {});
}
