/**
 * Dictionary Service — provider 编排(L5-B3.20a)
 *
 * V1 → V2 直迁:src/main/learning/dictionary-service.ts(26 行,行为不变)
 *
 * 编排策略:
 *   1. macOS Dictionary.app(swift CLI 调 CoreServices)— 优先,质量最高
 *   2. Google Translate fallback — 单词释义降级
 *
 * 失败(两个 provider 都返 null)→ 返 null,UI 层提示"未找到词义"。
 */

import type { LookupResult } from './providers/macos-dictionary';
import { macosLookup } from './providers/macos-dictionary';
import { googleTranslate } from './providers/google-translate';

export type { LookupResult } from './providers/macos-dictionary';

export async function lookupWord(word: string): Promise<LookupResult | null> {
  // 1. macOS 原生词典(质量最高,无网络依赖)
  const result = await macosLookup(word);
  if (result) return result;

  // 2. Google Translate 兜底(单词释义降级 — 释义就是翻译文本)
  const trans = await googleTranslate(word, 'zh-CN');
  if (trans) {
    return {
      word,
      definition: trans.text,
      source: 'Google Translate',
    };
  }

  return null;
}
