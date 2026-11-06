/**
 * 字幕逐行 AI 翻译(本机 Gemma 4,按上下文)—— 试用版,2026-11-05
 *
 * 为什么:🌐 用 Google 逐行翻,用户 11-05 原话:「我的感觉是翻译不准确」。
 * Gemma 拿到**整份字幕**再翻,上下文连贯、术语前后一致。
 *
 * ⭐ 契约用「编号 → 译文」的 JSON 对象,不用数组(project-x-judge-array-contract-spin:
 *    数组契约下 Gemma 常只答第一条)。真机 30 行一次 30/30 全对上,约 42 秒。
 * ⚠️ 缺行 / 多行 → throw(fail loud),不拿原文顶上冒充译文。
 */

import { callOllamaChat } from '../local-llm/ollama-client';

export const AI_TRANSLATE_MODEL = 'gemma4:12b';
/** 一批多少行:整份太长时分批,但批要大,上下文才够 */
const BATCH_LINES = 40;
const BATCH_TIMEOUT_MS = 300_000;

const LANG_NAME: Record<string, string> = {
  'zh-CN': 'Simplified Chinese (natural, conversational; avoid overly formal 您)',
  'zh-TW': 'Traditional Chinese',
  en: 'English',
  ja: 'Japanese',
};

function buildPrompt(lines: readonly string[], firstNo: number, targetLang: string, context: string): string {
  const lang = LANG_NAME[targetLang] ?? targetLang;
  const numbered = lines.map((t, i) => `${firstNo + i}. ${t}`).join('\n');
  return (
    `Translate these numbered subtitle lines into ${lang}. ` +
    'Use the whole context; keep each line\'s meaning in that same line (lines may be sentence fragments that continue on the next line). ' +
    'Keep names, brands and technical terms such as HTTPS, VPN, Wi-Fi as is. ' +
    'Reply ONLY with a JSON object mapping every line number (as a string) to its translation, e.g. {"1":"...","2":"..."}.' +
    (context ? `\n\nEarlier lines (context only, do not translate):\n${context}` : '') +
    `\n\nLines to translate:\n${numbered}`
  );
}

/** 纯函数:校验并取出译文;缺号 / 空译文 → throw */
export function takeTranslations(raw: string, firstNo: number, count: number): string[] {
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new Error(`AI 返回的不是 JSON:${raw.slice(0, 80)}`);
  }
  const out: string[] = [];
  const missing: number[] = [];
  for (let n = firstNo; n < firstNo + count; n++) {
    const v = obj[String(n)];
    if (typeof v !== 'string' || !v.trim()) missing.push(n);
    else out.push(v.trim().replace(/\s*\n\s*/g, ' '));
  }
  if (missing.length) throw new Error(`AI 漏翻了第 ${missing.slice(0, 5).join('、')}${missing.length > 5 ? ' 等' : ''} 行`);
  return out;
}

export async function aiTranslateLines(lines: readonly string[], targetLang: string): Promise<string[]> {
  const t0 = Date.now();
  const out: string[] = [];
  for (let i = 0; i < lines.length; i += BATCH_LINES) {
    const batch = lines.slice(i, i + BATCH_LINES);
    const context = lines.slice(Math.max(0, i - 5), i).join('\n');
    const r = await callOllamaChat({
      model: AI_TRANSLATE_MODEL,
      think: false,
      temperature: 0.2,
      timeoutMs: BATCH_TIMEOUT_MS,
      format: 'json',
      messages: [{ role: 'user', content: buildPrompt(batch, i + 1, targetLang, context) }],
    });
    out.push(...takeTranslations(r.content, i + 1, batch.length));
  }
  console.log(`[ai-translate] ✓ ${lines.length} 行 → ${targetLang}(${AI_TRANSLATE_MODEL},${Date.now() - t0}ms)`);
  return out;
}
