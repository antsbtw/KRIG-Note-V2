/**
 * thought IPC 共享类型(横切思考层 — 跨 source 思考网)
 *
 * 见 docs/RefactorV2/thought-view-port.md v0.5 §4。
 *
 * 设计要点:
 * - Thought 是横切思考层,不依附任何单一 view;通过 anchor 挂到 note/book/graph/canvas/null
 * - anchor 是 source-discriminated union,新 source 接入只加 locator 类型,不改 ThoughtInfo
 * - BookLocator 字面结构等价于 @drivers/text-editing-driver/blocks/_shared/book-anchor.BookAnchor
 *   (字面复制,避免 shared/ → @drivers/ 跨层 import;TS structural typing 保证互转 — 同
 *    NoteDocEnvelope 与 DriverSerialized 结构等价的 V2 既有先例)
 * - 跨进程纯类型层(0 npm 业务包 import,0 跨层 alias)
 */

import type { NoteDocEnvelope } from './note-folder-types';

// ── 类型枚举(9 种)──

/**
 * Thought 语义类型 — V1 6 种(thought/question/important/todo/analysis/ai-response)
 * + ebook reading-thought 吸收 3 种(highlight/underline/rect-frame)。
 */
export type ThoughtType =
  | 'thought'
  | 'question'
  | 'important'
  | 'todo'
  | 'analysis'
  | 'ai-response'
  | 'highlight'
  | 'underline'
  | 'rect-frame';

/** Thought 元数据(icon / color / label)— UI 渲染单点 */
export const THOUGHT_TYPE_META: Record<
  ThoughtType,
  { icon: string; color: string; label: string }
> = {
  thought:       { icon: '💭', color: '#4a9eff', label: '思考' },
  question:      { icon: '❓', color: '#ff5252', label: '疑问' },
  important:     { icon: '⭐', color: '#ffab40', label: '重要' },
  todo:          { icon: '☐',  color: '#4caf50', label: '待办' },
  analysis:      { icon: '🔍', color: '#ab47bc', label: '分析' },
  'ai-response': { icon: '🤖', color: '#6366f1', label: 'AI 回复' },
  // 下面三种 color 由 thought.color payload 字段提供(5 色 picker),
  // 这里 sentinel 仅作 fallback;UI 渲染时优先用 payload.color
  highlight:     { icon: '🖍️', color: '__from_payload_color__', label: '高亮' },
  underline:     { icon: '〰️', color: '__from_payload_color__', label: '划线' },
  'rect-frame':  { icon: '🔲', color: '__from_payload_color__', label: '框选' },
};

// ── Source + Locator(discriminated union)──

export type ThoughtSource = 'note' | 'book' | 'graph' | 'canvas';

/** Note 内锚点(V1 三态:inline mark / block frame / node attr) */
export interface NoteLocator {
  /** PM doc 位置(integer)— 用于排序 + 跳转 */
  pmPos: number;
  /** 三种 anchor 形态 */
  anchorType: 'inline' | 'block' | 'node';
  /** 冗余文本(避免每次回读 PM doc) */
  text: string;
}

/**
 * Book 内锚点 — 字面结构等价于 @drivers/text-editing-driver/blocks/_shared/book-anchor.BookAnchor。
 *
 * 字面复制(不 import)避免 shared/ → @drivers/ 跨层依赖;TS structural typing 保证
 * BookAnchor ↔ BookLocator 互转。两边修改字段时必须同步(同 NoteDocEnvelope ↔
 * DriverSerialized 同模式 — 见 note-folder-types.ts 头部注释)。
 *
 * 字段含义:
 * - pageNum:    PDF 页码(1-based);EPUB 标注此字段 = 0 占位
 * - rect:       PDF rect/underline 标注的页面坐标(scale=1);EPUB 无
 * - cfi:        EPUB CFI 锚点;PDF 无
 * - textContent:EPUB 选区文本;PDF 无
 * - thumbnail:  PDF rect 截图 base64 inline(沿决议 D-7=A);EPUB 无
 * - color:      5 色 picker: #ffd43b / #69db7c / #74c0fc / #b197fc / #ff6b6b
 * - type:       rect = PDF 框选, underline = PDF 划线, highlight = EPUB 选区
 * - createdAt:  时间戳(老 reading-thought block id 复用)
 */
export interface BookLocator {
  pageNum: number;
  rect?: { x: number; y: number; w: number; h: number };
  cfi?: string;
  textContent?: string;
  thumbnail?: string;
  color: string;
  type: 'rect' | 'underline' | 'highlight';
  createdAt: number;
}

/** Graph 节点锚点(本期预留,不实施) */
export interface GraphLocator {
  /** graph 内 node atom id */
  nodeId: string;
  /** 节点内 sub-position(如 label 内的字符位,预留) */
  subPos?: number;
  text?: string;
}

/** Canvas 图形锚点(本期预留,不实施) */
export interface CanvasLocator {
  shapeId: string;
  text?: string;
}

/**
 * Thought 锚点 — source-discriminated union。
 * null = 独立 thought(unanchored,详 §8.3 两态语义)。
 */
export type ThoughtAnchor =
  | { source: 'note';   resourceId: string; locator: NoteLocator }
  | { source: 'book';   resourceId: string; locator: BookLocator }
  | { source: 'graph';  resourceId: string; locator: GraphLocator }
  | { source: 'canvas'; resourceId: string; locator: CanvasLocator };

// ── Thought 信息(view ↔ capability 边界类型)──

export interface ThoughtInfo {
  id: string;
  type: ThoughtType;
  resolved: boolean;
  pinned: boolean;
  /**
   * ebook 高亮场景 5 色:#ffd43b / #69db7c / #74c0fc / #b197fc / #ff6b6b。
   * 非 ebook 场景可空,UI 按 type 取 THOUGHT_TYPE_META.color。
   */
  color?: string;
  /** AI response 服务标识('chatgpt'/'claude'/'gemini'),仅 type='ai-response' 时填 */
  serviceId?: string;
  /** PDF 框选缩略图 base64,仅 type='rect-frame' 且 source='book' 时填 */
  thumbnail?: string;
  /**
   * 思考正文(可空 — ebook 高亮场景全部信息在 anchor,doc 留空对象)。
   * format='pm-doc-json',version='0.1',结构与 NoteInfo.doc 一致(可复用 text-editing.Host)。
   */
  doc: NoteDocEnvelope;
  /** Thought View folder 归属(NavSide 主舞台用)*/
  folderId: string | null;
  /** 锚点(null = 独立 thought 无 source 依附,详 §8.3 两态) */
  anchor: ThoughtAnchor | null;
  createdAt: number;
  updatedAt: number;
}

// ── 跨槽通信协议(§5.9)──

export const THOUGHT_PROTOCOL = 'thought' as const;

export const THOUGHT_ACTION = {
  CREATE: 'create',                       // source view → Thought View
  ACTIVATE: 'activate',                   // source view → Thought View
  DELETE: 'delete',                       // Thought View → source view(清 mark / 删高亮)
  SCROLL_TO_ANCHOR: 'scroll-to-anchor',   // Thought View → source view(跳转)
  TYPE_CHANGE: 'type-change',             // 双向
  AI_RESPONSE_READY: 'ai-ready',
  AI_ERROR: 'ai-error',
} as const;

export type ThoughtAction = typeof THOUGHT_ACTION[keyof typeof THOUGHT_ACTION];
