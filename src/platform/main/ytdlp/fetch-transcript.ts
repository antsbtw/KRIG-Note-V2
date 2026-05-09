/**
 * fetch-transcript — YouTube 字幕抓取(独立函数,L5-B3.19.b)
 *
 * 不下载视频前提下抓字幕,供 video-block 📝 import 按钮调用。
 *
 * 跟 downloader.ts 内部的 fetchTranscript 调用功能等价但路径分离(Qb-8=A):
 * - 本函数:外部 API,只返 [MM:SS] 格式 timestamp text
 * - downloader.ts 内部:自带 .srt 文件生成,需要 segment.duration,跟本函数不共用
 * 接受 ~10 行重复换稳定。
 *
 * 分层方向(P1 修正):main 不反向 import @capabilities;本地声明 FetchTranscriptOutput
 * 接口,跟 capability 的 FetchTranscriptResult 结构等价不依赖。
 */

import { fetchTranscript as ytFetchTranscript } from 'youtube-transcript';

interface FetchTranscriptOutput {
  /** 成功:`[MM:SS] text` 格式纯文本(对齐 download 内部生成方式)*/
  transcriptText: string | null;
  /** 失败原因(用户可读 — "字幕不可用" / "网络错误" 等);成功时 null */
  error: string | null;
}

export async function fetchYouTubeTranscript(url: string): Promise<FetchTranscriptOutput> {
  try {
    const segments = await ytFetchTranscript(url);
    if (!segments || segments.length === 0) {
      return { transcriptText: null, error: '字幕不可用(视频未提供字幕)' };
    }
    const transcriptText = segments
      .map((seg: { text: string; offset: number }) => {
        const s = Math.floor(seg.offset / 1000);
        const mm = String(Math.floor(s / 60)).padStart(2, '0');
        const ss = String(s % 60).padStart(2, '0');
        return `[${mm}:${ss}] ${seg.text}`;
      })
      .join('\n');
    return { transcriptText, error: null };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { transcriptText: null, error: msg || '抓取字幕失败' };
  }
}
