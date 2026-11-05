/**
 * transcript-button — 📝 抓字幕填入 transcript Tab(L5-B3.19.b)
 *
 * 2026-11-05 放开:原先仅 YouTube。用户原话(11-05):「这个不能写死，这是个人学习的关键」。
 * 现在 http(s) 视频都能点:YouTube 走 youtube-transcript,其它站点走 yt-dlp(main 侧分流)。
 * 灰显的只有 blob:(页面临时地址)和 media://(本地文件,没有可问的源;等语音识别)。
 * 调 ytdlp.fetchTranscript;成功 → onTranscript 回调(node-view 调 transcriptTab.setText
 * 并触发 input → 节流写 attrs.transcriptText);失败 → 短暂 ❌ + tooltip 显错误。
 *
 * W5-A:driver 直 import @capabilities/ytdlp(总设计 + B3.20b 已确立约定)。
 */

import { fetchTranscript } from '@capabilities/ytdlp';

export interface TranscriptButton {
  el: HTMLButtonElement;
  destroy(): void;
}

export function createTranscriptButton(
  getSrc: () => string | null,
  onTranscript: (text: string) => void,
): TranscriptButton {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'krig-video-block__transcript-btn';
  btn.textContent = '📝';
  btn.title = '抓取字幕';

  function canFetch(src: string | null): boolean {
    return !!src && /^https?:\/\//i.test(src);
  }

  function applyEnabledState(): void {
    const ok = canFetch(getSrc());
    btn.disabled = !ok;
    btn.title = ok ? '抓取字幕' : '本地/临时地址的视频没有可抓的字幕源';
  }
  applyEnabledState();

  // mousedown:仅 preventDefault + stopPropagation 阻止 PM 升级为 NodeSelection
  // (selectable=true node 内 mousedown 会触发 selection 更新 → NodeView 重建)
  btn.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
  });
  btn.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (btn.disabled) return;

    const src = getSrc();
    if (!src || !canFetch(src)) return;

    const origText = btn.textContent;
    const origTitle = btn.title;
    btn.textContent = '⏳';
    btn.disabled = true;
    btn.title = '抓取中...';

    try {
      const result = await fetchTranscript(src);
      if (result.transcriptText) {
        try {
          onTranscript(result.transcriptText);
        } catch (cbErr) {
          console.warn('[transcript-btn] onTranscript callback threw:', cbErr);
        }
        btn.textContent = '✓';
        btn.title = '字幕已导入';
        window.setTimeout(() => {
          if (!btn.isConnected) return;
          btn.textContent = origText;
          btn.title = origTitle;
          applyEnabledState();
        }, 1500);
      } else {
        btn.textContent = '❌';
        btn.title = result.error || '抓取失败';
        window.setTimeout(() => {
          if (!btn.isConnected) return;
          btn.textContent = origText;
          btn.title = origTitle;
          applyEnabledState();
        }, 2000);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : '抓取失败';
      btn.textContent = '❌';
      btn.title = msg;
      window.setTimeout(() => {
        if (!btn.isConnected) return;
        btn.textContent = origText;
        btn.title = origTitle;
        applyEnabledState();
      }, 2000);
    }
  });

  return {
    el: btn,
    destroy() {
      btn.remove();
    },
  };
}
