/**
 * tweetBlock NodeView — 双 Tab + Fetch + Download(L5-B3.18)
 *
 * V1 → V2 直迁:src/plugins/note/blocks/tweet-block.ts NodeView 部分(456 行)
 *
 * 三态:
 * - placeholder(无 tweetUrl):𝕏 + URL 输入 → 切 Browse Tab(iframe 加载)
 * - Browse Tab:platform.twitter.com iframe(自适应高度,监听 postMessage)
 * - Data Tab:离线卡片(头像/名/正文/时间/metrics/引用)— Fetch 按钮抓回填后切到这
 *
 * 按钮(Tab 栏右侧):
 * - ⬇️ Download 视频(走 ytdlp capability;未装时先触发 install)
 * - Fetch 元数据(走 tweet-fetcher capability;成功后自动切 Data Tab)
 *
 * Caption:contentDOM 由 PM 接管(对齐 image/audio/video 模式)。
 *
 * destroy 时移除 window message listener(防内存泄漏 — V1 已做,直迁照搬)。
 *
 * W5 严格态 A:driver 内部消费 capability,优先通过 capability API 保持口径统一。
 */

import type { NodeViewConstructor } from 'prosemirror-view';
import type { Node as PMNode } from 'prosemirror-model';
import { fetchTweetData } from '@capabilities/tweet-fetcher';
import {
  checkStatus as ytdlpCheckStatus,
  install as ytdlpInstall,
  download as ytdlpDownload,
} from '@capabilities/ytdlp';

// ── 工具函数 ──

function extractTweetId(url: string): string | null {
  const m = url.match(/(?:twitter\.com|x\.com)\/.+\/status\/(\d+)/);
  return m?.[1] ?? null;
}

