/**
 * learning capability — renderer 侧 KRIG 学习能力封装(L5-B3.20a)
 *
 * 职责:把 main 进程的 learning 能力(vocab CRUD + dictionary lookup + translate / TTS)
 * 暴露给 view / driver 层。
 *
 * 实现位置:src/platform/main/learning/(vocab-store + dictionary-service + 2 providers + handlers)
 * 本文件是 renderer 侧 IPC 调用封装 + Registry 注册门面。
 *
 * ── 下游消费者(规划)──
 *
 * - L5-B3.20b dictionary-panel:选词 → lookup → 显释义 → 加生词本 → TTS 发音
 * - L5-B3.20b vocab-highlight PM plugin:文本中高亮已收入生词本的词
 * - L5-B3.19 video-block:translate 字幕 / TTS 朗读 / vocab timeline
 *
 * ── W5 严格态 A 边界(audit 2026-05-08 § 5.2)──
 *
 * - View 侧(强制):走 requireCapabilityApi('learning').vocabAdd(...) 间接路由
 * - Driver/slot 侧(允许):可直 import @capabilities/learning 单例兜底
 *   ↑ 临时允许项,非全局严格态(B/C)达成态;后续 charter v0.5 升级时统一改造
 *
 * 模块级 export 同时挂(双导出),对齐 ytdlp / tweet-fetcher / media-storage 现有写法。
 *
 * ── 平台限制 ──
 *
 * - macOS:dictionaryLookup 优先用系统词典(swift CLI),质量最高
 * - 其他平台:fallback Google Translate
 * - Google 反爬时:translate / tts / Google fallback 静默失败返 null
 */

import { capabilityRegistry } from '@slot/capability-registry/capability-registry';
import type {
  LearningApi,
  VocabEntry,
  DictionaryLookupResult,
  TranslateResult,
} from './types';

export type {
  LearningApi,
  VocabEntry,
  DictionaryLookupResult,
  TranslateResult,
} from './types';

// ── vocab CRUD ──

export async function vocabAdd(
  word: string,
  definition: string,
  context?: string,
  phonetic?: string,
): Promise<VocabEntry | null> {
  if (!window.electronAPI?.learningVocabAdd) return null;
  return window.electronAPI.learningVocabAdd(word, definition, context, phonetic);
}

export async function vocabRemove(id: string): Promise<void> {
  if (!window.electronAPI?.learningVocabRemove) return;
  return window.electronAPI.learningVocabRemove(id);
}

export async function vocabList(): Promise<VocabEntry[]> {
  if (!window.electronAPI?.learningVocabList) return [];
  return window.electronAPI.learningVocabList();
}

export async function vocabHas(word: string): Promise<boolean> {
  if (!window.electronAPI?.learningVocabHas) return false;
  return window.electronAPI.learningVocabHas(word);
}

/**
 * 订阅 vocab 变化(任何 add/remove 都推全量 list)
 *
 * 多订阅模式:多个订阅者并存,每个订阅返回独立 unsubscribe 函数。
 * 对齐 V2 onFullscreenChanged / onYtdlpInstallProgress 模式。
 */
export function onVocabChanged(
  callback: (entries: VocabEntry[]) => void,
): () => void {
  if (!window.electronAPI?.onLearningVocabChanged) return () => {};
  return window.electronAPI.onLearningVocabChanged(callback);
}

// ── dictionary ──

export async function dictionaryLookup(
  word: string,
): Promise<DictionaryLookupResult | null> {
  if (!window.electronAPI?.learningDictionaryLookup) return null;
  return window.electronAPI.learningDictionaryLookup(word);
}

// ── translate / tts ──

export async function translate(
  text: string,
  targetLang?: string,
): Promise<TranslateResult | null> {
  if (!window.electronAPI?.learningTranslate) return null;
  return window.electronAPI.learningTranslate(text, targetLang);
}

export async function tts(text: string, lang: string): Promise<ArrayBuffer | null> {
  if (!window.electronAPI?.learningTts) return null;
  return window.electronAPI.learningTts(text, lang);
}

// W5 严格态:Registry 注册 + api 字段(view 通过 requireCapabilityApi 间接路由)
// W5 边界 A 临时允许项:同时保留模块级 export(driver/slot 内部消费可直 import)
capabilityRegistry.register({
  id: 'learning',
  api: {
    vocabAdd,
    vocabRemove,
    vocabList,
    vocabHas,
    onVocabChanged,
    dictionaryLookup,
    translate,
    tts,
  } satisfies LearningApi,
});
