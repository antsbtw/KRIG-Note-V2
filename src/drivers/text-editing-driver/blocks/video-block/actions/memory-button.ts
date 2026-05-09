/**
 * memory-button — Memory Playback Mode 三按钮组合(L5-B3.19.c)
 *
 * 艾宾浩斯间隔重复(对齐 V1):
 *   序列:[0] → [0,1] → [1,2] → [2,3] → ... → [n-2, n-1]
 *   每 step 取 segments[0] 作起始 → seekTo + play;currentTime 触达
 *   `(lastSeg+1)*segDuration - 0.3s` 时自动 advance(订阅 time-tracker)。
 *
 * UI:wrap div 包 [⏮ + 🧠 + dropdown + ⏭],三按钮挂同 wrap 让 actionBar 排版一致。
 *
 * dropdown 复用 a 段已有 `.krig-video-block__dropdown` 样式(也是 cc-button 用的 dropdown)。
 *
 * 持久化:start 时跳到 attrs.memoryLastStep;stop 时写回当前 stepIndex。
 * active 状态本身不持久化(对齐 V1 — 重启不自动播视频)。
 */

import type { TimeTracker } from '../helpers/time-tracker';

interface MemoryStep {
  type: 'play' | 'repeat';
  segments: number[];
}

const SEGMENT_DURATION_OPTIONS = [30, 60, 90, 120];
const BOUNDARY_BUFFER_SEC = 0.3; // Qc-2=A:V1 实测容错值

function* memoryPlaybackSequence(totalSegments: number): Generator<MemoryStep> {
  if (totalSegments <= 0) return;
  yield { type: 'play', segments: [0] };
  for (let i = 1; i < totalSegments; i++) {
    yield { type: 'repeat', segments: [i - 1, i] };
  }
}

export interface MemoryControl {
  /** 整体挂点 — 包含 ⏮ + 🧠 + dropdown + ⏭ 一组 wrap div(挂到 actionBar)*/
  el: HTMLElement;
  isActive(): boolean;
  /** 主动停止(node-view 在 src 切换 / destroy 时调)*/
  stop(): void;
  destroy(): void;
}

export interface MemoryButtonDeps {
  getSegmentDuration: () => number;
  getTracker: () => TimeTracker | null;
  getLastStep: () => number;
  onUpdateAttrs: (patch: { segmentDuration?: number; memoryLastStep?: number }) => void;
}

