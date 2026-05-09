/**
 * download-button — yt-dlp 下载状态机(L5-B3.19.e,对齐 V1)
 *
 * 状态机:
 *   idle → checking → installing? → downloading → done
 *   失败 → ❌ 2s 后回 idle
 *
 * 仅 YouTube 源启用 ytdlp 路径(Qe-7=A);direct/vimeo/generic 走 B3.16
 * 既有 mediaDownload(本组件不接管)。
 *
 * Done 后:
 *   - 写 attrs.localFilePath(Q-e-1=A 不切 src)
 *   - subtitleText 自动填(若 transcriptText 当前为空,Qe-5=A)
 *   - translations 非空 → 遍历调 saveSubtitle 静默落 .srt(Qe-6=A)
 *   - 按钮 ⬇ → 📁,点击调 electronAPI.showItemInFolder(P2 修正基线 API)
 */

import {
  checkStatus,
  install,
  download,
  saveSubtitle,
  onDownloadProgress,
} from '@capabilities/ytdlp';
import { detectEmbedType } from '../helpers/embed-detection';

export type DownloadPhase = 'idle' | 'downloading' | 'done';

export interface DownloadButtonDeps {
  /** 取当前 src(用于 detectEmbedType + 下载地址)*/
  getSrc: () => string | null;
  /** 取已下载本地路径(从 attrs.localFilePath)*/
  getLocalFilePath: () => string | null;
  /** 取当前 transcriptText(判断是否需要自动填)*/
  getTranscriptText: () => string | null;
  /** 取 translationTexts(JSON 解析后的 map)*/
  getTranslations: () => Record<string, string>;
  /** 写 localFilePath / 可选 transcriptText 到 attrs */
  onUpdateAttrs: (patch: { localFilePath?: string | null; transcriptText?: string | null }) => void;
  /** 进度推送给 progress-bar:visible + percent */
  onProgress: (visible: boolean, percent: number) => void;
  /** 下载状态变化推 data-tab(显示状态行)*/
  onPhaseChange: (phase: DownloadPhase, percent?: number) => void;
}

export interface DownloadButton {
  el: HTMLButtonElement;
  destroy(): void;
}

