/**
 * note doc → 「X Article 原生 Insert 驱动计划」(终态方案,2026-06-13 总指挥拍板)。
 *
 * 缘起(实测见 docs/tasks/2026-06-13-x-articles-native-insert-impl-prompt.md §0):总指挥逐项
 * 实测 X Article 的 Insert 菜单,确认 **X 原生支持 LaTeX / Table / Code / Posts / Media**,
 * 且交互模式高度统一(点 Insert → 选项 → 弹模态 → 填文本框 → 点 Update)。所以终态发布
 * 路径 = **驱动 X 自己的原生 Insert**,几乎不渲图(质量最高、保真、可搜索可复制)。
 *
 * 本模块是**纯函数逻辑层**(无 view / DOM / IPC 副作用,可离线单测):
 * 遍历 note doc → 产出一个**有序的 InsertStep 列表**,每个 step 描述「驱动器要对 X 做什么」:
 *  - 连续的「可直接粘贴」块(段落/标题/列表/引用/普通图)→ 批量序列化成一个 `html` step
 *    (复用 article-doc-to-html,X 认网页富文本粘贴 —— 实测 #7 富格式保留 ✅)。
 *  - mathBlock / mathInline-only 段(块级公式)→ `latex` step(填 X LaTeX 模态)。
 *  - codeBlock(普通语言)→ `code` step(填 X Code 模态:语言 + 源码)。
 *  - table → `table` step(serializeTable 产 markdown,填 X Table 模态)。
 *  - tweetBlock → `posts` step(填 X Posts 模态的 tweetUrl)。
 *  - horizontalRule → `divider` step(仅点击)。
 *  - 已渲染成图的兜底块(Mermaid / mathVisual,X 无原生对应)→ `media` step(喂文件,与图同路)。
 *
 * ★ 关键:**走原始 note doc**(非 transformDocToArticleDoc 产物),才能拿到 mathBlock 的 latex、
 *   codeBlock 的 language、table 的结构、tweetBlock 的 tweetUrl 原始源数据。article-doc 那条是
 *   为「整篇 HTML 粘贴 + 渲图」的旧路设计的,会把这些块降级/转图,源数据丢失,不能用。
 *
 * ★ mediaMap:调用方先用 render-blocks-to-media 把 **Mermaid / mathVisual** 渲成 media://
 *   (其余块走原生,不渲),按 blockMediaKey 填进 mediaMap;本函数据此把这俩块替换成 `media` step。
 *   mathBlock / codeBlock(普通)**不进 mediaMap**(它们走 latex / code 原生 step)。
 *
 * 文字段落里的连续「可粘贴块」的 HTML 序列化:复用 doc-to-article-doc + article-doc-to-html
 * (把这一段切出来当一个临时 doc 转 HTML),保证富格式降级与整篇 HTML 路完全一致,不另写映射。
 *
 * fail loud(铁律 4):本纯函数只产计划,不吞错;某块缺源数据(如 codeBlock 空)按矩阵降级
 *   到文本 html step(退源码),并在 step 上标 degraded,驱动器/调用方据此提示,不静默假装成功。
 */

import type { Node as PMNode, Schema } from 'prosemirror-model';
import { transformDocToArticleDoc, blockMediaKey, type ArticleMediaMap } from './doc-to-article-doc';
import { articleDocToHtml } from './article-doc-to-html';
import { serializeTableToMarkdown } from './pm-to-markdown';

// ═══════════════════════════════════════════════════════
// §1  InsertStep 类型(IPC 可序列化:纯数据,无 PMNode / 函数)
// ═══════════════════════════════════════════════════════

/** X Article 原生 Insert 菜单项(驱动器据此选菜单 + 填模态)。 */
export type ArticleInsertKind = 'html' | 'latex' | 'code' | 'table' | 'posts' | 'divider' | 'media';

interface BaseStep {
  kind: ArticleInsertKind;
  /**
   * 降级标记:本 step 是「原本想走原生但源数据缺失 / 渲图失败」退下来的(已并入文本)。
   * 驱动器照常执行,调用方汇总提示用户(fail loud,不静默)。
   */
  degraded?: boolean;
}

/** 连续可粘贴块 → 一段 X 支持的 HTML(在 X 正文合成 paste)。 */
export interface HtmlStep extends BaseStep {
  kind: 'html';
  html: string;
}

/** 块级公式 → 填 X LaTeX 模态文本框(latex 源码,无 `$` 包裹)→ Update。 */
export interface LatexStep extends BaseStep {
  kind: 'latex';
  latex: string;
}

/** 普通代码块 → 填 X Code 模态(语言搜索框 + 代码框)→ Update。 */
export interface CodeStep extends BaseStep {
  kind: 'code';
  language: string;
  code: string;
}

/** 表格 → 填 X Table 模态(markdown 表格,placeholder "Add markdown here")→ Update。 */
export interface TableStep extends BaseStep {
  kind: 'table';
  markdown: string;
}

