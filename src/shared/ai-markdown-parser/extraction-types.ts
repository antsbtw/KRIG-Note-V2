/**
 * 提取流水线共享类型
 *
 * ExtractedBlock — AI 回复解析 / Web 内容提取的统一中间格式
 * 被 ResultParser、blocks-to-pm-nodes、content-to-atoms 等模块共用。
 *
 * Ported from mirro-desktop's shared/types/extraction-types.ts (verified).
 * Design doc: docs/web/WebBridge-设计.md §六
 */

export interface ExtractedInline {
  type: 'text' | 'link' | 'math-inline' | 'code-inline' | 'bold' | 'italic' | 'file-link';
  text: string;
  href?: string;  // for 'link' and 'file-link' (media:// URL)
}

export interface ExtractedListItem {
  text: string;
  inlines?: ExtractedInline[];
  blocks?: ExtractedBlock[];
}

export interface ExtractedBlock {
  type: 'paragraph' | 'heading' | 'blockquote' | 'callout' | 'code' | 'math' | 'image' | 'video' | 'audio' | 'bulletList' | 'orderedList' | 'table' | 'file' | 'htmlBlock';
  tag: string;
  text: string;
  headingLevel: number;
  src?: string;
  filename?: string;
  mimeType?: string;
  size?: number;
  alt?: string;
  width?: number;
  height?: number;
  items?: ExtractedListItem[];
  inlines?: ExtractedInline[];
  caption?: string;
  pageRef?: number;
  bbox?: { x: number; y: number; w: number; h: number };
  tableRows?: string[][];
  tableHasHeader?: boolean;
  poster?: string;
  description?: string;
  author?: string;
  publishedAt?: string;
  duration?: number;
  domain?: string;
  transcript?: string;
  language?: string;
  calloutType?: string;
  calloutEmoji?: string;
  codeTitle?: string;       // 带标题的代码块（Canvas 等场景）
}
