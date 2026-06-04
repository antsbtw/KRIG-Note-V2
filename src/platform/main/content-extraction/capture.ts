/**
 * capture — captureFullPage(guest): 引擎无关的整页提取编排
 *
 * 职责(与具体引擎解耦):
 *  1. 取当前活跃 ExtractionEngine,套 10s 超时 race 跑 extract(guest)。
 *  2. 引擎无关的后处理:YouTube 字幕(youtube-transcript,所有引擎通用)。
 *  3. 失败 / 超时 / 引擎缺失 → 返回 null(调用方降级,不阻断)。
 *
 * 具体"webview → FullPageResult"在各 *-engine.ts(当前 defuddle-engine)。
 * 换/加引擎只动 engine 注册,本文件零改动 —— 不把链路锁死在 Defuddle 一家。
 *
 * 业务 npm 包(youtube-transcript / 各引擎的 bundle)只在 main 侧,符合 §1.3 npm 屏障。
 */

import type { WebContents } from 'electron';
import { fetchTranscript } from 'youtube-transcript';
import { getActiveEngine } from './engine';
// 引擎实现的副作用注册(加载即 registerExtractionEngine):
import './defuddle-engine';
import type { FullPageResult } from './types';

const CAPTURE_TIMEOUT_MS = 10000;

/**
 * 整页提取:用当前活跃引擎抽取,套超时,补 YouTube 字幕。
 * 超时 / 失败 / 引擎缺失 / 报错均返回 null。
 */
export async function captureFullPage(
  guest: WebContents,
): Promise<FullPageResult | null> {
  const engine = getActiveEngine();
  if (!engine) {
    console.error('[content-extraction] no active extraction engine registered');
    return null;
  }

  let result: FullPageResult | null;
  try {
    result = await Promise.race([
      engine.extract(guest),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), CAPTURE_TIMEOUT_MS)),
    ]);
  } catch (err) {
    console.error(`[content-extraction] engine '${engine.id}' threw:`, err);
    return null;
  }
  if (!result) return null;

  // 引擎无关后处理:YouTube 字幕(youtube-transcript / InnerTube API)。
  // 存入 youtubeTranscript 字段(JSON string: [{ time, text }]),
  // 由 import-pipeline 填进 Video Block 的 transcriptText 属性。
  const isYouTube = /^(www\.)?(youtube\.com|youtu\.be)$/i.test(result.domain || '');
  if (isYouTube && result.url) {
    try {
      console.log('[content-extraction] Fetching YouTube transcript via InnerTube API...');
      const segments = await fetchTranscript(result.url);
      if (segments && segments.length > 0) {
        const transcriptData = segments.map((s) => ({
          time: Math.round(s.offset / 1000), // offset 是 ms → 秒
          text: s.text,
        }));
        console.log('[content-extraction] YouTube transcript fetched:', segments.length, 'segments');
        result.youtubeTranscript = JSON.stringify(transcriptData);
      }
    } catch (err) {
      console.warn('[content-extraction] YouTube transcript fetch failed:', (err as Error).message);
    }
  }

  return result;
}
