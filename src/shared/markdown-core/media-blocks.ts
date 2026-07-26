/**
 * 媒体类 block 的 canonical 构造器 + 纯解析（阶段 B3）——①② 都调的唯一真源。
 *
 * **铁律（本任务第一红线）**：核**绝对纯 sync**，无副作用、无媒体 I/O。
 *  - base64→media:// 的 async 本地化（mediaPutBase64 IPC）**只能在外壳**（② 的
 *    resolvePMImageSrc / resolvePMAttachmentSrc；① 无本地化）。核只做**纯解析**：
 *    识别各格式、产 canonical 节点，**src 原样保留**（base64 / 远程 URL / `image:pageN`
 *    都原样，不本地化）。外壳负责把 src 换成 media://。
 *
 * 覆盖 block：image / video / audio / htmlBlock / fileBlock / externalRef。
 *
 * 收编来源（调研见 B3 交接 prompt）：
 *  - image：① 三格式（`<<IMAGE:pageN|caption|desc>>` 占位 / `image:pageN:x,y,w,h` 带 bbox /
 *    标准 URL），bbox/pageRef 从 src 解析出但 image schema **无 bbox/pageRef attr**
 *    （方言规范注明「当前 bbox 已是死数据」）→ 指挥拍板：核解析出 bbox/pageRef 但**不写进
 *    attrs**（保持现状=丢弃），留 TODO；② 单格式标准 markdown + async base64→media://。
 *  - video/audio/htmlBlock：① 独有（HTML `<video>/<audio>/<iframe>` + Obsidian `![[]]` +
 *    `!html[]()`）；② 完全没有 → 识别逻辑移进核，② 补齐。
 *  - fileBlock/externalRef：② 更完整（mediaId/mimeType/href normalize + async 本地化）。
 */

import type { PMNode } from './types';

// ─── image ──────────────────────────────────────────────────────────

/** image 扩展 src 三格式解析结果（src 原样，bbox/pageRef 解析出但 caller 现按 TODO 丢弃）。 */
export interface ParsedImageSrc {
  /** 原始 src：标准 URL/base64 原样；`image:pageN[:x,y,w,h]` 归一为 `'image'` */
  src: string;
  /** 页码（`image:pageN` / `<<IMAGE:pageN>>`），无则 undefined */
  pageRef?: number;
  /** PDF bbox（`image:pageN:x,y,w,h`），无则 undefined */
  bbox?: { x: number; y: number; w: number; h: number };
}

/**
 * 解析 image 的扩展 src 语法（从 ① result-parser.buildImageBlock 的 extMatch 移进核）：
 *  - `image:page19` / `image:page19-19` → { src:'image', pageRef:19 }
 *  - `image:page19:x1,y2,w3,h4` → { src:'image', pageRef:19, bbox:{...} }
 *  - 其他（标准 http/https/data:/media:// URL）→ { src: 原样 }
 *
 * **注**：pageRef/bbox 已解析出，但 V2 image schema 目前**无 bbox/pageRef attr**
 * （方言规范：「当前 bbox 已是死数据」）。buildImageNode 按指挥拍板**不写进 attrs**（=丢弃，
 * 保持迁移前行为）。
 * TODO(B3 后续/方言规范落地)：若 image schema 补 bbox/pageRef attr，改由 buildImageNode
 * 承接本函数返回的 pageRef/bbox（空间视图 / PDF 定位用），届时删本 TODO。
 */
export function parseImageSrc(rawSrc: string): ParsedImageSrc {
  const extMatch = rawSrc.match(
    /^image(?::page(\d+)(?:-\d+)?)?(?::x([\d.]+),y([\d.]+),w([\d.]+),h([\d.]+))?$/i,
  );
  if (extMatch && (extMatch[1] || extMatch[2])) {
    const out: ParsedImageSrc = { src: 'image' };
    if (extMatch[1]) out.pageRef = parseInt(extMatch[1], 10);
    if (extMatch[2]) {
      out.bbox = {
        x: parseFloat(extMatch[2]),
        y: parseFloat(extMatch[3]),
        w: parseFloat(extMatch[4]),
        h: parseFloat(extMatch[5]),
      };
    }
    return out;
  }
  return { src: rawSrc };
}

