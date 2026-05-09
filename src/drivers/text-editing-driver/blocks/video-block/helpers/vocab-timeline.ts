/**
 * vocab-timeline — 在 cues 中定位生词的时间轴(L5-B3.19.d)
 *
 * V1 → V2 直迁(算法对齐 V1)。
 *
 * buildVocabTimeline:O(cues × words),典型 ~500 cues × ~100 词 = 50k 次正则,
 * 实测 < 100ms,可接受。
 *
 * 短语 vocab(如 "machine learning")用 \b 边界匹配 — 对齐 B3.20b
 * vocab-highlight plugin 行为(Qd-7=A)。
 */

import type { SubtitleCue } from './subtitle-parser';

export interface VocabTimeEntry {
  word: string;
  definition: string;
  /** 该词在 cue 里出现的时间(秒)*/
  time: number;
}

export function buildVocabTimeline(
  cues: SubtitleCue[],
  vocabWords: Array<{ word: string; definition: string }>,
): VocabTimeEntry[] {
  if (cues.length === 0 || vocabWords.length === 0) return [];
  const entries: VocabTimeEntry[] = [];
  const wordMap = new Map<string, string>();
  for (const v of vocabWords) wordMap.set(v.word.toLowerCase(), v.definition);

  for (const cue of cues) {
    const textLower = cue.text.toLowerCase();
    for (const [word, def] of wordMap) {
      const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`\\b${escaped}\\b`, 'i');
      if (regex.test(textLower)) {
        entries.push({ word, definition: def, time: cue.startTime });
      }
    }
  }
  entries.sort((a, b) => a.time - b.time);
  return entries;
}

/** 当前时间附近的 ±windowSize 条 entry + active 在 entries 中的索引 */
export function getVocabWindow(
  timeline: VocabTimeEntry[],
  currentTime: number,
  windowSize = 5,
): { entries: VocabTimeEntry[]; currentIndex: number } {
  if (timeline.length === 0) return { entries: [], currentIndex: -1 };
  let idx = 0;
  for (let i = 0; i < timeline.length; i++) {
    if (timeline[i].time <= currentTime) idx = i;
    else break;
  }
  const start = Math.max(0, idx - windowSize);
  const end = Math.min(timeline.length, idx + windowSize + 1);
  return { entries: timeline.slice(start, end), currentIndex: idx - start };
}
