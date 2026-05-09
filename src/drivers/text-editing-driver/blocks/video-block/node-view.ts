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
import { createTranscriptButton, type TranscriptButton } from './actions/transcript-button';
import { createTranslateButton, type TranslateButton } from './actions/translate-button';
import { createMemoryButton, type MemoryControl } from './actions/memory-button';
import { createVocabButton, type VocabButton } from './actions/vocab-button';
import { createVocabPanel, type VocabPanel } from './components/vocab-panel';
import { createDownloadButton, type DownloadButton } from './actions/download-button';
import { createProgressBar, type ProgressBar } from './components/progress-bar';

const TRANSCRIPT_WRITE_THROTTLE_MS = 500; // Qa-6

interface TranslationPanelRef {
  /** transcript-tab readonly 模式实例 */
  panel: TranscriptTab;
  /** 该 lang 对应的内存派生 cues(currentText 重 parse 缓存)*/
  cues: SubtitleCue[];
}

interface FrameworkRefs {
  tabBar: TabBar;
  playTab: PlayTab;
  dataTab: DataTab;
  transcriptTab: TranscriptTab;
  overlay: SubtitleOverlay;
  ccBtn: CCButton;
  fsBtn: FullscreenButton;
  transcriptBtn: TranscriptButton;
  translateBtn: TranslateButton;
  memoryBtn: MemoryControl;
  vocabBtn: VocabButton;
  vocabPanel: VocabPanel;
  downloadBtn: DownloadButton;
  progressBar: ProgressBar;
  tracker: TimeTracker | null;
  /** 内存派生的 transcript cues(P1 修正:不持久化)*/
  cues: SubtitleCue[];
  /** 翻译 Tab 实例 + 各自 cues:`Map<langCode, TranslationPanelRef>` */
  translations: Map<string, TranslationPanelRef>;
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
    framework.memoryBtn.destroy(); // 内部 stop() 写回 lastStep,先于 tracker.destroy
    framework.vocabBtn.destroy();
    framework.vocabPanel.destroy(); // 解订阅 + 移除 DOM,先于 tracker.destroy
    framework.downloadBtn.destroy(); // 解 onDownloadProgress 订阅
    framework.progressBar.destroy();
    framework.tracker?.destroy();
    framework.transcriptBtn.destroy();
    framework.translateBtn.destroy();
    framework.ccBtn.destroy();
    framework.fsBtn.destroy();
    framework.overlay.destroy();
    framework.translations.forEach((t) => t.panel.destroy());
    framework.translations.clear();
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
    const initialTranslationsRaw = n.attrs.translationTexts as string | null;
    const initialTranslations: Record<string, string> = initialTranslationsRaw
      ? parseTranslationsJson(initialTranslationsRaw)
      : {};

    // Tab bar(transcript / 翻译 Tab 都通过同一 lang code 标识 — transcript 用 'transcript')
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

    // Time tracker(从 player source 创建,先于 memory-button)
    const playerSource = playTab.getPlayerSource();
    const tracker = playerSource ? createTimeTracker(playerSource) : null;

    // Action buttons(actionBar 由 tabBar 暴露)
    const ccBtn = createCCButton();
    const fsBtn = createFullscreenButton(() => playTab.el);
    const transcriptBtn = createTranscriptButton(
      () => node.attrs.src as string | null,
      (text) => {
        console.log('[node-view onTranscript] start, text length=', text.length, 'framework?', !!framework);
        // 抓到字幕回调:setText 灌入 textarea + 触发 input(自动写 attrs + 重 parse cues)
        transcriptTab.setText(text);
        console.log('[node-view onTranscript] setText done, textarea value len=', transcriptTab.getText().length);
        if (!framework) {
          console.warn('[node-view onTranscript] framework null, abort rest');
          return;
        }
        framework.cues = parseSubtitleCuesFromText(text);
        if (framework.writeTimer != null) window.clearTimeout(framework.writeTimer);
        // 即时写,不节流(用户主动触发的非键入操作)
        updateAttrs({ transcriptText: text || null });
        console.log('[node-view onTranscript] updateAttrs done');
        // 切到 transcript Tab 让用户立即看到
        tabBar.setActive('transcript');
        console.log('[node-view onTranscript] setActive transcript done, current=', tabBar.getActive());
        // vocab-panel 若可见,基于新 cues 重 build timeline
        framework.vocabPanel.rebuild();
        console.log('[node-view onTranscript] complete');
      },
    );
    const translateBtn = createTranslateButton(
      () => transcriptTab.getText(),
      (langCode, translatedText) => {
        // 翻译完成回调:更新 translations map + 创建/更新对应 Tab + 同步 attrs + cc dropdown
        if (!framework) return;
        upsertTranslation(langCode, translatedText);
      },
    );
    const memoryBtn = createMemoryButton({
      getSegmentDuration: () => (node.attrs.segmentDuration as number) || 60,
      getTracker: () => tracker,
      getLastStep: () => (node.attrs.memoryLastStep as number) || 0,
      onUpdateAttrs: (patch) => {
        // updateAttrs 写回 PM doc(addToHistory=false 不进 undo 栈)
        const pos = typeof getPos === 'function' ? getPos() : undefined;
        if (pos == null) return;
        let tr = view.state.tr;
        if (patch.segmentDuration != null) {
          tr = tr.setNodeAttribute(pos, 'segmentDuration', patch.segmentDuration);
        }
        if (patch.memoryLastStep != null) {
          tr = tr.setNodeAttribute(pos, 'memoryLastStep', patch.memoryLastStep);
        }
        tr.setMeta('addToHistory', false);
        view.dispatch(tr);
      },
    });