/**
 * image canonical 节点：`image{src,alt[,title]}` + 单空 paragraph（caption 占位）。
 *
 * src **原样**（core 不本地化 —— base64/URL 原样进原样出；② 外壳先 resolvePMImageSrc
 * 拿到 media:// 再传进来）。title 仅在非空时带（保持 ② 无 caption 时不写 title、① 有
 * caption 时写 title 的逐字段一致）。
 *
 * image spec content='block?'（0 或 1 caption）→ 用一个空 paragraph 占位（用户可后填）。
 * 空 content 会让 setNodeAttribute 走 ReplaceStep 严格校验失败抛 RangeError（spec 注）。
 */
export function buildImageNode(src: string, alt: string, title?: string): PMNode {
  const attrs: Record<string, unknown> = { src, alt };
  if (title) attrs.title = title;
  return {
    type: 'image',
    attrs,
    content: [{ type: 'paragraph' }],
  };
}

// ─── video / audio ──────────────────────────────────────────────────

/**
 * videoBlock canonical 节点。src 原样。embedType 由 caller 决定（不传则留 null，
 * NodeView mount 时按 src 推断）。title/mimeType/duration 可选。
 *
 * 注：① ExtractedBlock 的 video 还带 poster/author/publishedAt/description/domain/
 * width/height 等元数据，但 videoBlock schema **无对应 attr**（只有 src/embedType/title/
 * mimeType/duration/…），故这些元数据本就无处落 —— 不产 attr（与 schema 一致）。
 */
export function buildVideoNode(opts: {
  src: string;
  embedType?: string | null;
  title?: string;
  mimeType?: string | null;
  duration?: number | null;
}): PMNode {
  const attrs: Record<string, unknown> = { src: opts.src };
  if (opts.embedType != null) attrs.embedType = opts.embedType;
  if (opts.title) attrs.title = opts.title;
  if (opts.mimeType != null) attrs.mimeType = opts.mimeType;
  if (opts.duration != null) attrs.duration = opts.duration;
  return { type: 'videoBlock', attrs, content: [{ type: 'paragraph' }] };
}

/** audioBlock canonical 节点。src 原样。 */
export function buildAudioNode(opts: {
  src: string;
  title?: string;
  mimeType?: string | null;
  duration?: number | null;
}): PMNode {
  const attrs: Record<string, unknown> = { src: opts.src };
  if (opts.title) attrs.title = opts.title;
  if (opts.mimeType != null) attrs.mimeType = opts.mimeType;
  if (opts.duration != null) attrs.duration = opts.duration;
  return { type: 'audioBlock', attrs, content: [{ type: 'paragraph' }] };
}

// ─── htmlBlock ──────────────────────────────────────────────────────

/**
 * htmlBlock canonical 节点：`htmlBlock{src,title}` + 单空 paragraph（caption）。
 * src 原样（media:// 或远程 URL，core 不本地化）。
 */
export function buildHtmlBlockNode(src: string | null, title: string): PMNode {
  return {
    type: 'htmlBlock',
    attrs: { src: src ?? null, title },
    content: [{ type: 'paragraph' }],
  };
}

// ─── fileBlock / externalRef ────────────────────────────────────────

/**
 * fileBlock canonical 节点。src/mediaId/mimeType **原样**（② 外壳先 resolvePMAttachmentSrc
 * 本地化拿到 media:// + mediaId 再传进来）。size/source 留 null（导入态无此信息）。
 */
export function buildFileBlockNode(opts: {
  src: string;
  mediaId: string;
  filename: string;
  mimeType: string;
}): PMNode {
  return {
    type: 'fileBlock',
    attrs: {
      mediaId: opts.mediaId,
      src: opts.src,
      filename: opts.filename,
      mimeType: opts.mimeType,
      size: null,
      source: null,
    },
  };
}

/**
 * externalRef canonical 节点。href **原样**（② 外壳先 normalizePMFileHref 归一 file://
 * 再传进来 —— normalize 是 sync 但属 caller 的 href 语义，核不碰路径协议）。
 */
export function buildExternalRefNode(opts: {
  kind: string;
  href: string;
  title: string;
}): PMNode {
  return {
    type: 'externalRef',
    attrs: {
      kind: opts.kind,
      href: opts.href,
      title: opts.title,
      mimeType: '',
      size: null,
      modifiedAt: null,
    },
  };
}