function tweetEmbedUrl(tweetId: string): string {
  return `https://platform.twitter.com/embed/Tweet.html?id=${tweetId}&theme=dark&dnt=true`;
}

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function timeAgo(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

const SCALE = 0.75; // V1 同款,iframe 实际高度 × 0.75 = 容器高度

// ── NodeView 工厂 ──

export const tweetBlockNodeView: NodeViewConstructor = (initialNode, view, getPos) => {
  let node = initialNode;

  const dom = document.createElement('div');
  dom.className = 'krig-tweet-block';

  const playerWrap = document.createElement('div');
  playerWrap.className = 'krig-tweet-block__player';
  playerWrap.contentEditable = 'false';
  dom.appendChild(playerWrap);

  // Caption(contentDOM,PM 接管)
  const captionDOM = document.createElement('figcaption');
  captionDOM.className = 'krig-tweet-block__caption';
  dom.appendChild(captionDOM);

  // window message listener 引用(destroy 时移除防泄漏)
  let resizeHandler: ((event: MessageEvent) => void) | null = null;
  let currentIframe: HTMLIFrameElement | null = null;

  function updateAttrs(patch: Record<string, unknown>): void {
    const pos = typeof getPos === 'function' ? getPos() : undefined;
    if (pos == null) return;
    let tr = view.state.tr;
    for (const [key, value] of Object.entries(patch)) {
      tr = tr.setNodeAttribute(pos, key, value);
    }
    tr.setMeta('addToHistory', false); // 内部 attr 同步不进 undo 栈
    view.dispatch(tr);
  }

  function disposeIframe(): void {
    if (resizeHandler) {
      window.removeEventListener('message', resizeHandler);
      resizeHandler = null;
    }
    currentIframe = null;
  }

  function buildPlaceholder(): void {
    disposeIframe();
    playerWrap.innerHTML = '';

    const ph = document.createElement('div');
    ph.className = 'krig-tweet-block__placeholder';

    const icon = document.createElement('span');
    icon.className = 'krig-tweet-block__placeholder-icon';
    icon.textContent = '𝕏';
    ph.appendChild(icon);

    const urlInput = document.createElement('input');
    urlInput.type = 'text';
    urlInput.className = 'krig-tweet-block__placeholder-url';
    urlInput.placeholder = 'Paste post URL (x.com or twitter.com)...';
    urlInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const url = urlInput.value.trim();
        if (!url) return;
        const id = extractTweetId(url);
        updateAttrs({ tweetUrl: url, tweetId: id });
      }
    });
    ph.appendChild(urlInput);

    playerWrap.appendChild(ph);
  }

  function buildEmbed(n: PMNode): void {
    disposeIframe();
    playerWrap.innerHTML = '';

    const tweetUrl = n.attrs.tweetUrl as string;
    const tweetId = (n.attrs.tweetId as string) || extractTweetId(tweetUrl);
    const activeTab = (n.attrs.activeTab as 'browse' | 'data') || 'browse';

    // ── Tab 栏 ──
    const tabBar = document.createElement('div');
    tabBar.className = 'krig-tweet-block__tab-bar';

    const browseTabBtn = document.createElement('button');
    browseTabBtn.type = 'button';
    browseTabBtn.className =
      'krig-tweet-block__tab-btn' + (activeTab === 'browse' ? ' active' : '');
    browseTabBtn.textContent = 'Browse';
    browseTabBtn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      switchTab('browse');
    });
    tabBar.appendChild(browseTabBtn);

    const dataTabBtn = document.createElement('button');
    dataTabBtn.type = 'button';
    dataTabBtn.className =
      'krig-tweet-block__tab-btn' + (activeTab === 'data' ? ' active' : '');
    dataTabBtn.textContent = 'Data';
    dataTabBtn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      switchTab('data');
    });
    tabBar.appendChild(dataTabBtn);

    // 右侧按钮组(spacer 推到右边)
    const spacer = document.createElement('div');
    spacer.style.flex = '1';
    tabBar.appendChild(spacer);

    // Download / Show in Finder 按钮(走 ytdlp + showItemInFolder capability)
    //
    // 状态机(L5-B3.18 用户红线 — 用户找得到下载文件):
    //   未下载(downloadedVideoPath = null):⬇️  → 点击触发下载 → 下载中 ⏳ →
    //   完成后 attrs 写入 downloadedVideoPath → 切 📁 状态(常驻可点)
    //   📁 状态:点击调 electronAPI.showItemInFolder 在 Finder 高亮文件
    //   下载失败:❌ 2s → 回 ⬇️
    //   yt-dlp 未装:首次点 ⬇️ 触发 install,装完按钮回 ⬇️,用户再点真下载
    const dlBtn = document.createElement('button');
    dlBtn.type = 'button';
    dlBtn.className = 'krig-tweet-block__action-btn';
    const initialDownloaded = (n.attrs.downloadedVideoPath as string | null) || null;
    if (initialDownloaded) {
      dlBtn.textContent = '📁';
      dlBtn.title = `Show in Finder: ${initialDownloaded}`;
    } else {
      dlBtn.textContent = '⬇️';
      dlBtn.title = 'Download video';
    }
    let dlBusy = false;
    dlBtn.addEventListener('mousedown', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (dlBusy) return;

      // ── 已下载态:点击 → Finder 高亮文件 ──
      const downloadedPath = (node.attrs.downloadedVideoPath as string | null) || null;
      if (downloadedPath) {
        try {
          const result = await window.electronAPI?.showItemInFolder?.(downloadedPath);
          if (!result?.ok) {
            // 文件可能被用户删了 / 移动了 — 清掉持久化路径,回 ⬇️ 态让用户重下
            console.warn('[tweetBlock] showItemInFolder failed:', result?.reason);
            updateAttrs({ downloadedVideoPath: null });
          }
        } catch (err) {
          console.warn('[tweetBlock] showItemInFolder threw:', err);
        }
        return;
      }

      // ── 未下载态:走原下载流程 ──
      dlBusy = true;
      try {
        // 1. 检查 yt-dlp 是否装好
        const status = await ytdlpCheckStatus();
        if (!status.installed) {
          // 首次:触发 install,装完用户再点真下载(决策 Q2,V1 行为)
          dlBtn.textContent = '⏳';
          dlBtn.disabled = true;
          const r = await ytdlpInstall();
          if (!r.installed) {
            dlBtn.textContent = '❌';
            setTimeout(() => {
              if (!dlBtn.isConnected) return;
              dlBtn.textContent = '⬇️';
              dlBtn.title = 'Download video';
              dlBtn.disabled = false;
            }, 2000);
          } else {
            dlBtn.textContent = '⬇️';
            dlBtn.title = 'Download video';
            dlBtn.disabled = false;
          }
          return;
        }

        // 2. 已装 → 真下载
        dlBtn.textContent = '⏳';
        dlBtn.disabled = true;
        const result = await ytdlpDownload(tweetUrl);
        if (view.isDestroyed) return;
        if (result.status === 'complete' && result.filename) {
          // 持久化下载路径 — 切 📁 态由 update() 路径自然渲染(attrs 变会触发 paint)
          updateAttrs({ downloadedVideoPath: result.filename });
        } else {
          dlBtn.textContent = '❌';
          dlBtn.disabled = false;
          setTimeout(() => {
            if (!dlBtn.isConnected) return;
            dlBtn.textContent = '⬇️';
            dlBtn.title = 'Download video';
          }, 2000);
        }
      } catch (err) {
        console.warn('[tweetBlock] download failed:', err);
        dlBtn.textContent = '❌';
        dlBtn.disabled = false;
        setTimeout(() => {
          if (!dlBtn.isConnected) return;
          dlBtn.textContent = '⬇️';
          dlBtn.title = 'Download video';
        }, 2000);
      } finally {
        dlBusy = false;
      }
    });
    tabBar.appendChild(dlBtn);

    // Fetch 元数据(走 tweet-fetcher capability)
    const fetchBtn = document.createElement('button');
    fetchBtn.type = 'button';
    fetchBtn.className = 'krig-tweet-block__action-btn';
    fetchBtn.textContent = 'Fetch';
    fetchBtn.title = 'Fetch post metadata';
    fetchBtn.addEventListener('mousedown', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const originalText = fetchBtn.textContent;
      fetchBtn.textContent = 'Fetching...';
      fetchBtn.disabled = true;
      try {
        const result = await fetchTweetData(tweetUrl);
        if (view.isDestroyed) return;
        if (result.success && result.data) {
          const d = result.data;
          updateAttrs({
            authorName: d.authorName || '',
            authorHandle: d.authorHandle || '',
            authorAvatar: d.authorAvatar || '',
            text: d.text || '',
            createdAt: d.createdAt || '',
            lang: d.lang || '',
            media: d.media || null,
            metrics: d.metrics || null,
            quotedTweet: d.quotedTweet || null,
            inReplyTo: d.inReplyTo || null,
            activeTab: 'data',
          });
          fetchBtn.textContent = originalText;
        } else {
          console.warn('[tweetBlock] fetch failed:', result.error);
          fetchBtn.textContent = '❌';
          setTimeout(() => {
            fetchBtn.textContent = originalText;
          }, 2000);
        }
      } catch (err) {
        console.warn('[tweetBlock] fetch threw:', err);
        fetchBtn.textContent = '❌';
        setTimeout(() => {
          fetchBtn.textContent = originalText;
        }, 2000);
      } finally {
        fetchBtn.disabled = false;
      }
    });
    tabBar.appendChild(fetchBtn);

    playerWrap.appendChild(tabBar);

    // ── Browse Panel(iframe)──
    const browsePanel = document.createElement('div');
    browsePanel.className = 'krig-tweet-block__browse-panel';

    if (tweetId) {
      const iframe = document.createElement('iframe');
      iframe.className = 'krig-tweet-block__iframe';
      iframe.src = tweetEmbedUrl(tweetId);
      iframe.setAttribute('frameborder', '0');
      iframe.setAttribute('scrolling', 'no');
      iframe.setAttribute('allowtransparency', 'true');
      iframe.setAttribute('allow', 'encrypted-media');
      currentIframe = iframe;

      // 监听 Twitter postMessage 调整 iframe 高度
      resizeHandler = (event: MessageEvent) => {
        if (!currentIframe || event.source !== currentIframe.contentWindow) return;
        try {
          let data: unknown = event.data;
          if (typeof data === 'string') data = JSON.parse(data);
          if (!data || typeof data !== 'object') return;
          const embed = (data as Record<string, unknown>)['twttr.embed'] as
            | { method?: string; params?: Array<{ height?: number }> }
            | undefined;
          if (!embed || embed.method !== 'twttr.private.resize') return;
          const params = embed.params?.[0];
          const height = params?.height;
          if (typeof height === 'number' && height > 50) {
            currentIframe.style.height = `${height}px`;
            browsePanel.style.height = `${Math.ceil(height * SCALE)}px`;
          }
        } catch {
          /* ignore */
        }
      };
      window.addEventListener('message', resizeHandler);

      browsePanel.appendChild(iframe);

      // 若 tweetId 还没存进 attrs,补一次(避免 parseDOM 路径丢失)
      if (!n.attrs.tweetId) {
        updateAttrs({ tweetId });
      }
    } else {
      browsePanel.innerHTML =
        '<div class="krig-tweet-block__no-embed">Unable to parse post ID</div>';
    }

    // ── Data Panel(离线卡片)──
    const dataPanel = document.createElement('div');
    dataPanel.className = 'krig-tweet-block__data-panel';

    if (n.attrs.authorName || n.attrs.text) {
      buildDataCard(dataPanel, n.attrs as Record<string, unknown>);
    } else {
      dataPanel.innerHTML =
        '<div class="krig-tweet-block__no-data">Click "Fetch" to load post data</div>';
    }

    function switchTab(tabId: 'browse' | 'data'): void {
      browsePanel.style.display = tabId === 'browse' ? 'block' : 'none';
      dataPanel.style.display = tabId === 'data' ? 'block' : 'none';
      browseTabBtn.classList.toggle('active', tabId === 'browse');
      dataTabBtn.classList.toggle('active', tabId === 'data');
      updateAttrs({ activeTab: tabId });
    }
    // 初始 tab 显隐
    browsePanel.style.display = activeTab === 'browse' ? 'block' : 'none';
    dataPanel.style.display = activeTab === 'data' ? 'block' : 'none';

    playerWrap.appendChild(browsePanel);
    playerWrap.appendChild(dataPanel);
  }

  function paint(n: PMNode): void {
    if (n.attrs.tweetUrl) buildEmbed(n);
    else buildPlaceholder();
  }

  paint(node);

  return {
    dom,
    contentDOM: captionDOM,
    update(updated) {
      if (updated.type.name !== 'tweetBlock') return false;
      const hadUrl = !!node.attrs.tweetUrl;
      const hasUrl = !!updated.attrs.tweetUrl;
      const oldAuthor = node.attrs.authorName;
      const oldText = node.attrs.text;
      const oldTab = node.attrs.activeTab;
      const oldDownloaded = node.attrs.downloadedVideoPath;
      node = updated;
      // 整体重渲条件:placeholder ↔ embed 切换 / Fetch 完成数据回填 / Tab 切 /
      //                Download 完成态切换(⬇️ ↔ 📁,L5-B3.18 用户红线)
      if (hadUrl !== hasUrl) {
        paint(node);
      } else if (hasUrl) {
        // 有 url 状态下:数据回填 / Tab 切 / Download 状态切都重渲
        if (
          oldAuthor !== updated.attrs.authorName ||
          oldText !== updated.attrs.text ||
          oldTab !== updated.attrs.activeTab ||
          oldDownloaded !== updated.attrs.downloadedVideoPath
        ) {
          paint(node);
        }
      }
      return true;
    },
    stopEvent(event) {
      // 推文 Tab 栏按钮 / iframe / placeholder 输入交互由 NodeView 控制
      const target = event.target as HTMLElement | null;
      if (
        target?.closest(
          '.krig-tweet-block__tab-bar, .krig-tweet-block__iframe, .krig-tweet-block__placeholder, .krig-tweet-block__data-panel a',
        )
      ) {
        return true;
      }
      return false;
    },
    ignoreMutation(mutation) {
      // caption(contentDOM)mutation 让 PM 接管,其他 NodeView 内部 DOM mutation 忽略
      if (captionDOM.contains(mutation.target)) return false;
      return true;
    },
    destroy() {
      disposeIframe();
    },
  };
};

