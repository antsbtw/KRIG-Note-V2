/**
 * ai-translate-button — 🤖 本机 AI(Gemma)按上下文翻译字幕 → 翻译 Tab(试用版,2026-11-05)
 *
 * 与 🌐(Google 逐行)并排,用户自己选。用户 11-05 原话:「我的感觉是翻译不准确」。
 * - 只送带 [MM:SS] 的行去翻,时间戳原样保留;不带时间的行(如「⚠️ AI 听写」说明)原样留着
 * - 慢(几十秒):按钮显示 ⏳,tooltip 说明在等本机 AI
 * - 失败如实显示原因(Ollama 没开 / 没模型 / 漏翻),**不换 Google 顶替**
 *
 * W5-A:driver 直 import @capabilities/learning(同 translate-button)。
 */

import { aiTranslateLines } from '@capabilities/learning';

const TARGET_LANG = 'zh-CN';
const TS_RE = /^(\[\d{1,2}:\d{2}(?::\d{2})?\])\s*(.*)$/;

export interface AiTranslateButton {
  el: HTMLButtonElement;
  /** 字幕原文变了 → 重新判断能不能点 */
  refresh(): void;
  destroy(): void;
}

/** 纯函数:按行拆出要翻的文字(只取带时间戳的行) */
export function splitTimedLines(text: string): { lines: string[]; timedIdx: number[]; texts: string[] } {
  const lines = text.split('\n').filter((l) => l.trim());
  const timedIdx: number[] = [];
  const texts: string[] = [];
  lines.forEach((l, i) => {
    const m = l.match(TS_RE);
    if (m && m[2].trim()) { timedIdx.push(i); texts.push(m[2].trim()); }
  });
  return { lines, timedIdx, texts };
}

/** 纯函数:译文按原顺序填回,时间戳保留 */
export function mergeTranslated(lines: string[], timedIdx: number[], translated: string[]): string {
  const out = [...lines];
  timedIdx.forEach((li, k) => {
    const m = lines[li].match(TS_RE);
    out[li] = `${m?.[1] ?? ''} ${translated[k]}`;
  });
  return out.join('\n');
}

export function createAiTranslateButton(
  getTranscriptText: () => string,
  onTranslated: (langCode: string, translatedText: string) => void,
): AiTranslateButton {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'krig-video-block__translate-btn';
  btn.textContent = '🤖';
  let busy = false;

  function applyEnabledState(): void {
    const has = splitTimedLines(getTranscriptText() || '').texts.length > 0;
    btn.disabled = !has;
    btn.title = has ? '本机 AI 按上下文翻译成中文(较慢,约几十秒)' : '需要先有字幕';
  }
  applyEnabledState();

  function flash(text: string, title: string, ms: number): void {
    btn.textContent = text;
    btn.title = title;
    window.setTimeout(() => {
      if (!btn.isConnected) return;
      btn.textContent = '🤖';
      busy = false;
      applyEnabledState();
    }, ms);
  }

  btn.addEventListener('mousedown', async (e) => {
    // mousedown 里 preventDefault 阻止 PM 升级 NodeSelection(同 translate-button)
    e.preventDefault();
    e.stopPropagation();
    if (btn.disabled || busy) return;
    const { lines, timedIdx, texts } = splitTimedLines(getTranscriptText() || '');
    if (!texts.length) return;

    busy = true;
    btn.textContent = '⏳';
    btn.disabled = true;
    btn.title = `本机 AI 翻译中(${texts.length} 行,请稍等)…`;
    try {
      const r = await aiTranslateLines(texts, TARGET_LANG);
      if (!r.lines) {
        flash('❌', r.error || 'AI 翻译失败', 4000);
        return;
      }
      onTranslated(TARGET_LANG, mergeTranslated(lines, timedIdx, r.lines));
      flash('✓', `已用本机 AI 翻译为 ${TARGET_LANG}`, 1500);
    } catch (err) {
      flash('❌', err instanceof Error ? err.message : 'AI 翻译失败', 4000);
    }
  });

  return {
    el: btn,
    refresh() {
      if (busy) return;
      applyEnabledState();
    },
    destroy() {
      btn.remove();
    },
  };
}
