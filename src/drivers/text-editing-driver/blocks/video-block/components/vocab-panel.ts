/**
 * vocab-panel — 视频内 Vocab Timeline 浮层(L5-B3.19.d)
 *
 * 行为(对齐 V1):
 * - 挂在 play-tab.overlayMount(左上 / 右下角依靠 CSS),不阻挡视频主区
 * - show() 时:取 vocabList → 订阅 onVocabChanged → 订阅 time-tracker.onTimeUpdate
 *   → buildTimeline → render 当前 window
 * - 时间推进:300ms 轮询 → getVocabWindow → 仅当 window 内容变化时 re-render(Qd-5)
 * - vocab 变化(用户加 / 删词):rebuild timeline 立即刷新(Qd-3 仅 show 期间订阅)
 * - rebuild():外部触发(transcript cues 变化时 node-view 调用)
 *
 * **特例旁路**(总设计 § 1.1):driver 层直 import @capabilities/learning,
 * onVocabChanged 订阅严格限于本组件;不在 view 层 / 顶层模块级出现,
 * 跟 B3.20b view-integration 路径职责分离(B3.20b 给全 PM decoration,本段给单 NodeView 局部 panel)。
 */

import { vocabList, onVocabChanged } from '@capabilities/learning';
import type { TimeTracker } from '../helpers/time-tracker';
import type { SubtitleCue } from '../helpers/subtitle-parser';
import {
  buildVocabTimeline,
  getVocabWindow,
  type VocabTimeEntry,
} from '../helpers/vocab-timeline';

const WINDOW_SIZE = 5; // Qd-2=A 对齐 V1

export interface VocabPanelDeps {
  /** 取当前 transcript cues(由 node-view 提供 closure;Qd-1=A 总是 transcript)*/
  getCues: () => SubtitleCue[];
  /** time-tracker(可能 null,无 src 时)*/
  getTracker: () => TimeTracker | null;
}

export interface VocabPanel {
  /** 浮层 DOM,挂到 play-tab.overlayMount */
  el: HTMLElement;
  show(): void;
  hide(): void;
  /** 主动 rebuild timeline(transcript cues 变化时)*/
  rebuild(): void;
  isVisible(): boolean;
  destroy(): void;
}

export function createVocabPanel(deps: VocabPanelDeps): VocabPanel {
  const el = document.createElement('div');
  el.className = 'krig-video-block__vocab-panel';
  el.style.display = 'none';
  // pointer-events: auto 让用户可以点 entry(可扩展加发音等;本段先不绑事件)
  el.style.pointerEvents = 'auto';

  let timeline: VocabTimeEntry[] = [];
  let currentVocab: Array<{ word: string; definition: string }> = [];
  let visible = false;
  let timeUnsub: (() => void) | null = null;
  let vocabChangedUnsub: (() => void) | null = null;
  let lastWindowKey = '';

  function rebuildTimeline(): void {
    timeline = buildVocabTimeline(deps.getCues(), currentVocab);
    lastWindowKey = ''; // 强制下一次 render
    renderAtCurrentTime();
  }

  function renderAtCurrentTime(): void {
    if (!visible) return;
    const tracker = deps.getTracker();
    const t = tracker?.getCurrentTime() ?? 0;
    renderWindow(t);
  }

  function renderWindow(currentTime: number): void {
    if (timeline.length === 0) {
      if (lastWindowKey === '__empty__') return;
      lastWindowKey = '__empty__';
      el.innerHTML =
        '<div class="krig-video-block__vocab-panel-empty">没有匹配的生词(在生词本中加词,或在 EN 字幕里有该词时显示)</div>';
      return;
    }

    const win = getVocabWindow(timeline, currentTime, WINDOW_SIZE);
    // 优化:仅当 window 内容真变(entries id list + currentIndex)时 re-render
    const key = `${win.entries.map((e) => `${e.word}@${e.time}`).join('|')}::${win.currentIndex}`;
    if (key === lastWindowKey) return;
    lastWindowKey = key;

    el.innerHTML = win.entries
      .map(
        (e, i) =>
          `<div class="krig-video-block__vocab-item${
            i === win.currentIndex ? ' krig-video-block__vocab-item--current' : ''
          }">` +
          `<div class="krig-video-block__vocab-word">${escapeHtml(e.word)}</div>` +
          `<div class="krig-video-block__vocab-def">${escapeHtml(e.definition)}</div>` +
          `</div>`,
      )
      .join('');
  }

  return {
    el,
    show() {
      if (visible) return;
      visible = true;
      el.style.display = '';

      // 取一次 vocab list
      void vocabList().then((list) => {
        if (!visible) return; // 可能 hide 了
        currentVocab = list.map((entry) => ({
          word: entry.word,
          definition: entry.definition,
        }));
        rebuildTimeline();
      });

      // 订阅 vocab 变化(特例旁路 — 本组件内严格订阅)
      vocabChangedUnsub = onVocabChanged((list) => {
        currentVocab = list.map((entry) => ({
          word: entry.word,
          definition: entry.definition,
        }));
        rebuildTimeline();
      });

      // 订阅 time-tracker(仅可见期间)
      const tracker = deps.getTracker();
      if (tracker) {
        timeUnsub = tracker.onTimeUpdate((t) => {
          renderWindow(t);
        });
      }
    },

    hide() {
      if (!visible) return;
      visible = false;
      el.style.display = 'none';
      if (timeUnsub) {
        timeUnsub();
        timeUnsub = null;
      }
      if (vocabChangedUnsub) {
        vocabChangedUnsub();
        vocabChangedUnsub = null;
      }
    },

    rebuild() {
      // 外部触发:transcript cues 变化 — 仅当可见时才需要重 render
      if (!visible) return;
      rebuildTimeline();
    },

    isVisible: () => visible,

    destroy() {
      if (timeUnsub) {
        timeUnsub();
        timeUnsub = null;
      }
      if (vocabChangedUnsub) {
        vocabChangedUnsub();
        vocabChangedUnsub = null;
      }
      el.remove();
    },
  };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
