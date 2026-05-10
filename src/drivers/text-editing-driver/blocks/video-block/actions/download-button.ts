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
  checkYoutubeCookies,
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
  /** L5-B3.19.e UX:请求显示 YouTube 登录 modal(node-view 创建 prompt 浮层并 show)*/
  onRequestYoutubeLogin: () => void;
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
    // 防御:phase=done 时不该被异步 checkStatus / paintIdle 覆盖按钮文字
    // (mount 时 syncFromAttrs 已设 📁,checkStatus 几秒后 resolve 不能改回 ⬇)
    if (phase === 'done') return;

    if (!isYouTubeSrc()) {
      btn.disabled = true;
      btn.title = '仅 YouTube 源支持 yt-dlp 下载(直链 mp4 走视频自带下载按钮)';
      btn.textContent = '⬇';
      return;
    }
    btn.disabled = false;
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
   * 运行下载流程,正确顺序:
   *   1. **先检登录态**(站点需要登录吗?webview 已登录吗?)
   *      没登录 → 立刻跳 web view 登录页,**不浪费 install 36MB**
   *   2. install yt-dlp(若需)
   *   3. download 视频
   *
   * UX 改进:用户单次点击完成所有事,登录后再点一次完成下载。
   */
  async function runFlow(): Promise<void> {
    const src = deps.getSrc();
    if (!src) return;

    // 步骤 1:**先检登录态**(优先级最高,登录前不浪费任何资源)
    // YouTube 源需要登录过反爬;direct mp4 等不需要
    if (isYouTubeSrc()) {
      try {
        const status = await checkYoutubeCookies();
        if (!status.hasLogin) {
          // 没登录 → 直接触发右屏 web view 跳 google 登录页
          phase = 'idle';
          btn.textContent = '⬇';
          btn.title = '需要先在 web view 登录 YouTube';
          btn.disabled = false;
          deps.onProgress(false, 0);
          deps.onPhaseChange('idle');
          deps.onRequestYoutubeLogin();
          return;
        }
      } catch (e) {
        // 检测失败 — 继续尝试(降级,可能仍失败但给用户机会)
        console.warn('[download-btn] checkYoutubeCookies failed, continue:', e);
      }
    }

    // 步骤 2:确保 yt-dlp 已装(未装则自动 install)
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

    // 步骤 3:下载视频(登录 + install 都通过)
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
    e.stopPropagation();
    if (btn.disabled) return;

    // done + 点击 → showItemInFolder(若文件已被删,自动 reset 到 idle 重新下载)
    if (phase === 'done') {
      const path = deps.getLocalFilePath();
      if (path) {
        const result = await window.electronAPI?.showItemInFolder?.(path);
        if (result && !result.ok) {
          // 文件已被用户删除等 → 重置到 idle,下次点击重新下载
          phase = 'idle';
          deps.onUpdateAttrs({ localFilePath: null });
          paintIdle();
          deps.onPhaseChange('idle');
        }
      } else {
        // localFilePath 缺失 → reset
        phase = 'idle';
        paintIdle();
        deps.onPhaseChange('idle');
      }
      return;
    }

    // installing / downloading 期间 — 防呆,不重入
    if (phase === 'installing' || phase === 'downloading') return;

    const src = deps.getSrc();
    if (!src) return;
    if (!isYouTubeSrc()) return;

    // idle → 启动 install(若需)+ download 一气呵成
    await runFlow();
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