export function createDownloadButton(deps: DownloadButtonDeps): DownloadButton {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'krig-video-block__action-btn';
  btn.textContent = '⬇';

  // ── 状态 ──
  let ytdlpAvailable = false;
  let phase: DownloadPhase = 'idle';
  let progressUnsub: (() => void) | null = null;
  let resetTimer: number | null = null;

  function paintIdle(): void {
    if (!isYouTubeSrc()) {
      btn.disabled = true;
      btn.title = '仅 YouTube 源支持 yt-dlp 下载(直链 mp4 走视频自带下载按钮)';
      btn.textContent = '⬇';
      return;
    }
    btn.disabled = !ytdlpAvailable && phase === 'idle' ? false : false;
    btn.textContent = '⬇';
    btn.title = ytdlpAvailable ? 'Download video' : 'Click to install yt-dlp';
  }

  function paintDone(): void {
    btn.textContent = '📁';
    btn.title = 'Open in Finder';
    btn.disabled = false;
  }

  function paintLoading(label: string, title: string): void {
    btn.textContent = label;
    btn.title = title;
    btn.disabled = true;
  }

  function paintError(): void {
    btn.textContent = '❌';
    btn.disabled = true;
    if (resetTimer != null) window.clearTimeout(resetTimer);
    resetTimer = window.setTimeout(() => {
      if (!btn.isConnected) return;
      phase = 'idle';
      paintIdle();
      resetTimer = null;
    }, 2000);
  }

  function isYouTubeSrc(): boolean {
    const src = deps.getSrc();
    return !!src && detectEmbedType(src) === 'youtube';
  }

  function syncFromAttrs(): void {
    // mount / src 变化时:若 attrs.localFilePath 有值则 done 态
    if (deps.getLocalFilePath()) {
      phase = 'done';
      paintDone();
      deps.onPhaseChange('done');
    } else {
      phase = 'idle';
      paintIdle();
      deps.onPhaseChange('idle');
    }
  }

  // checkStatus 异步探测
  void checkStatus()
    .then((s) => {
      ytdlpAvailable = s.installed;
      paintIdle();
    })
    .catch(() => {
      /* 静默 — paintIdle 已默认显示 */
    });

  // 订阅下载进度(全局,按 url 过滤)
  progressUnsub = onDownloadProgress((progress) => {
    const src = deps.getSrc();
    if (!src) return;
    if (progress.url !== src && progress.url !== '') return;
    if (phase !== 'downloading') return;
    deps.onProgress(true, progress.percent);
    deps.onPhaseChange('downloading', progress.percent);
  });

  // ── 主点击逻辑 ──
  // 用 click + mousedown 双重防御:
  // - mousedown 仅 e.preventDefault() + stopPropagation 阻止 PM 把事件升级为
  //   NodeSelection(selectable=true 的 node 内 mousedown 会触发 selection 更新 →
  //   PM 整体销毁重建 NodeView → 闭包丢失)
  // - click 在 mouseup 后触发,处理实际下载逻辑
  btn.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
  });
  btn.addEventListener('click', async (e) => {
    const src = deps.getSrc();
    const isYT = !!src && detectEmbedType(src) === 'youtube';
    console.log('[download-btn] click', {
      phase,
      ytdlpAvailable,
      disabled: btn.disabled,
      src,
      isYouTube: isYT,
    });
    e.stopPropagation();
    if (btn.disabled) return;

    // done + 点击 → showItemInFolder
    if (phase === 'done') {
      const path = deps.getLocalFilePath();
      if (path) {
        await window.electronAPI?.showItemInFolder?.(path);
      }
      return;
    }

    if (phase === 'downloading') return;

    if (!src) {
      console.warn('[download-btn] no src');
      return;
    }
    if (!isYT) {
      console.warn('[download-btn] not youtube — abort');
      return;
    }

    // 未装 yt-dlp → 先 install
    if (!ytdlpAvailable) {
      console.log('[download-btn] yt-dlp not installed, calling install()');
      paintLoading('⏳', 'Installing yt-dlp...');
      try {
        const s = await install();
        console.log('[download-btn] install returned', s);
        if (s.installed) {
          ytdlpAvailable = true;
          paintIdle();
        } else {
          paintError();
        }
      } catch {
        paintError();
      }
      return;
    }

    // 开始下载
    phase = 'downloading';
    paintLoading('⏳', 'Downloading...');
    deps.onProgress(true, 0);
    deps.onPhaseChange('downloading', 0);

    try {
      const result = await download(src);
      if (result.status === 'complete') {
        phase = 'done';
        const localPath = result.filename || null;
        deps.onUpdateAttrs({ localFilePath: localPath });

        // 自动填 transcriptText(Qe-5=A 仅当为空)
        if (result.subtitleText) {
          const cur = deps.getTranscriptText();
          if (!cur || !cur.trim()) {
            deps.onUpdateAttrs({ transcriptText: result.subtitleText });
          }
        }

        // 翻译 .srt 落盘(Qe-6=A 静默失败)
        if (localPath) {
          const translations = deps.getTranslations();
          for (const [lang, text] of Object.entries(translations)) {
            void saveSubtitle(localPath, lang, text).catch(() => {
              /* 静默,主下载已成功 */
            });
          }
        }

        paintDone();
        deps.onProgress(false, 100);
        deps.onPhaseChange('done');
      } else {
        phase = 'idle';
        paintError();
        deps.onProgress(false, 0);
        deps.onPhaseChange('idle');
      }
    } catch {
      phase = 'idle';
      paintError();
      deps.onProgress(false, 0);
      deps.onPhaseChange('idle');
    }
  });

  // 初次同步(mount 时若 attrs 已有 localFilePath → done 态)
  syncFromAttrs();

  return {
    el: btn,
    destroy() {
      if (resetTimer != null) {
        window.clearTimeout(resetTimer);
        resetTimer = null;
      }
      if (progressUnsub) {
        progressUnsub();
        progressUnsub = null;
      }
      btn.remove();
    },
  };
}