// ─── HTML 媒体标签 / Obsidian embed / !html 纯解析（供 ② 补齐用）─────────

/** 从 tag 串取属性值（sync 正则，从 ① result-parser.extractHtmlAttr 移进核）。 */
function extractHtmlAttr(tag: string, attr: string): string | null {
  const re = new RegExp(`${attr}=["']([^"']+)["']`, 'i');
  const m = tag.match(re);
  return m ? m[1] : null;
}

/** 从 tag 串取数字属性值。 */
function extractHtmlAttrNum(tag: string, attr: string): number | null {
  const val = extractHtmlAttr(tag, attr);
  if (!val) return null;
  const num = parseInt(val, 10);
  return isNaN(num) ? null : num;
}

/** iframe src 必须 https://（安全兜底，不维护域名白名单；从 ① 移进核）。 */
function isValidIframeSrc(url: string): boolean {
  return url.startsWith('https://');
}

/**
 * 解析一行 HTML 媒体标签（`<iframe>` / `<video>` / `<audio>`）→ canonical video/audio 节点。
 * 从 ① result-parser.tryParseMediaTag 移进核（纯 sync 正则，src 原样）。命中返节点，否则 null。
 *
 * 与 ① 语义一致：
 *  - `<iframe src=https://…>` → videoBlock（embedType 交 NodeView 按 src 推断，不预设）
 *  - `<video src|<source src>>` → videoBlock（title/duration 从 tag/data-* 取）
 *  - `<audio src|<source src>>` → audioBlock
 *  - iframe 非 https / 无 src → null
 *
 * 注：① 旧 video 还取 poster/author/publishedAt/description/domain/width/height，但
 * videoBlock schema 无对应 attr（本就落不了），故核只取 schema 有的 title/mimeType/duration。
 */
export function tryParseMediaTag(line: string): PMNode | null {
  // <iframe src="..." ...> → video（https only）
  const iframeMatch = line.match(/^<iframe\s[^>]*src=["']([^"']+)["'][^>]*>/i);
  if (iframeMatch) {
    const tag = iframeMatch[0];
    const url = iframeMatch[1];
    if (!isValidIframeSrc(url)) return null;
    const title = extractHtmlAttr(tag, 'title') || 'Video';
    return buildVideoNode({ src: url, title });
  }

  // <video src="..." ...> 或 <video ...><source src="...">
  const videoMatch = line.match(/^<video\s[^>]*>/i);
  if (videoMatch) {
    const tag = videoMatch[0];
    let src = extractHtmlAttr(tag, 'src');
    if (!src) {
      const sourceMatch = line.match(/<source\s[^>]*src=["']([^"']+)["']/i);
      if (sourceMatch) src = sourceMatch[1];
    }
    if (!src) return null;
    const title = extractHtmlAttr(tag, 'title') || 'Video';
    const duration = extractHtmlAttrNum(tag, 'data-duration');
    return buildVideoNode({ src, title, duration });
  }

  // <audio src="..." ...> 或 <audio ...><source src="...">
  const audioMatch = line.match(/^<audio\s[^>]*>/i);
  if (audioMatch) {
    const tag = audioMatch[0];
    let src = extractHtmlAttr(tag, 'src');
    if (!src) {
      const sourceMatch = line.match(/<source\s[^>]*src=["']([^"']+)["']/i);
      if (sourceMatch) src = sourceMatch[1];
    }
    if (!src) return null;
    const title = extractHtmlAttr(tag, 'title') || 'Audio';
    return buildAudioNode({ src, title });
  }

  return null;
}

/**
 * Obsidian embed `![[videoId]]` → YouTube videoBlock（Defuddle 对 YouTube iframe 的输出）。
 * 命中返节点，否则 null。videoId 6+ 位字母数字下划线连字符。
 */
export function tryParseObsidianVideoEmbed(line: string): PMNode | null {
  const m = line.trim().match(/^!\[\[([a-zA-Z0-9_-]{6,})\]\]\s*$/);
  if (!m) return null;
  return buildVideoNode({
    src: `https://www.youtube.com/watch?v=${m[1]}`,
    title: 'YouTube Video',
  });
}