// ── Data Panel 卡片构建 ──

function buildDataCard(panel: HTMLElement, attrs: Record<string, unknown>): void {
  panel.innerHTML = '';

  const authorName = (attrs.authorName as string) || '';
  const authorHandle = (attrs.authorHandle as string) || '';
  const authorAvatar = (attrs.authorAvatar as string) || '';
  const text = (attrs.text as string) || '';
  const createdAt = (attrs.createdAt as string) || '';
  const metrics = attrs.metrics as Record<string, number> | null;
  const quotedTweet = (attrs.quotedTweet as string) || '';
  const inReplyTo = (attrs.inReplyTo as string) || '';
  const tweetUrl = (attrs.tweetUrl as string) || '';

  // 作者行
  if (authorName || authorHandle) {
    const authorRow = document.createElement('div');
    authorRow.className = 'krig-tweet-block__author';

    if (authorAvatar) {
      const img = document.createElement('img');
      img.src = authorAvatar;
      img.className = 'krig-tweet-block__avatar';
      authorRow.appendChild(img);
    } else {
      const placeholder = document.createElement('span');
      placeholder.className = 'krig-tweet-block__avatar-placeholder';
      placeholder.textContent = '𝕏';
      authorRow.appendChild(placeholder);
    }

    const nameEl = document.createElement('strong');
    nameEl.textContent = authorName;
    authorRow.appendChild(nameEl);

    const handleEl = document.createElement('span');
    handleEl.className = 'krig-tweet-block__handle';
    handleEl.textContent = ` ${authorHandle}`;
    authorRow.appendChild(handleEl);

    if (createdAt) {
      const timeEl = document.createElement('span');
      timeEl.className = 'krig-tweet-block__time';
      timeEl.textContent = ` · ${timeAgo(createdAt)}`;
      authorRow.appendChild(timeEl);
    }

    panel.appendChild(authorRow);
  }

  // 回复指示
  if (inReplyTo) {
    const replyEl = document.createElement('div');
    replyEl.className = 'krig-tweet-block__reply-to';
    replyEl.textContent = '↩ Replying to a post';
    panel.appendChild(replyEl);
  }

  // 正文
  if (text) {
    const textEl = document.createElement('div');
    textEl.className = 'krig-tweet-block__text';
    textEl.textContent = text;
    panel.appendChild(textEl);
  }

  // 互动数据
  if (metrics) {
    const metricsRow = document.createElement('div');
    metricsRow.className = 'krig-tweet-block__metrics';
    const parts: string[] = [];
    if (metrics.replies != null) parts.push(`💬 ${formatCount(metrics.replies)}`);
    if (metrics.retweets != null) parts.push(`🔁 ${formatCount(metrics.retweets)}`);
    if (metrics.likes != null) parts.push(`❤ ${formatCount(metrics.likes)}`);
    if (metrics.views != null) parts.push(`👁 ${formatCount(metrics.views)}`);
    metricsRow.textContent = parts.join('  ');
    panel.appendChild(metricsRow);
  }

  // 引用推文
  if (quotedTweet) {
    const quoteEl = document.createElement('div');
    quoteEl.className = 'krig-tweet-block__quoted';
    quoteEl.textContent = `Quoted: ${quotedTweet}`;
    panel.appendChild(quoteEl);
  }

  // 打开原文
  if (tweetUrl) {
    const link = document.createElement('a');
    link.className = 'krig-tweet-block__open-link';
    link.href = tweetUrl;
    link.target = '_blank';
    link.textContent = 'Open original ↗';
    link.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      void window.electronAPI?.openExternal?.(tweetUrl);
    });
    panel.appendChild(link);
  }
}
