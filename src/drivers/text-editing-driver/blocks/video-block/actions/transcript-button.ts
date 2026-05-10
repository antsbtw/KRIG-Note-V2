/**
 * transcript-button — 📝 抓 YouTube 字幕填入 transcript Tab(L5-B3.19.b)
 *
 * 仅 YouTube 视频可用(非 YouTube 灰显)。
 * 调 ytdlp.fetchTranscript;成功 → onTranscript 回调(node-view 调 transcriptTab.setText
 * 并触发 input → 节流写 attrs.transcriptText);失败 → 短暂 ❌ + tooltip 显错误。
 *
 * W5-A:driver 直 import @capabilities/ytdlp(总设计 + B3.20b 已确立约定)。
 */

import { fetchTranscript } from '@capabilities/ytdlp';
import { detectEmbedType } from '../helpers/embed-detection';

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
  btn.title = '从 YouTube 抓取字幕';

  function applyEnabledState(): void {
    const src = getSrc();
    const isYouTube = src ? detectEmbedType(src) === 'youtube' : false;
    btn.disabled = !isYouTube;
    btn.title = isYouTube ? '从 YouTube 抓取字幕' : '仅 YouTube 视频支持';
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
    if (!src) return;
    if (detectEmbedType(src) !== 'youtube') return;

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