    // L5-B3.19.d:vocab panel(挂 play-tab.overlayMount)+ vocab-button(挂 actionBar)
    const vocabPanel = createVocabPanel({
      getCues: () => framework?.cues ?? [],
      getTracker: () => tracker,
    });
    playTab.overlayMount.appendChild(vocabPanel.el);
    const vocabBtn = createVocabButton(false, (active) => {
      if (active) vocabPanel.show();
      else vocabPanel.hide();
    });

    // L5-B3.19.e:progress-bar(play-tab 顶部 absolute,Qe-1=A)+ download-button(actionBar)
    const progressBar = createProgressBar();
    playTab.el.insertBefore(progressBar.el, playTab.el.firstChild);
    const downloadBtn = createDownloadButton({
      getSrc: () => node.attrs.src as string | null,
      getLocalFilePath: () => (node.attrs.localFilePath as string | null) || null,
      getTranscriptText: () => (node.attrs.transcriptText as string | null) || null,
      getTranslations: () => {
        const raw = node.attrs.translationTexts as string | null;
        return raw ? parseTranslationsJson(raw) : {};
      },
      onUpdateAttrs: (patch) => {
        const update: Record<string, unknown> = {};
        if (patch.localFilePath !== undefined) update.localFilePath = patch.localFilePath;
        if (patch.transcriptText !== undefined) update.transcriptText = patch.transcriptText;
        if (Object.keys(update).length > 0) updateAttrs(update);
      },
      onProgress: (visible, percent) => {
        progressBar.setVisible(visible);
        progressBar.setPercent(percent);
      },
      onPhaseChange: (phase, percent) => {
        framework?.dataTab.setDownloadStatus({
          phase,
          percent,
          localFilePath: (node.attrs.localFilePath as string | null) || null,
        });
      },
    });

