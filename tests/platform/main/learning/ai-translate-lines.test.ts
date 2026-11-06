/**
 * 字幕逐行 AI 翻译(试用版,2026-11-05)—— 回复校验 + 拆行/合并。
 * 用户 11-05:「我的感觉是翻译不准确」(🌐 Google 逐行)→ 加 🤖 本机 Gemma 按上下文翻。
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../../src/platform/main/local-llm/ollama-client', () => ({ callOllamaChat: vi.fn() }));

import { takeTranslations } from '../../../../src/platform/main/learning/ai-translate-lines';
import { splitTimedLines, mergeTranslated } from '../../../../src/drivers/text-editing-driver/blocks/video-block/actions/ai-translate-button';

describe('takeTranslations', () => {
  it('按编号取出,批内编号从 firstNo 起', () => {
    expect(takeTranslations('{"41":"甲","42":"乙"}', 41, 2)).toEqual(['甲', '乙']);
  });
  it('漏行 → 报错说清楚漏了哪几行,不拿原文顶替', () => {
    expect(() => takeTranslations('{"1":"甲","3":"丙"}', 1, 3)).toThrow(/第 2 行/);
  });
  it('空译文也算漏', () => {
    expect(() => takeTranslations('{"1":"  "}', 1, 1)).toThrow(/漏翻/);
  });
  it('不是 JSON → 报错', () => {
    expect(() => takeTranslations('好的,以下是翻译', 1, 1)).toThrow(/不是 JSON/);
  });
  it('译文里的换行压成空格(一行字幕就是一行)', () => {
    expect(takeTranslations('{"1":"第一\\n第二"}', 1, 1)).toEqual(['第一 第二']);
  });
});

describe('splitTimedLines / mergeTranslated', () => {
  const text = '⚠️ 字幕由本机 AI 听写,可能有误\n[00:00] Hello there.\n\n[01:05] The S stands for secure.';
  it('只取带时间戳的行去翻;说明行不送', () => {
    const r = splitTimedLines(text);
    expect(r.texts).toEqual(['Hello there.', 'The S stands for secure.']);
    expect(r.timedIdx).toEqual([1, 2]);
  });
  it('译文填回原位,时间戳保留,说明行原样', () => {
    const r = splitTimedLines(text);
    expect(mergeTranslated(r.lines, r.timedIdx, ['你好。', 'S 代表"安全"。'])).toBe(
      '⚠️ 字幕由本机 AI 听写,可能有误\n[00:00] 你好。\n[01:05] S 代表"安全"。',
    );
  });
});
