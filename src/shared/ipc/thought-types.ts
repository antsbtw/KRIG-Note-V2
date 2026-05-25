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

// ── 类型枚举(6 种)──

/**
 * Thought 语义类型(2026-05-24 用户拍板:5+1):
 *   thought / question / important / todo / analysis(用户主动选)
 *   + ai-response(AI 自动创建,不进 TypeSwitcher)
 *
 * 历史曾含 highlight / underline / rect-frame 三种"视觉表征 type" — 已删除:
 *   - 用户拍板:视觉(颜色)由 type 反查 META.color,不再有独立 color 字段
 *   - 5 色 picker 字面映射到 5 种 type,**颜色 = 类型**单一真相源
 *   - 历史数据按 D-11 / 当前拍板"清空旧数据"处理,无 migration
 */
export type ThoughtType =
  | 'thought'
  | 'question'
  | 'important'
  | 'todo'
  | 'analysis'
  | 'ai-response';

/** Thought 元数据(icon / color / label)— UI 渲染单点真相 */
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
};

/**
 * 用户在 picker 中可选的 5 种 type(ai-response 不进 picker — AI 自动创建)。
 * 顺序即 picker 渲染顺序;UI 字面用 META[type] 取颜色/图标/标签。
 *
 * 2026-05-24 拍板:5 色 picker 字面对齐 5 种 type — 颜色 = 类型(单一真相源)。
 *   蓝   thought   思考(默认 / 通用引文)
 *   橙   important 重要
 *   红   question  疑问
 *   绿   todo      待办
 *   紫   analysis  分析
 */
export const USER_THOUGHT_TYPES: readonly ThoughtType[] = [
  'thought',
  'important',
  'question',
  'todo',
  'analysis',
] as const;

// ── Source + Locator(discriminated union)──

export type ThoughtSource = 'note' | 'book' | 'graph' | 'canvas';

/**
 * Note 内锚点(L7 block atomization Stage 4 升级,decision 026 §10.1):
 *
 * 新字段语义(取代 V1 pmPos + anchorType + text):
 * - blockId(必填):block atom ULID(== PM attrs.id == storage atom.id)。
 *   注:此 id 字面跨编辑稳定 — 用户在 note 任意位置插/删/拆/合 block,
 *   被标注的 block 自身 attrs.id 字面不变(decision 026 §5.6 + §6 字面),
 *   故 anchor 字面**不漂移**(对比 V1 pmPos 字面随插入 block 整体下移)。
 * - offset(可选):sub-position 偏移,V1 'inline' 锚点字面新表达。
 *   `{from, to}` 字面是 block 内**字符级**偏移(基于 block.textContent),
 *   不是 PM doc 全局 pos。
 *   - undefined:整 block 锚点(V1 'block' / 'node' 锚点统一形态)
 *   - 有值:inline 锚点(V1 'inline' 形态,选区跨字)
 * - preview(可选):UI 预览缓存,**仅 ThoughtCard / ThoughtPanel 字面显示用**,
 *   不参与定位逻辑(沿 2026-05-21 用户拍板,Stage 9 反向更新决议字面登记此扩展)。
 *   字面创建 anchor 时由 driver 字面截取 100 字写入;PM 编辑后**不自动同步**
 *   (preview 字面是"创建瞬间快照",UI 字面接受陈旧)。
 *
 * 旧 NoteLocator 字面**已字面替换**,无双形态共存期 — 用户拍板"清空本地旧数据"(D-11),
 * 故无 V1 数据兼容需要(Stage 6 migration 字面针对生产数据,本期开发期数据清掉重建)。
 */
export interface NoteLocator {
  /** block atom ULID(=PM attrs.id =storage atom.id)— 跨编辑稳定的锚点核心 */
  blockId: string;
  /** inline 级 sub-position(可选,字符级偏移,基于 block.textContent)*/
  offset?: { from: number; to: number };
  /** UI 预览(仅显示用,不参与定位,创建时字面截取 100 字快照,不自动同步)*/
  preview?: string;
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
 * - rect:       PDF rect/underline 标注的页面坐标(scale=1) — 框选模式用;
 *               PDF 文字流 highlight/strikethrough 模式 = 选区 boundingRect 兜底;EPUB 无
 * - textRects:  PR-α-3 新增 — PDF 文字流 highlight/strikethrough 选区跨行的 rects 数组
 *               (scale=1 坐标)。每行一个 rect(range.getClientRects);
 *               rect 字段同步存 boundingRect 兜底渲染。EPUB 无;rect/underline 框选不用。
 * - cfi:        EPUB CFI 锚点;PDF 无
 * - textContent:选区文本(EPUB 自始有;PDF 自 PR-α-3 起 highlight/strikethrough 也存)。
 *               已有标注右键查词/翻译走此字段(对齐 α-2 5 项菜单"已有标注可触发"语义)
 * - thumbnail:  PDF 框选/划线截图 base64 inline(独立 render 2x DPR,JPEG 压缩);EPUB 无
 * - markStyle:  'rect' | 'underline' | 'highlight' | 'strikethrough' — 标注视觉形态
 *               (rect=框 / underline=底线 / highlight=半透明背景 / strikethrough=中线),
 *               **不**等同于 thought 语义 type;颜色字面从 thought.type 反查 META.color
 * - createdAt:  时间戳(老 reading-thought block id 复用)
 *
 * 2026-05-24 拍板:删 `color` 字段(颜色 = type 反查 META,单一真相源)。
 * 老字段 `type: 'rect'|'underline'|'highlight'` 重命名为 `markStyle`。
 * PR-α-3 扩 'strikethrough' + textRects;'highlight' 字面同时复用 EPUB 既有路径。
 */
export interface BookLocator {
  pageNum: number;
  rect?: { x: number; y: number; w: number; h: number };
  textRects?: Array<{ x: number; y: number; w: number; h: number }>;
  cfi?: string;
  textContent?: string;
  thumbnail?: string;
  markStyle: 'rect' | 'underline' | 'highlight' | 'strikethrough';
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
  /** AI response 服务标识('chatgpt'/'claude'/'gemini'),仅 type='ai-response' 时填 */
  serviceId?: string;
  /**
   * 缩略图 base64(PDF 框选/划线 anchor 创建时截屏写入)。
   * 真实存储位置仍在 BookLocator.thumbnail;此字段在跨进程 ThoughtInfo
   * 边界类型层保留供 UI 同步读取(创建路径会把 BookLocator.thumbnail 也写入)。
   *
   * 2026-05-24 拍板:不再有 thought.color 字段 — 颜色 = type 反查 META 单一真相源。
   */
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
