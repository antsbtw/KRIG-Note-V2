/**
 * content-extraction 实现半 — Defuddle 整页提取结果类型
 *
 * 直接搬自 mirro-desktop web-extraction/fullpage-capture.ts(FullPageResult /
 * ContentImage / ContentVideo)。这些类型同时被 main 侧 capture/sanitize 与
 * renderer 侧 import-pipeline 消费(纯类型,跨进程经 IPC payload 传递)。
 */

/** Defuddle 整页提取结果 */
export interface FullPageResult {
  content: string;       // Markdown 正文
  title: string;
  author?: string;
  published?: string;
  description?: string;
  wordCount: number;
  domain: string;
  favicon?: string;
  image?: string;
  url: string;
  contentImages?: ContentImage[];  // Defuddle 遗漏的正文图片
  contentVideos?: ContentVideo[];  // Defuddle 遗漏的正文视频
  // JS 内嵌音频(从 __PRELOADED_STATE__ 等提取)
  extractedAudioUrl?: string;
  // YouTube 字幕(存入 Video Block 的 transcriptText 属性)
  youtubeTranscript?: string;  // JSON string: [{ time, text }]
  // Defuddle 元数据增强
  site?: string;              // 站点名称 (e.g. "Wikipedia", "Medium")
  schemaOrgData?: Record<string, unknown>;  // Schema.org 结构化数据
  extractorType?: string;     // Defuddle 使用的 extractor 类型 (e.g. "youtube", "wikipedia")
  language?: string;          // 页面语言 (e.g. "en", "zh")
}

export interface ContentImage {
  src: string;
  alt: string;
  w: number;
  h: number;
}

export interface ContentVideo {
  src: string;
  title: string;
  poster?: string;       // 缩略图
  w: number;
  h: number;
  description?: string;
  author?: string;
  publishedAt?: string;  // ISO string
  duration?: number;     // 秒
  domain?: string;
}
