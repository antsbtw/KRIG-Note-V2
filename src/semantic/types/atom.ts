/**
 * V2 语义层 Atom 通用接口
 * 详 docs/RefactorV2/data-model/atom/spec.md §1
 */

export type AtomDomain = string;

export interface Atom<D extends AtomDomain = AtomDomain> {
  domain: D;
  payload: AtomPayloadOf<D>;
}

export type AtomPayloadOf<D extends AtomDomain> =
  D extends 'pm'             ? PmPayload :
  D extends 'rdf'            ? RdfPayload :
  D extends 'embedding'      ? EmbeddingPayload :
  D extends 'three'          ? ThreePayload :
  D extends 'folder'         ? FolderPayload :
  D extends 'graph-canvas'   ? GraphCanvasPayload :
  D extends 'graph-instance' ? GraphInstancePayload :
  D extends 'ebook'          ? EBookPayload :
  D extends 'reading-state'  ? ReadingStatePayload :
  D extends 'thought'        ? ThoughtPayload :
  unknown;

export interface PmPayload {
  type: string;
  content?: PmPayload[];
  attrs?: Record<string, unknown>;
  marks?: Mark[];
  text?: string;
}

export interface RdfPayload {
  subject: string;
  predicate: string;
  object: string;
}

export interface EmbeddingPayload {
  vector: number[];
  dim: number;
  model: string;
}

export interface ThreePayload {
  kind: 'node' | 'edge' | 'face';
  position?: { x: number; y: number; z?: number };
  shape?: string;
  size?: { w: number; h: number; d?: number };
}

/** folder domain — 笔记 / 资源的文件夹容器 (decision 012 §3.1) */
export interface FolderPayload {
  title: string;
}

/**
 * graph-canvas domain — 画板容器 (decision 014 §3.1)
 *
 * Freeform 对标 (无限平面 + 扁平节点),保留 Figma-style 扩展接口 (bounds / themeRef)。
 * 本 sub-phase capability 仅消费前 4 个必填字段 + 可选 3 个;bounds / themeRef
 * 字段 schema 占位但 capability 不读不写 (留 sub-phase 4+ Frame 嵌套 / 主题系统)。
 */
export interface GraphCanvasPayload {
  title: string;
  variant: 'canvas' | 'family-tree' | 'knowledge' | 'mindmap';
  view: {
    centerX: number;
    centerY: number;
    zoom: number;
  };
  schemaVersion: number;

  background?: {
    type: 'solid' | 'dotted-grid' | 'lined-grid' | 'isometric-grid';
    color?: string;
  };
  gridVisible?: boolean;
  locked?: boolean;

  /** Figma-style 扩展接口 (sub-phase 4+,本 sub-phase capability 不读不写) */
  bounds?: { width: number; height: number } | null;
  /** Figma-style 扩展接口 (sub-phase 4+,本 sub-phase capability 不读不写) */
  themeRef?: string | null;
}

/**
 * graph-instance domain — 画板内节点统一模型 (decision 014 §3.2)
 *
 * V2 Instance + ref 模式 (substance 哲学:Library 中的 ShapeDef / SubstanceDef
 * 是"类",画板内 Instance 是"实例")。所有节点共享同一 domain,
 * 通过 payload.type + payload.ref 区分形态。
 *
 * ⚠ doc 字段不在本 payload — text-node (ref === 'krig.text.label') 的 PM 内容
 * 走 user:krig:hasContent 边 + pm atom 表达 (decision 014 §3.3)。view 端拼装
 * 仍按 Instance.doc 形态消费 (capability 内适配,view 透明)。
 *
 * InstanceEndpoint / StyleOverrides 在 semantic 层保持 unknown 兜底
 * (避免跨层依赖 @capabilities);capability 拼装 Instance 时做窄化。
 */