export function createMemoryButton(deps: MemoryButtonDeps): MemoryControl {
  const wrap = document.createElement('div');
  wrap.className = 'krig-video-block__memory-wrap';
  wrap.style.position = 'relative';
  wrap.style.display = 'flex';
  wrap.style.alignItems = 'center';
  wrap.style.gap = '2px';

  // ⏮
  const prevBtn = document.createElement('button');
  prevBtn.type = 'button';
  prevBtn.className = 'krig-video-block__action-btn';
  prevBtn.title = 'Previous segment';
  prevBtn.textContent = '⏮';
  prevBtn.disabled = true;
  wrap.appendChild(prevBtn);

  // 🧠 + dropdown
  const memBtn = document.createElement('button');
  memBtn.type = 'button';
  memBtn.className = 'krig-video-block__action-btn';
  memBtn.title = 'Memory playback mode';
  memBtn.textContent = '🧠';
  wrap.appendChild(memBtn);

  const dropdown = document.createElement('div');
  dropdown.className = 'krig-video-block__dropdown';
  dropdown.style.display = 'none';
  for (const dur of SEGMENT_DURATION_OPTIONS) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'krig-video-block__dropdown-item';
    item.dataset.dur = String(dur);
    item.textContent = `${dur}s`;
    item.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      paintDropdownActive(dur);
      dropdown.style.display = 'none';
      deps.onUpdateAttrs({ segmentDuration: dur });
      // 已激活时切换 segDuration → restart
      if (active) stop();
      start();
    });
    dropdown.appendChild(item);
  }
  wrap.appendChild(dropdown);

  // ⏭
  const skipBtn = document.createElement('button');
  skipBtn.type = 'button';
  skipBtn.className = 'krig-video-block__action-btn';
  skipBtn.title = 'Skip segment';
  skipBtn.textContent = '⏭';
  skipBtn.disabled = true;
  wrap.appendChild(skipBtn);

  // ── state ──
  let active = false;
  let generator: Generator<MemoryStep> | null = null;
  let currentStep: MemoryStep | null = null;
  let stepIndex = 0;
  let timeUnsub: (() => void) | null = null;
  let durationUnsub: (() => void) | null = null;

  function paintDropdownActive(dur: number): void {
    dropdown.querySelectorAll('.krig-video-block__dropdown-item').forEach((el) => {
      el.classList.toggle(
        'krig-video-block__dropdown-item--active',
        (el as HTMLElement).dataset.dur === String(dur),
      );
    });
  }

  function updateLabel(): void {
    if (!active) {
      memBtn.textContent = '🧠';
      return;
    }
    const tracker = deps.getTracker();
    const dur = tracker?.getDuration() ?? 0;
    if (dur <= 0) {
      memBtn.textContent = '🧠 ⏳';
      return;
    }
    const seg = deps.getSegmentDuration();
    const total = Math.ceil(dur / seg) || 1;
    memBtn.textContent = `🧠 ${stepIndex}/${total}`;
  }

  function unsubscribeTime(): void {
    if (timeUnsub) {
      timeUnsub();
      timeUnsub = null;
    }
  }

  function subscribeTime(): void {
    unsubscribeTime();
    const tracker = deps.getTracker();
    if (!tracker) return;
    timeUnsub = tracker.onTimeUpdate((t) => {
      if (!active || !currentStep) return;
      const segDur = deps.getSegmentDuration();
      const lastSeg = currentStep.segments[currentStep.segments.length - 1];
      const boundary = (lastSeg + 1) * segDur;
      if (t >= boundary - BOUNDARY_BUFFER_SEC) {
        advance();
      }
    });
  }

  /** 跑 generator 到指定 stepIndex(不调 advance,只重建状态)*/
  function rebuildToStep(targetStep: number): void {
    const tracker = deps.getTracker();
    const segDur = deps.getSegmentDuration();
    const dur = tracker?.getDuration() ?? 0;
    if (dur <= 0) {
      generator = null;
      currentStep = null;
      stepIndex = 0;
      return;
    }
    const totalSegments = Math.ceil(dur / segDur);
    generator = memoryPlaybackSequence(totalSegments);
    stepIndex = 0;
    currentStep = null;
    for (let i = 0; i < targetStep; i++) {
      const r = generator.next();
      if (r.done) break;
      currentStep = r.value;
      stepIndex = i + 1;
    }
  }

  function applyCurrentStep(): void {
    if (!currentStep) return;
    const tracker = deps.getTracker();
    if (!tracker) return;
    const segDur = deps.getSegmentDuration();
    const startSeg = currentStep.segments[0];
    const seekTime = startSeg * segDur;
    tracker.seekTo(seekTime);
    tracker.play();
    updateLabel();
  }

  function advance(): void {
    if (!generator) return;
    const r = generator.next();
    if (r.done) {
      stop();
      return;
    }
    currentStep = r.value;
    stepIndex++;
    applyCurrentStep();
  }

  function prev(): void {
    if (!active || stepIndex <= 1) return;
    const target = Math.max(1, stepIndex - 1);
    rebuildToStep(target);
    applyCurrentStep();
  }

  function start(): void {
    const tracker = deps.getTracker();
    if (!tracker) return;
    const dur = tracker.getDuration();
    if (dur <= 0) {
      // duration 未就绪(YouTube 异步)→ 等 onDurationReady 再启
      // Qc-4=A:UI 显示 ⏳,订阅 ready 后再 start
      active = true;
      memBtn.textContent = '🧠 ⏳';
      prevBtn.disabled = false;
      skipBtn.disabled = false;
      if (durationUnsub) durationUnsub();
      durationUnsub = tracker.onDurationReady(() => {
        if (!active) return;
        beginAfterDurationKnown();
      });
      return;
    }
    active = true;
    beginAfterDurationKnown();
  }

  function beginAfterDurationKnown(): void {
    const startStep = Math.max(0, deps.getLastStep());
    rebuildToStep(startStep);
    if (!currentStep) {
      // lastStep > total(可能 segDur 改了)→ 从头
      rebuildToStep(0);
    }
    if (!currentStep) {
      // generator 直接 done(totalSegments=0)→ stop
      stop();
      return;
    }
    prevBtn.disabled = false;
    skipBtn.disabled = false;
    applyCurrentStep();
    subscribeTime();
  }

  function stop(): void {
    if (!active) return;
    active = false;
    deps.onUpdateAttrs({ memoryLastStep: stepIndex });
    generator = null;
    currentStep = null;
    unsubscribeTime();
    if (durationUnsub) {
      durationUnsub();
      durationUnsub = null;
    }
    prevBtn.disabled = true;
    skipBtn.disabled = true;
    updateLabel();
  }

  // ── 按钮事件 ──
  memBtn.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (active) {
      stop();
      return;
    }
    // 未激活:显 dropdown 选段长
    paintDropdownActive(deps.getSegmentDuration());
    dropdown.style.display = dropdown.style.display === 'none' ? '' : 'none';
  });

  prevBtn.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (active) prev();
  });

  skipBtn.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (active) advance();
  });

  // 点 dropdown 外部关
  const docMouseDown = (e: MouseEvent) => {
    if (dropdown.style.display === 'none') return;
    const target = e.target as Node;
    if (!wrap.contains(target)) {
      dropdown.style.display = 'none';
    }
  };
  document.addEventListener('mousedown', docMouseDown);

  return {
    el: wrap,
    isActive: () => active,
    stop,
    destroy() {
      stop();
      document.removeEventListener('mousedown', docMouseDown);
      wrap.remove();
    },
  };
}
