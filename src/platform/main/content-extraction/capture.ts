/**
 * capture — captureFullPage(guest): 注入 Defuddle 到网页,返回解析结果
 *
 * 蓝本:mirro fullpage-capture.ts fullPageCapture()。
 * 改动:入参从 mirro 的 WebContentsView 改成 V2 的 guest WebContents
 * (web-context-menu handler 闭包捕获的 guest);youtube-transcript 走 fetchTranscript;
 * 返回 sanitize 后的 FullPageResult。超时 10s race(YouTube 字幕需额外时间)。
 *
 * 业务 npm 包(defuddle bundle 读盘 / youtube-transcript)只在本 main 侧模块,
 * 符合 charter §1.3 npm 屏障(renderer 零 import)。
 */

import type { WebContents } from 'electron';
import { fetchTranscript } from 'youtube-transcript';
import { generateDefuddleScript } from './defuddle-script';
import { sanitizeDefuddleMarkdown } from './sanitize';
import type { FullPageResult } from './types';

const CAPTURE_TIMEOUT_MS = 10000;

/**
 * 整页提取:注入 Defuddle 到 guest webview,返回解析结果。
 * 超时 / 失败 / Defuddle 报错均返回 null(调用方降级处理,不阻断)。
 */
export async function captureFullPage(
  guest: WebContents,
): Promise<FullPageResult | null> {
  let script: string;
  try {
    script = generateDefuddleScript();
  } catch (err) {
    // defuddle bundle 读盘失败(打包路径没配好等)
    console.error('[content-extraction] generateDefuddleScript failed:', err);
    return null;
  }

  try {
    const jsonStr = await Promise.race([
      guest.executeJavaScript(script),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), CAPTURE_TIMEOUT_MS)),
    ]);

    if (!jsonStr) return null;

    const result = JSON.parse(jsonStr as string);
    if (!result.success) {
      console.warn('[content-extraction] Defuddle extraction failed:', result.error);
      return null;
    }

    // main 侧 sanitize 正文 markdown(SVG / style / script / 非白名单 HTML 噪音)
    result.content = sanitizeDefuddleMarkdown(result.content || '');

    // YouTube 字幕:通过 youtube-transcript 库(InnerTube API)获取,
    // 存入 youtubeTranscript 字段(JSON string: [{ time, text }]),
    // 由 import-pipeline 填进 Video Block 的 transcriptText 属性。
    const isYouTube = /^(www\.)?(youtube\.com|youtu\.be)$/i.test(result.domain || '');
    if (isYouTube && result.url) {
      try {
        console.log('[content-extraction] Fetching YouTube transcript via InnerTube API...');
        const segments = await fetchTranscript(result.url);
        if (segments && segments.length > 0) {
          const transcriptData = segments.map((s) => ({
            time: Math.round(s.offset / 1000),  // offset 是 ms → 秒
            text: s.text,
          }));
          console.log('[content-extraction] YouTube transcript fetched:', segments.length, 'segments');
          result.youtubeTranscript = JSON.stringify(transcriptData);
        }
      } catch (err) {
        console.warn('[content-extraction] YouTube transcript fetch failed:', (err as Error).message);
      }
    }

    return result as FullPageResult;
  } catch (err) {
    console.error('[content-extraction] captureFullPage error:', err);
    return null;
  }
}