/** 嵌推 → 填 X Posts 模态("Paste post URL")→ 自动嵌。 */
export interface PostsStep extends BaseStep {
  kind: 'posts';
  tweetUrl: string;
}

/** 分割线 → 仅点 Insert → Divider。 */
export interface DividerStep extends BaseStep {
  kind: 'divider';
}

/**
 * 图(image / 渲图兜底)→ 喂文件给 X Media 控件(网页内 Crop media,非 OS 框)。
 * mediaUrl 是 media://(驱动器 main 侧 resolveMediaPath 解析磁盘路径再 feedFilesToInput)。
 */
export interface MediaStep extends BaseStep {
  kind: 'media';
  mediaUrl: string;
  alt?: string;
}

export type ArticleInsertStep =
  | HtmlStep
  | LatexStep
  | CodeStep
  | TableStep
  | PostsStep
  | DividerStep
  | MediaStep;

/** 整篇驱动计划。 */
export interface ArticlePlan {
  /** Article 标题(note isTitle 首块 → X Article 标题字段)。无则空串。 */
  title: string;
  /** 有序驱动步骤。驱动器按序逐个执行(每步等模态关闭再下一个)。 */
  steps: ArticleInsertStep[];
}

export interface BuildArticlePlanOptions {
  /**
   * 已渲染兜底块(Mermaid / mathVisual)→ media:// 映射。key = blockMediaKey(node)。
   * 不传 = 空表 → 这些块降级文本(离线单测默认走这条)。
   */
  mediaMap?: ArticleMediaMap;
}

// ═══════════════════════════════════════════════════════
// §2  分类:哪些块「自成一个原生 Insert step」,哪些「批量进 HTML」
// ═══════════════════════════════════════════════════════

/**
 * 自成原生 Insert step 的顶层块类型(其余顶层块批量走 html)。
 * ★ image 在此(总指挥 2026-06-13 实测确认):`<img src=media://>` **粘不进** X Article
 *   (变 📷 占位)→ 普通图也必须走 Media 喂文件(media step),不能塞进 html 粘贴。
 *   普通图的 src 本身就是 media://(直接喂,不查 mediaMap);
 *   「渲图兜底」(Mermaid/mathVisual)是先渲成 media:// 进 mediaMap,也走 media step。
 */
function isNativeInsertBlock(node: PMNode): boolean {
  const name = node.type.name;
  return (
    name === 'image' || // 总指挥实测:img 粘不进 X → 走 Media 喂文件
    name === 'mathBlock' ||
    name === 'codeBlock' ||
    name === 'table' ||
    name === 'tweetBlock' ||
    name === 'horizontalRule' ||
    name === 'mathVisual' // 兜底转图(若 mediaMap 有)→ media step;否则降级
  );
}

/** image caption 纯文本(content='block?' 单段 paragraph,可空)。 */
function imageCaptionText(node: PMNode): string {
  let text = '';
  node.forEach((child) => {
    if (child.isTextblock) text += child.textContent;
  });
  return text.trim();
}

/** mathBlock 取 latex 源码(content='text*' 存源码;兼容老 attrs.latex)。 */
function mathBlockLatex(node: PMNode): string {
  return ((node.attrs?.latex as string) || node.textContent || '').trim();
}

// ═══════════════════════════════════════════════════════
// §3  把「连续可粘贴块」一段切出来 → X 支持的 HTML
// ═══════════════════════════════════════════════════════

/**
 * 把一组顶层「可粘贴块」(段落/标题/列表/引用/图…非原生 Insert 块)序列化成 X HTML。
 * 复用整篇 HTML 路的同一套降级:先 transformDocToArticleDoc(走文本降级 + marks 过滤),
 * 再 articleDocToHtml。把这组块包成一个临时 doc 传进去(转换是逐块的,顺序无关)。
 *
 * mediaMap 透传:这组里若混着普通 image(media://)原样保留;若混着 mathBlock/codeBlock
 * 不会出现在这里(它们是 native 块,已被切走)。
 */
function pasteableBlocksToHtml(
  blocks: PMNode[],
  schema: Schema,
  mediaMap: ArticleMediaMap,
): string {
  if (blocks.length === 0) return '';
  const docType = schema.nodes.doc;
  if (!docType) throw new Error('note-to-article-plan: schema 缺 doc 节点');
  const tempDoc = docType.create(null, blocks);
  const articleDoc = transformDocToArticleDoc(tempDoc, schema, { mediaMap });
  return articleDocToHtml(articleDoc);
}

// ═══════════════════════════════════════════════════════
// §4  单个 native 块 → InsertStep
// ═══════════════════════════════════════════════════════

/**
 * 把一个 native Insert 块转成对应 step。
 * mediaMap 命中(Mermaid/mathVisual 已渲图)→ media step;否则按类型走原生 / 降级。
 * @returns step,或 null(本块无内容可发,如空表)。
 */
