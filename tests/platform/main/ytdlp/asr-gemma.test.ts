/**
 * 本机 Gemma 4 听写(试用版,2026-11-05)—— 切段 / 停顿解析 / 段内时间估算 三个纯函数。
 * 背景:真机实验 25 秒硬切时,切口处的词会听坏(「Wi-Fi hotspot」→「I've had a heart spot」),所以切在停顿处。
 */
import { describe, it, expect } from 'vitest';
import { planChunks, parseSilences, parseDuration, chunkTextToLines } from '../../../../src/platform/main/ytdlp/asr-gemma';

describe('planChunks', () => {
  it('切点选在 15~30 秒里离 25 秒最近的停顿中点', () => {
    const chunks = planChunks(70, [{ start: 21, end: 22 }, { start: 26.5, end: 27.5 }, { start: 47, end: 48 }]);
    expect(chunks).toEqual([[0, 27], [27, 47.5], [47.5, 70]]);
  });
  it('没有停顿就硬切在 25 秒', () => {
    expect(planChunks(60, [])).toEqual([[0, 25], [25, 50], [50, 60]]);
  });
  it('窗口外的停顿不用(太早 / 太晚)', () => {
    expect(planChunks(40, [{ start: 5, end: 6 }, { start: 35, end: 36 }])).toEqual([[0, 25], [25, 40]]);
  });
  it('短视频一段搞定', () => {
    expect(planChunks(28, [{ start: 10, end: 11 }])).toEqual([[0, 28]]);
  });
});

describe('parseSilences / parseDuration', () => {
  const stderr = [
    '  Duration: 00:02:15.12, start: 0.000000, bitrate: 256 kb/s',
    '[silencedetect @ 0x1] silence_start: 24.512',
    '[silencedetect @ 0x1] silence_end: 25.108 | silence_duration: 0.596',
    '[silencedetect @ 0x1] silence_start: -0.01',
    '[silencedetect @ 0x1] silence_end: 0.4 | silence_duration: 0.41',
  ].join('\n');
  it('成对解析 start/end,负数起点归零', () => {
    expect(parseSilences(stderr)).toEqual([{ start: 24.512, end: 25.108 }, { start: 0, end: 0.4 }]);
  });
  it('时长', () => {
    expect(parseDuration(stderr)).toBeCloseTo(135.12);
    expect(parseDuration('no duration')).toBeNull();
  });
});

describe('chunkTextToLines', () => {
  it('一句一行;段起点准,段内按字数比例估;去掉模型加的引号', () => {
    const text = '"Hello there. This is a much longer second sentence here!"';
    const lines = chunkTextToLines(text, 60, 80);
    expect(lines).toEqual(['[01:00] Hello there.', '[01:04] This is a much longer second sentence here!']);
  });
  it('末尾没有标点的半句也保留(下一段接着说)', () => {
    expect(chunkTextToLines('One. but it could be a', 0, 10)).toEqual(['[00:00] One.', '[00:02] but it could be a']);
  });
  it('空文字 → 空', () => {
    expect(chunkTextToLines('  ', 0, 10)).toEqual([]);
  });
});