    // ── actionBar 完整顺序对齐 V1(Qe 后):CC | ⏮🧠⏭ | 🌐 | 📝 | ⬇ | 📖 | ⛶ ──
    tabBar.actionBarEl.appendChild(ccBtn.el);
    tabBar.actionBarEl.appendChild(memoryBtn.el);
    tabBar.actionBarEl.appendChild(translateBtn.el);
    tabBar.actionBarEl.appendChild(transcriptBtn.el);
    tabBar.actionBarEl.appendChild(downloadBtn.el);
    tabBar.actionBarEl.appendChild(vocabBtn.el);
    tabBar.actionBarEl.appendChild(fsBtn.el);

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
      transcriptBtn,
      translateBtn,
      memoryBtn,
      vocabBtn,
      vocabPanel,
      downloadBtn,
      progressBar,
      tracker,
      cues,
      translations: new Map(),
      writeTimer: null,
      unsubs: [],
    };

    // ── 创建已有翻译 Tab(从 attrs 恢复)──
    for (const [lang, text] of Object.entries(initialTranslations)) {
      mountTranslationTab(lang, text);
    }
    // 同步 cc dropdown 语言列表
    syncCcLanguages();

    // ── 切 panel 显隐 ──
    const showPanel = (id: string) => {
      playTab.el.style.display = id === 'play' ? '' : 'none';
      dataTab.el.style.display = id === 'data' ? '' : 'none';
      transcriptTab.el.style.display = id === 'transcript' ? '' : 'none';
      // 翻译 Tab 同步
      framework?.translations.forEach((t, lang) => {
        t.panel.el.style.display = id === lang ? '' : 'none';
      });
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

    // ── CC 状态变化:更新 overlay + 启停 time 订阅(读对应 lang 的 cues)──
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
      const lang = ccState.lang;
      timeUnsub = tracker.onTimeUpdate((t) => {
        const activeCues = lang === 'transcript' ? f.cues : f.translations.get(lang)?.cues || [];
        const cue = findActiveCue(activeCues, t);
        f.overlay.setActiveCue(cue);
      });
    };
    framework.unsubs.push(
      ccBtn.onStateChange((s) => {
        ccState = s;
        refreshTimeSubscription();
      }),
    );
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
        framework.cues = parseSubtitleCuesFromText(text);
        // vocab-panel 若可见,基于新 cues 重 build timeline
        framework.vocabPanel.rebuild();
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

  // ─── 翻译 Tab 协调辅助 ──────────────────────────────

  function parseTranslationsJson(raw: string): Record<string, string> {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, string>;
      }
    } catch {
      /* 损坏 JSON 静默丢弃 */
    }
    return {};
  }

  /** 创建一个翻译 Tab(readonly)— Qb-1=A;mount + cues parse */
  function mountTranslationTab(langCode: string, text: string): void {
    if (!framework) return;
    const panel = createTranscriptTab(text);
    // readonly:textarea + import 按钮挂点都不允许编辑(简化:直接禁用 textarea)
    const textarea = panel.el.querySelector('textarea');
    if (textarea instanceof HTMLTextAreaElement) {
      textarea.readOnly = true;
    }
    // 隐藏 toolbarMount(翻译 Tab 不需 import)
    panel.toolbarMount.style.display = 'none';
    playerWrap.appendChild(panel.el);
    panel.el.style.display = 'none';
    framework.tabBar.addTabButton({ id: langCode, label: langCode.toUpperCase() });
    framework.translations.set(langCode, {
      panel,
      cues: parseSubtitleCuesFromText(text),
    });
  }

  /** 翻译完成回调:upsert + 持久化 + cc 同步 + 自动切到该 Tab */
  function upsertTranslation(langCode: string, translatedText: string): void {
    if (!framework) return;
    const existing = framework.translations.get(langCode);
    if (existing) {
      // 已存在 → 更新内容(Qb-5=A 重新翻译并覆盖)
      existing.panel.setText(translatedText);
      existing.cues = parseSubtitleCuesFromText(translatedText);
    } else {
      mountTranslationTab(langCode, translatedText);
    }
    // 持久化:翻译 attr 序列化
    const map: Record<string, string> = {};
    framework.translations.forEach((t, lang) => {
      map[lang] = t.panel.getText();
    });
    updateAttrs({ translationTexts: Object.keys(map).length ? JSON.stringify(map) : null });
    // 同步 cc dropdown
    syncCcLanguages();
    // 切到新创建/更新的 Tab
    framework.tabBar.setActive(langCode);
  }

  /** 把 framework.translations 的 keys 推到 ccBtn.setLanguages */
  function syncCcLanguages(): void {
    if (!framework) return;
    framework.ccBtn.setLanguages(Array.from(framework.translations.keys()));
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
      const oldTranslations = node.attrs.translationTexts;
      const oldLocalFilePath = node.attrs.localFilePath;
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

      // transcriptText 变(外部驱动,撤销 / 协作)→ 同步 textarea + 重 parse cues + vocab-panel rebuild
      if (oldTranscript !== updated.attrs.transcriptText) {
        const text = (updated.attrs.transcriptText as string | null) || '';
        framework.transcriptTab.setText(text);
        framework.cues = parseSubtitleCuesFromText(text);
        framework.vocabPanel.rebuild();
      }

      // translationTexts 变(外部驱动,撤销 / 协作)→ 重建翻译 Tab 集合
      if (oldTranslations !== updated.attrs.translationTexts) {
        const map = updated.attrs.translationTexts
          ? parseTranslationsJson(updated.attrs.translationTexts as string)
          : {};
        // 清掉已有的(整体重建简单可靠;Tab 数量小,代价低)
        framework.translations.forEach((t, lang) => {
          framework!.tabBar.removeTabButton(lang);
          t.panel.destroy();
        });
        framework.translations.clear();
        for (const [lang, text] of Object.entries(map)) {
          mountTranslationTab(lang, text);
        }
        syncCcLanguages();
      }

      // title 变 → 同步 dataTab + play-tab title 元素(若有)
      if (oldTitle !== updated.attrs.title) {
        const titleEl = framework.playTab.el.querySelector('.krig-video-block__title');
        if (titleEl) titleEl.textContent = (updated.attrs.title as string) || 'Video';
      }

      // L5-B3.19.e:localFilePath 变(撤销 / 协作)→ 同步 dataTab 显示
      // 注:downloadBtn 内部状态不主动同步(撤销下载状态非关键场景);如真出问题
      // 用户重新点 ⬇ 即可恢复正确状态(对齐 c 段 memory mode 同样取舍)
      if (oldLocalFilePath !== updated.attrs.localFilePath) {
        framework.dataTab.setDownloadStatus({
          phase: updated.attrs.localFilePath ? 'done' : 'idle',
          localFilePath: (updated.attrs.localFilePath as string | null) || null,
        });
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