function nativeBlockToStep(
  node: PMNode,
  mediaMap: ArticleMediaMap,
): ArticleInsertStep | null {
  const name = node.type.name;

  // ① 普通 image:src 本身是 media://(直接喂 Media,不查 mediaMap)。总指挥实测 img 粘不进 X。
  //    caption/alt 文字 → 并入 media step 的 alt(图后说明,X Media 有 ALT 字段;不丢内容)。
  if (name === 'image') {
    const src = ((node.attrs?.src as string) || '').trim();
    if (!src) return null; // 无源图跳过
    const alt = imageCaptionText(node) || ((node.attrs?.alt as string) || '').trim() || undefined;
    return { kind: 'media', mediaUrl: src, alt };
  }

  // ② 兜底转图块:mediaMap 命中 → media step（Mermaid / mathVisual，X 无原生对应）
  const mediaUrl = mediaMap.get(blockMediaKey(node));
  if (mediaUrl) {
    return { kind: 'media', mediaUrl, alt: `${name} rendered` };
  }

  switch (name) {
    case 'mathBlock': {
      const latex = mathBlockLatex(node);
      // 空公式 → 跳过(无意义);有 latex → 走 LaTeX 原生
      if (!latex) return null;
      return { kind: 'latex', latex };
    }
    case 'codeBlock': {
      const language = ((node.attrs?.language as string) || '').trim();
      const code = node.textContent ?? '';
      // mermaid 代码块若没渲成图(mediaMap 没命中)→ 降级:当普通 code 块原生插(X 不渲图，
      // 但源码可读可复制，好过丢)。标 degraded 让调用方提示。
      const degraded = language.toLowerCase() === 'mermaid';
      if (!code.trim()) return null;
      return { kind: 'code', language, code, ...(degraded ? { degraded: true } : {}) };
    }
    case 'table': {
      const markdown = serializeTableToMarkdown(node).trim();
      if (!markdown) return null;
      return { kind: 'table', markdown };
    }
    case 'tweetBlock': {
      const tweetUrl = ((node.attrs?.tweetUrl as string) || '').trim();
      if (!tweetUrl) {
        // 无 URL（罕见）→ 降级文本（作者 + 正文）走 html 段更合适，这里返 null，由调用方上层
        // 不会走到（tweetBlock 总有 url）。保守降级为空跳过。
        return null;
      }
      return { kind: 'posts', tweetUrl };
    }
    case 'horizontalRule':
      return { kind: 'divider' };
    case 'mathVisual':
      // mediaMap 没命中（渲图失败 / 未渲）→ 降级占位文本，交 html 段处理更自然；
      // 但 mathVisual 是顶层 native 块，这里单独返一个降级 html step。
      return { kind: 'html', html: '<p>[函数图像]</p>', degraded: true };
    default:
      return null;
  }
}

// ═══════════════════════════════════════════════════════
// §5  入口:note doc → ArticlePlan
// ═══════════════════════════════════════════════════════

/** 抽 note 标题:isTitle 首块的纯文本。 */
function extractTitle(doc: PMNode): string {
  const first = doc.firstChild;
  if (first && first.attrs?.isTitle) {
    return (first.textContent || '').trim();
  }
  return '';
}

/**
 * note doc → X Article 原生 Insert 驱动计划。
 *
 * @param doc    原始 note doc（顶层 doc 节点）—— 必须是**原始** doc，非 article-doc 产物。
 * @param schema note schema（HTML 段序列化复用 article 转换需要）。
 * @param opts   mediaMap（Mermaid/mathVisual 已渲图映射）。
 */
export function buildArticlePlan(
  doc: PMNode,
  schema: Schema,
  opts: BuildArticlePlanOptions = {},
): ArticlePlan {
  const mediaMap = opts.mediaMap ?? new Map<string, string>();
  const title = extractTitle(doc);

  const steps: ArticleInsertStep[] = [];
  // 待批量成 html 的连续可粘贴块缓冲
  let htmlBuffer: PMNode[] = [];

  const flushHtml = (): void => {
    if (htmlBuffer.length === 0) return;
    const html = pasteableBlocksToHtml(htmlBuffer, schema, mediaMap);
    if (html.trim()) steps.push({ kind: 'html', html });
    htmlBuffer = [];
  };

  doc.forEach((child, _offset, index) => {
    // 跳过 isTitle 首块（→ Article 标题字段，不进正文）
    if (index === 0 && child.attrs?.isTitle) return;

    if (isNativeInsertBlock(child)) {
      flushHtml(); // 先把累积的可粘贴段刷成 html step（保文档顺序）
      const step = nativeBlockToStep(child, mediaMap);
      if (step) steps.push(step);
      return;
    }
    // 普通可粘贴块 → 进缓冲，等遇到 native 块或结尾再批量序列化
    htmlBuffer.push(child);
  });
  flushHtml(); // 收尾

  return { title, steps };
}
