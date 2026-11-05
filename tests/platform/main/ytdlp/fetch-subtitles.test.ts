/**
 * 任意视频抓字幕(2026-11-05):📝 原先写死只给 YouTube。
 * 用户原话(11-05):「这个不能写死，这是个人学习的关键」。
 * VTT 样本取自 yt-dlp 真实下载的人工字幕(公开视频,片段);自动字幕滚动样本为合成。
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../../src/platform/main/ytdlp/binary-manager', () => ({ getYtdlpPath: () => null }));
vi.mock('../../../../src/platform/main/ytdlp/downloader', () => ({ getFfmpegPath: () => null }));

import {
  pickSubtitle,
  subtitleFileToTranscript,
  rollupCaptionsToTranscript,
  fetchSubtitlesViaYtdlp,
} from '../../../../src/platform/main/ytdlp/fetch-subtitles';

describe('subtitleFileToTranscript', () => {
  it('VTT(真实样本形状)→ [MM:SS] 文字,多行合并成一行', () => {
    const vtt = [
      'WEBVTT', 'Kind: captions', 'Language: en', '',
      '00:00:01.200 --> 00:00:03.360', 'All right, so here we are, in front of the', 'elephants', '',
      '00:00:05.318 --> 00:00:07.974', 'the cool thing about these guys is that they', 'have really...', '',
      '00:01:12.616 --> 00:01:14.367', 'and that&#39;s &amp; cool', '',
    ].join('\n');
    expect(subtitleFileToTranscript(vtt)).toBe([
      '[00:01] All right, so here we are, in front of the elephants',
      '[00:05] the cool thing about these guys is that they have really...',
      '[01:12] and that&#39;s & cool',
    ].join('\n'));
  });

  it('SRT(逗号毫秒 + 序号行)', () => {
    const srt = '1\n00:00:02,500 --> 00:00:04,000\nHello\n\n2\n01:02:03,000 --> 01:02:05,000\nWorld\n';
    expect(subtitleFileToTranscript(srt)).toBe('[00:02] Hello\n[62:03] World');
  });

  it('自动字幕:去掉行内时间标签,同一句滚动重复只留一次', () => {
    const vtt = [
      'WEBVTT', '',
      '00:00:00.000 --> 00:00:02.000 align:start position:0%', 'so<00:00:00.500><c> today</c><00:00:01.000><c> we</c>', '',
      '00:00:02.000 --> 00:00:02.010', 'so today we', '',
      '00:00:02.010 --> 00:00:04.000', 'talk about wifi', '',
    ].join('\n');
    expect(subtitleFileToTranscript(vtt)).toBe('[00:00] so today we\n[00:02] talk about wifi');
  });
});

describe('pickSubtitle', () => {
  const t = [{ ext: 'vtt', url: 'u' }];
  it('人工字幕优先于自动字幕', () => {
    expect(pickSubtitle({ subtitles: { de: t }, automatic_captions: { en: t } })).toEqual({ lang: 'de', auto: false });
  });
  it('同类里英文 → 中文 → 其它;直播弹幕不算', () => {
    expect(pickSubtitle({ subtitles: { fr: t, 'zh-Hans': t, 'en-US': t } })).toEqual({ lang: 'en-US', auto: false });
    expect(pickSubtitle({ subtitles: { fr: t, 'zh-Hans': t } })).toEqual({ lang: 'zh-Hans', auto: false });
    expect(pickSubtitle({ subtitles: { live_chat: t } })).toBeNull();
  });
  it('没有任何字幕 → null(6abc 新闻视频就是这样)', () => {
    expect(pickSubtitle({})).toBeNull();
    expect(pickSubtitle({ subtitles: {}, automatic_captions: { en: [] } })).toBeNull();
  });
});

describe('fetchSubtitlesViaYtdlp', () => {
  it('yt-dlp 没装 → 说清楚怎么装,不假装成功', async () => {
    const r = await fetchSubtitlesViaYtdlp('https://news.example/v.mp4');
    expect(r.transcriptText).toBeNull();
    expect(r.error).toContain('yt-dlp');
  });
});

/**
 * 电视嵌入字幕(EIA-608)经 ffmpeg 抽出的 SRT —— 滚动式:每条重复前两行 + 底下新一行。
 * 形状照 6abc 新闻视频实抽结果(文字为片段)。
 */
describe('rollupCaptionsToTranscript', () => {
  const cue = (n: number, t: string, lines: string[]) =>
    `${n}\n${t} --> 00:00:59,000\n<font face="Monospace">{\\an7}${lines.join('\n')}</font>\n`;
  const srt = [
    cue(1, '00:00:00,534', ['>> SURVIVAL JUICE. I MEAN.']),
    cue(2, '00:00:01,101', ['>> SURVIVAL JUICE. I MEAN.', '>> SURVIVAL, RIGHT?']),
    cue(3, '00:00:14,147', ['>> SURVIVAL, RIGHT?', '>> IT COULD PUT YOUR PRIVACY AT']),
    cue(4, '00:00:15,615', ['>> SURVIVAL, RIGHT?', '>> IT COULD PUT YOUR PRIVACY AT', 'RISK IF YOU’RE NOT CAREFUL.']),
    cue(5, '00:00:19,553', ['>> IT COULD PUT YOUR PRIVACY AT', 'RISK IF YOU’RE NOT CAREFUL.', '>> PEOPLE ARE UNKNOWINGLY']),
    cue(6, '00:00:20,654', ['RISK IF YOU’RE NOT CAREFUL.', '>> PEOPLE ARE UNKNOWINGLY', 'PUTTING THEIR DATA AT RISK']),
  ].join('\n');

  it('每条只取新出现的行,碎行拼成句子,时间取句首;去掉 font / {\\an7} 标记', () => {
    expect(rollupCaptionsToTranscript(srt)).toBe([
      '[00:00] >> SURVIVAL JUICE. I MEAN.',
      '[00:01] >> SURVIVAL, RIGHT?',
      '[00:14] >> IT COULD PUT YOUR PRIVACY AT RISK IF YOU’RE NOT CAREFUL.',
      '[00:19] >> PEOPLE ARE UNKNOWINGLY PUTTING THEIR DATA AT RISK',
    ].join('\n'));
  });

  it('空 / 无时间轴 → 空串', () => {
    expect(rollupCaptionsToTranscript('')).toBe('');
    expect(rollupCaptionsToTranscript('hello\nworld')).toBe('');
  });
});
