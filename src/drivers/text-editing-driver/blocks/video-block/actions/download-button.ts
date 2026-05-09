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
  onInstallProgress,
} from '@capabilities/ytdlp';
import { detectEmbedType } from '../helpers/embed-detection';

/**
 * 下载状态机(扩展自 V1 — 加 'installing' 让首次用户感知到 yt-dlp 装包阶段):
 *   idle → installing → downloading → done    (首次,自动接力)
 *   idle →               downloading → done    (后续,已装)
 *
 * 单次点击完成所有事(install 完自动接 download)— UX 改进,不再要求用户两次点。
 */
export type DownloadPhase = 'idle' | 'installing' | 'downloading' | 'done';

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

  // 订阅 install 进度(让用户看到 yt-dlp 装包阶段的实时反馈)
  const installProgressUnsub = onInstallProgress((progress) => {
    if (phase !== 'installing') return;
    const pct = Math.max(0, Math.min(100, progress.percent || 0));
    btn.textContent = `⏳ ${pct}%`;
    btn.title = `Installing yt-dlp (${pct}%)... 首次需 ~30s,完成后自动开始下载`;
    deps.onProgress(true, pct);
    deps.onPhaseChange('installing', pct);
  });

  /**
   * 运行下载流程(install 未完成时先 install,完成后立即接力 download)。
   * UX 改进:用户单次点击完成所有事,不需要点两次。
   */
  async function runFlow(): Promise<void> {
    const src = deps.getSrc();
    if (!src) return;

    // 步骤 1:确保 yt-dlp 已装(未装则自动 install)
    if (!ytdlpAvailable) {
      phase = 'installing';
      btn.textContent = '⏳';
      btn.title = '首次使用需先装 yt-dlp(~36MB,约 30s);完成后自动开始下载视频';
      btn.disabled = true;
      deps.onProgress(true, 0);
      deps.onPhaseChange('installing', 0);
      try {
        const s = await install();
        if (!s.installed) {
          paintError();
          return;
        }
        ytdlpAvailable = true;
      } catch {
        paintError();
        return;
      }
    }

    // 步骤 2:下载视频(install 完成后自动接力 — 用户感知是一次点击完成)
    phase = 'downloading';
    btn.textContent = '⏳';
    btn.title = 'Downloading video...';
    btn.disabled = true;
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
  }

  // ── 主点击逻辑 ──
  // 用 click + mousedown 双重防御:
  // - mousedown 仅 e.preventDefault() + stopPropagation 阻止 PM 把事件升级为
  //   NodeSelection(selectable=true 的 node 内 mousedown 会触发 selection 更新 →
  //   PM 整体销毁重建 NodeView → 闭包丢失)
  // - click 在 mouseup 后触发,处理实际逻辑
  btn.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
  });
  btn.addEventListener('click', async (e) => {
    // 入口 log — 任何分支前先打,确保事件触发能被看到
    const srcAtClick = deps.getSrc();
    console.log('[download-btn] click ENTRY', {
      phase,
      ytdlpAvailable,
      btnDisabled: btn.disabled,
      btnText: btn.textContent,
      src: srcAtClick,
      localFilePath: deps.getLocalFilePath(),
    });
    e.stopPropagation();
    if (btn.disabled) {
      console.log('[download-btn] EARLY RETURN: btn.disabled');
      return;
    }

    // done + 点击 → showItemInFolder
    if (phase === 'done') {
      const path = deps.getLocalFilePath();
      console.log('[download-btn] phase=done, opening Finder:', path);
      if (path) {
        await window.electronAPI?.showItemInFolder?.(path);
      }
      return;
    }

    // installing / downloading 期间 — 防呆,不重入
    if (phase === 'installing' || phase === 'downloading') {
      console.log('[download-btn] EARLY RETURN: phase=', phase);
      return;
    }

    if (!srcAtClick) {
      console.log('[download-btn] EARLY RETURN: src is null');
      return;
    }
    if (!isYouTubeSrc()) {
      console.log('[download-btn] EARLY RETURN: not YouTube');
      return;
    }

    console.log('[download-btn] entering runFlow()');
    // idle → 启动 install(若需)+ download 一气呵成
    await runFlow();
    console.log('[download-btn] runFlow() returned');
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
      installProgressUnsub();
      btn.remove();
    },
  };
}
