/**
 * content-extraction capability — 对外类型契约(门面半)
 *
 * charter §3.2 既定互操作能力("任意来源 → atom")的首个实现 = 网页剪藏。
 * 门面(renderer)订阅 main 推回的 FullPageResult,跑 import-pipeline:
 * 媒体本地化 → markdownToAtoms 正文 → 追加 video/audio block drafts → createNotesBatch → 打开。
 *
 * 能力边界:content-extraction(源抓取 + 编排)**消费** content-ingest(格式→atom)、
 * media-storage、note 三个下游能力的 API(单向调用,不互相 install)。
 */

/** main → renderer 推回的整页提取结果(与 platform/main/content-extraction/types.ts 同构,
 *  此处独立声明避免 renderer 反向 import platform/main)。 */
export interface WebClipPayload {
  content: string;
  title: string;
  author?: string;
  published?: string;
  description?: string;
  wordCount: number;
  domain: string;
  favicon?: string;
  image?: string;
  url: string;
  contentImages?: Array<{ src: string; alt: string; w: number; h: number }>;
  contentVideos?: Array<{
    src: string;
    title: string;
    poster?: string;
    w: number;
    h: number;
    description?: string;
    author?: string;
    publishedAt?: string;
    duration?: number;
    domain?: string;
  }>;
  extractedAudioUrl?: string;
  youtubeTranscript?: string;
  site?: string;
  schemaOrgData?: Record<string, unknown>;
  extractorType?: string;
  language?: string;
}

export interface ContentExtractionApi {
  /**
   * 启动门面:订阅 WEB_CLIP_RESULT,收到 payload 跑 import-pipeline 建 note + 打开。
   * 幂等(重复调只订阅一次);返回 unsubscribe。
   */
  init(): () => void;
}
