/**
 * videoBlock NodeView — 协调中心(L5-B3.16 → L5-B3.19.a 重写)
 *
 * 二态:
 * - placeholder(无 src):🎞 + Upload + URL 输入(沿用 B3.16,Qa-2=A 不动)
 * - tab framework(有 src):tab-bar + (play / data / transcript) panels + actions(CC / ⛶)
 *                          + subtitle-overlay(CC 浮层)+ time-tracker(单源 300ms)
 *
 * 拆分:
 * - 三态切换 / Tab 切换 / 持久化协调 → 本文件
 * - 渲染细节 / 子模块行为 → tabs/* actions/* components/* helpers/*
 *
 * destroy():tracker / cc / fullscreen / 各 panel 全部 destroy 防内存泄漏。
 */

import type { NodeViewConstructor } from 'prosemirror-view';
import type { Node as PMNode } from 'prosemirror-model';
import { mediaPutBase64 } from '@capabilities/media-storage';
import { detectEmbedType, type EmbedType } from './helpers/embed-detection';
import {
  parseSubtitleCuesFromText,
  findActiveCue,
  type SubtitleCue,
} from './helpers/subtitle-parser';
import { createTimeTracker, type TimeTracker } from './helpers/time-tracker';
import { createTabBar, type TabBar } from './tabs/tab-bar';
import { createPlayTab, type PlayTab } from './tabs/play-tab';
import { createDataTab, type DataTab } from './tabs/data-tab';
import { createTranscriptTab, type TranscriptTab } from './tabs/transcript-tab';
import { createSubtitleOverlay, type SubtitleOverlay } from './components/subtitle-overlay';
import { createCCButton, type CCButton, type CCState } from './actions/cc-button';
import { createFullscreenButton, type FullscreenButton } from './actions/fullscreen-button';

const TRANSCRIPT_WRITE_THROTTLE_MS = 500; // Qa-6

interface FrameworkRefs {
  tabBar: TabBar;
  playTab: PlayTab;
  dataTab: DataTab;
  transcriptTab: TranscriptTab;
  overlay: SubtitleOverlay;
  ccBtn: CCButton;
  fsBtn: FullscreenButton;
  tracker: TimeTracker | null;
  /** 内存派生的 cues(P1 修正:不持久化)*/
  cues: SubtitleCue[];
  /** transcriptText 节流定时器 */
  writeTimer: number | null;
  /** unsubscribe 钩子 */
  unsubs: Array<() => void>;
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

  let framework: FrameworkRefs | null = null;

  // ─── helpers ──────────────────────────────────────────

  function updateAttrs(patch: Record<string, unknown>): void {
    const pos = typeof getPos === 'function' ? getPos() : undefined;
    if (pos == null) return;
    let tr = view.state.tr;
    for (const [key, value] of Object.entries(patch)) {
      tr = tr.setNodeAttribute(pos, key, value);
    }
    tr.setMeta('addToHistory', false); // UI state 不进 undo 栈
    view.dispatch(tr);
  }

  function destroyFramework(): void {
    if (!framework) return;
    framework.unsubs.forEach((u) => u());
    if (framework.writeTimer != null) window.clearTimeout(framework.writeTimer);
    framework.tracker?.destroy();
    framework.ccBtn.destroy();
    framework.fsBtn.destroy();
    framework.overlay.destroy();
    framework.transcriptTab.destroy();
    framework.dataTab.destroy();
    framework.playTab.destroy();
    framework.tabBar.destroy();
    framework = null;
  }

  // ─── placeholder(无 src)──────────────────────────────

