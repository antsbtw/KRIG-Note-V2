/**
 * defuddle-engine — Defuddle 提取引擎(ExtractionEngine 实现)
 *
 * 把 Defuddle 专属逻辑(注入 UMD bundle + 预处理脚本 + parse + markdown 清洗)
 * 收口到一个引擎实现。引擎专属 npm 包(defuddle bundle 读盘)只在本模块 + 其依赖
 * (defuddle-script / defuddle-bundle / sanitize),符合 charter §1.3 npm 屏障。
 *
 * 引擎**无关**的后处理(YouTube 字幕 / 超时 race / 缓存)在 capture.ts,不在这里。
 */

import type { WebContents } from 'electron';
import { generateDefuddleScript } from './defuddle-script';
import { sanitizeDefuddleMarkdown } from './sanitize';
import { registerExtractionEngine, type ExtractionEngine } from './engine';
import type { FullPageResult } from './types';

const defuddleEngine: ExtractionEngine = {
  id: 'defuddle',
  async extract(guest: WebContents): Promise<FullPageResult | null> {
    let script: string;
    try {
      script = generateDefuddleScript();
    } catch (err) {
      // defuddle bundle 读盘失败(打包路径没配好等)
      console.error('[content-extraction/defuddle] generateDefuddleScript failed:', err);
      return null;
    }

    let jsonStr: unknown;
    try {
      jsonStr = await guest.executeJavaScript(script);
    } catch (err) {
      console.error('[content-extraction/defuddle] executeJavaScript error:', err);
      return null;
    }
    if (!jsonStr) return null;

    let result: FullPageResult & { success?: boolean; error?: string };
    try {
      result = JSON.parse(jsonStr as string);
    } catch (err) {
      console.error('[content-extraction/defuddle] JSON.parse failed:', err);
      return null;
    }
    if (!result.success) {
      console.warn('[content-extraction/defuddle] extraction failed:', result.error);
      return null;
    }

    // Defuddle 专属:正文 markdown 清洗(SVG / style / script / 非白名单 HTML 噪音)
    result.content = sanitizeDefuddleMarkdown(result.content || '');
    return result as FullPageResult;
  },
};

registerExtractionEngine(defuddleEngine);