export interface GraphInstancePayload {
  type: 'shape' | 'substance';
  ref: string;
  position?: { x: number; y: number };
  size?: { w: number; h: number };
  rotation?: number;
  endpoints?: [GraphInstanceEndpoint, GraphInstanceEndpoint];
  params?: Record<string, number>;
  style_overrides?: GraphInstanceStyleOverrides;
  props?: Record<string, unknown>;
  size_lock?: { w?: boolean; h?: boolean };
  text_valign?: 'top' | 'middle' | 'bottom';
}

/** 留 future line 实例,本 sub-phase 不实施 line — semantic 层保持 unknown 兜底 */
export type GraphInstanceEndpoint = unknown;
/** capability 层窄化为 canvas-rendering/types.ts 内 StyleOverrides — semantic 层 unknown */
export type GraphInstanceStyleOverrides = unknown;

/**
 * ebook domain — Layer 2 Book metadata (decision 022 §1.3.1)
 *
 * 持久化 ebook 文件元数据 (binary 二进制留磁盘, payload.filePath 引用)。
 * Layer 3 阅读进度 / Layer 4 reading thought 走独立 atom + edge marker
 * (decision 022 §4.1.2 hasReadingState / hasReadingThought)。
 */
export interface EBookPayload {
  fileType: 'pdf' | 'epub' | 'djvu' | 'cbz';
  storage: 'managed' | 'link';
  filePath: string;
  originalPath?: string;
  fileName: string;
  displayName: string;
  pageCount?: number;
  addedAt: number;
}

/**
 * reading-state domain — Layer 3 阅读进度 + 书签 (decision 022 §1.3.1)
 *
 * cardinality 1:1 跟 ebook (decision 022 §4.1.2 hasReadingState),
 * 拆分理由: 翻页 / bookmark 高频改, 跟书本 metadata 解耦避免无效 IO。
 */
export interface ReadingStatePayload {
  lastOpenedAt: number;
  lastPosition: {
    page?: number;
    scale?: number;
    fitWidth?: boolean;
    cfi?: string;
  };
  bookmarks: number[];                                   // PDF pageNum 书签
  cfiBookmarks: Array<{ cfi: string; label: string }>;   // EPUB CFI 书签
}

/**
 * thought domain — 横切思考层(thought-view-port.md v0.5 §4.3)
 *
 * 一个独立 thought atom + 通过 user:krig:thoughtOf 边挂到 source 资源
 * (note/book/graph/canvas)。anchor 元数据(source/locator)存边 attrs,不存
 * payload — payload 仅保存"思考内容本身",查询时按 source 走边过滤。
 *
 * doc 字段:thought 正文 PM doc(可空对象 — ebook 高亮场景全部信息在 anchor,
 * doc 留空)。结构与 NoteInfo.doc 的裸 payload 一致(envelope wrap 在 capability 层做)。
 */
export interface ThoughtPayload {
  type:
    | 'thought'
    | 'question'
    | 'important'
    | 'todo'
    | 'analysis'
    | 'ai-response'
    | 'highlight'
    | 'underline'
    | 'rect-frame';
  resolved: boolean;
  pinned: boolean;
  /** 5 色 picker(ebook 用),非 ebook 留空靠 type 默认色 */
  color?: string;
  /** AI 服务标识('chatgpt'/'claude'/'gemini'),仅 type='ai-response' */
  serviceId?: string;
  /** PDF 框选缩略图 base64,仅 type='rect-frame' 且 source='book' */
  thumbnail?: string;
  /** 思考正文(裸 PmPayload,可空对象 — capability 层 wrap/unwrap envelope) */
  doc: PmPayload;
}

export type Mark =
  | { type: 'bold' }
  | { type: 'italic' }
  | { type: 'underline' }
  | { type: 'strike' }
  | { type: 'code' }
  | { type: 'highlight'; attrs?: { color?: string } }
  | { type: 'textStyle'; attrs?: { color?: string } }
  | { type: 'link'; attrs: { href: string; title?: string } };