  function buildPlaceholder(): void {
    destroyFramework();
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
              embedType: 'direct' as EmbedType,
              title: file.name.replace(/\.[^.]+$/, ''),
              mimeType: file.type || null,
            });
          } else {
            console.warn('[videoBlock] mediaPutBase64 failed:', r.error);
            updateAttrs({
              src: dataUrl,
              embedType: 'direct' as EmbedType,
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
    urlInput.className = 'krig-video-block__placeholder-url';
    urlInput.placeholder = 'mp4 URL or YouTube link...';
    urlInput.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const url = urlInput.value.trim();
      if (!url) return;
      const embedType = detectEmbedType(url);
      updateAttrs({ src: url, embedType });
    });
    actions.appendChild(urlInput);

    ph.appendChild(actions);
    playerWrap.appendChild(ph);
  }

  // ─── framework(有 src)────────────────────────────────

  function buildFramework(n: PMNode): void {
    destroyFramework();
    playerWrap.innerHTML = '';

    const initialActiveTab = (n.attrs.activeTab as string) || 'play';
    const initialTranscript = n.attrs.transcriptText as string | null;

    // Tab bar
    const tabBar = createTabBar(initialActiveTab, [
      { id: 'play', label: 'Video' },
      { id: 'data', label: 'Meta' },
      { id: 'transcript', label: 'EN' },
    ]);
    playerWrap.appendChild(tabBar.el);

    // Panels
    const playTab = createPlayTab(n);
    const dataTab = createDataTab(n);
    const transcriptTab = createTranscriptTab(initialTranscript);
    playerWrap.appendChild(playTab.el);
    playerWrap.appendChild(dataTab.el);
    playerWrap.appendChild(transcriptTab.el);

    // Subtitle overlay 挂在 play-tab.overlayMount
    const overlay = createSubtitleOverlay();
    playTab.overlayMount.appendChild(overlay.el);

    // Action buttons(actionBar 由 tabBar 暴露)
    const ccBtn = createCCButton();
    const fsBtn = createFullscreenButton(() => playTab.el);
    tabBar.actionBarEl.appendChild(ccBtn.el);
    tabBar.actionBarEl.appendChild(fsBtn.el);

    // Time tracker(从 player source 创建)
    const playerSource = playTab.getPlayerSource();
    const tracker = playerSource ? createTimeTracker(playerSource) : null;

    // 内存派生 cues(P1)
    const cues = parseSubtitleCuesFromText(initialTranscript || '');
    let ccState: CCState = { enabled: false, lang: 'transcript' };

    framework = {
      tabBar,
      playTab,
      dataTab,
      transcriptTab,
      overlay,
      ccBtn,
      fsBtn,
      tracker,
      cues,
      writeTimer: null,
      unsubs: [],
    };

    // ── 切 panel 显隐(初始 + 订阅 tabBar)──
    const showPanel = (id: string) => {
      playTab.el.style.display = id === 'play' ? '' : 'none';
      dataTab.el.style.display = id === 'data' ? '' : 'none';
      transcriptTab.el.style.display = id === 'transcript' ? '' : 'none';
    };
    showPanel(initialActiveTab);
    framework.unsubs.push(
      tabBar.onChange((newId) => {
        showPanel(newId);
        if (newId !== (node.attrs.activeTab as string)) {
          updateAttrs({ activeTab: newId });
        }
      }),
    );

    // ── CC 状态变化:更新 overlay + 启停 time 订阅 ──
    let timeUnsub: (() => void) | null = null;
    const refreshTimeSubscription = () => {
      if (timeUnsub) {
        timeUnsub();
        timeUnsub = null;
      }
      if (!ccState.enabled || !framework?.tracker) {
        framework?.overlay.setActiveCue(null);
        return;
      }
      const tracker = framework.tracker;
      const f = framework;
      timeUnsub = tracker.onTimeUpdate((t) => {
        const cue = findActiveCue(f.cues, t);
        f.overlay.setActiveCue(cue);
      });
    };
    framework.unsubs.push(
      ccBtn.onStateChange((s) => {
        ccState = s;
        refreshTimeSubscription();
      }),
    );
    // unsub 时连带把 timeUnsub 释放
    framework.unsubs.push(() => {
      if (timeUnsub) {
        timeUnsub();
        timeUnsub = null;
      }
    });

    // ── transcriptTab textarea 输入:节流写 attrs + 内存重 parse ──
    framework.unsubs.push(
      transcriptTab.onInput((text) => {
        if (!framework) return;
        // 内存 cues 立即重 parse(给当前订阅者用,无延迟)
        framework.cues = parseSubtitleCuesFromText(text);
        // attrs 节流写
        if (framework.writeTimer != null) window.clearTimeout(framework.writeTimer);
        framework.writeTimer = window.setTimeout(() => {
          if (view.isDestroyed) return;
          updateAttrs({ transcriptText: text || null });
          if (framework) framework.writeTimer = null;
        }, TRANSCRIPT_WRITE_THROTTLE_MS);
      }),
    );

    // ── dataTab title 编辑 ──
    framework.unsubs.push(
      dataTab.onTitleChange((title) => {
        if (title !== (node.attrs.title as string)) {
          updateAttrs({ title: title || 'Video' });
        }
      }),
    );
  }

  // ─── paint(根据 attrs 决定形态)──────────────────────

  function paint(n: PMNode): void {
    if (!n.attrs.src) {
      buildPlaceholder();
      return;
    }
    buildFramework(n);
  }

  paint(node);

  // ─── PM NodeView 接口 ─────────────────────────────────

  return {
    dom,
    contentDOM: captionDOM,

    update(updated) {
      if (updated.type.name !== 'videoBlock') return false;
      const oldSrc = node.attrs.src;
      const oldEmbed = node.attrs.embedType;
      const oldActiveTab = node.attrs.activeTab;
      const oldTranscript = node.attrs.transcriptText;
      const oldTitle = node.attrs.title;
      node = updated;

      // src / embedType 变 → 整体重渲(framework / placeholder 切换)
      if (oldSrc !== updated.attrs.src || oldEmbed !== updated.attrs.embedType) {
        paint(updated);
        return true;
      }

      // 仅 framework 内细粒度变化
      if (!framework) return true;

      // activeTab 变(外部驱动,如撤销)→ 切 panel
      if (oldActiveTab !== updated.attrs.activeTab) {
        framework.tabBar.setActive((updated.attrs.activeTab as string) || 'play');
      }

      // transcriptText 变(外部驱动,撤销 / 协作)→ 同步 textarea + 重 parse cues
      if (oldTranscript !== updated.attrs.transcriptText) {
        const text = (updated.attrs.transcriptText as string | null) || '';
        framework.transcriptTab.setText(text);
        framework.cues = parseSubtitleCuesFromText(text);
      }

      // title 变 → 同步 dataTab + play-tab title 元素(若有)
      if (oldTitle !== updated.attrs.title) {
        const titleEl = framework.playTab.el.querySelector('.krig-video-block__title');
        if (titleEl) titleEl.textContent = (updated.attrs.title as string) || 'Video';
      }

      return true;
    },

    stopEvent(event) {
      const target = event.target as HTMLElement | null;
      if (
        target?.closest(
          'video, iframe, button, input, textarea, .krig-video-block__placeholder, .krig-video-block__dropdown',
        )
      ) {
        return true;
      }
      return false;
    },

    destroy() {
      destroyFramework();
    },
  };
};
