/**
 * translate-button — 🌐 batched translate transcript → 翻译 Tab(L5-B3.19.b)
 *
 * 行为(对齐 V1):
 * 1. 取当前 transcript 文本
 * 2. 切分为"行 + 时间戳记录"(去掉时间戳前缀只翻译纯文本)
 * 3. 按 4500 字符上限分 batch,逐 batch 调 learning.translate
 * 4. 重组 `[MM:SS] translated_text` 行(用原时间戳 + 翻译)
 * 5. 调 onTranslated(langCode, fullTranslatedText) → node-view 创建/更新翻译 Tab
 *
 * 失败 batch 降级:塞回原 batch 文本(对齐 V1) — 用户拿到部分翻译比全失败好。
 *
 * W5-A:driver 直 import @capabilities/learning。
 */

import { translate } from '@capabilities/learning';

const DEFAULT_TARGET_LANG = 'zh-CN';
const BATCH_LIMIT = 4500;

export interface TranslateButton {
  el: HTMLButtonElement;
  setTargetLang(lang: string): void;
  destroy(): void;
}

export function createTranslateButton(
  getTranscriptText: () => string,
  onTranslated: (langCode: string, translatedText: string) => void,
): TranslateButton {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'krig-video-block__translate-btn';
  btn.textContent = '🌐';
  btn.title = `翻译字幕(默认 ${DEFAULT_TARGET_LANG})`;

  let targetLang = DEFAULT_TARGET_LANG;

  function applyEnabledState(): void {
    const text = getTranscriptText();
    btn.disabled = !text || !text.trim();
    btn.title = btn.disabled ? '需要先有字幕' : `翻译字幕(目标 ${targetLang})`;
  }
  applyEnabledState();

  btn.addEventListener('mousedown', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (btn.disabled) return;

    const transcriptText = getTranscriptText();
    if (!transcriptText.trim()) return;

    const origText = btn.textContent;
    const origTitle = btn.title;
    btn.textContent = '⏳';
    btn.disabled = true;
    btn.title = '翻译中...';

    try {
      const lines = transcriptText.split('\n').filter((l) => l.trim());
      const timestampRe = /^(\[\d{1,2}:\d{2}(?::\d{2})?\])\s*/;

      // 切分"时间戳 + 纯文本"
      const timestamps: string[] = [];
      const purelines: string[] = [];
      for (const line of lines) {
        const m = line.match(timestampRe);
        timestamps.push(m?.[1] || '');
        purelines.push(line.replace(timestampRe, ''));
      }

      // batched translate:每 batch ≤ BATCH_LIMIT 字符
      const translated: string[] = [];
      let batch: string[] = [];
      let batchLen = 0;

      const flush = async () => {
        if (batch.length === 0) return;
        const result = await translate(batch.join('\n'), targetLang);
        if (result?.text) {
          const arr = result.text.split('\n');
          // 长度对齐:翻译应该是行数等价;失败时用原文降级
          if (arr.length === batch.length) {
            translated.push(...arr);
          } else {
            translated.push(...batch);
          }
        } else {
          // 整 batch 失败 → 降级原文(对齐 V1)
          translated.push(...batch);
        }
        batch = [];
        batchLen = 0;
      };

      for (const line of purelines) {
        const lineLen = line.length + 1; // +1 for '\n'
        if (batchLen + lineLen > BATCH_LIMIT && batch.length > 0) {
          await flush();
        }
        batch.push(line);
        batchLen += lineLen;
      }
      await flush();

      // 重组带时间戳
      const translatedLines = translated.map((t, i) => {
        const ts = timestamps[i] || '';
        return ts ? `${ts} ${t}` : t;
      });
      const fullText = translatedLines.join('\n');

      onTranslated(targetLang, fullText);

      btn.textContent = '✓';
      btn.title = `已翻译为 ${targetLang}`;
      window.setTimeout(() => {
        if (!btn.isConnected) return;
        btn.textContent = origText;
        btn.title = origTitle;
        applyEnabledState();
      }, 1500);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '翻译失败';
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
    setTargetLang(lang) {
      targetLang = lang;
      applyEnabledState();
    },
    destroy() {
      btn.remove();
    },
  };
}
