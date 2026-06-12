/**
 * 把 note 里「纯文本装不下」的 block(公式 / 代码 / Mermaid)渲染成图,存进 media store,
 * 返回 media:// URL —— 接 X 发推的 2.5-b 附件管道(X 截图,2026-06)。
 *
 * ★ 全程复用现成能力,不另造(总指挥头号约束):
 * - 公式 mathBlock → `renderTeX`(= atomsToSvg 内部渲公式的同一 MathJax 引擎);直接拿
 *   MathJax 紧贴公式的 SVG(实机证明走 atomsToSvg 整块会因其固定 viewBox 宽出留白图被错切)。
 * - 普通代码块 codeBlock → `atomsToSvg([atom])`(Graph 画板同款,字体转 path、自包含 SVG);
 *   背景按最长行宽裁(renderCodeBlock),不留右侧大空白。
 * - Mermaid 代码块 → `renderMermaidDiagram`(代码块全屏面板同款)往离屏 div 注 SVG →
 *   取 <svg> 元素序列化。
 * - 三者各自产出**已紧贴内容、尺寸正确**的 SVG → 公共 `svgToPngDataUrl` 直接按 scale 光栅化。
 * - PNG dataURL → `mediaPutBase64`(media-storage capability)→ media:// URL。
 *   这 media:// 与普通 note 图同形,后续走 collectNoteImages → pasteTweet → resolveMediaPath
 *   → feedFilesToInput **同一条附件路**,确认弹窗 <img src=media://> 缩略图也自动显示。
 *
 * fail loud(铁律 4):任一步失败(KaTeX/Mermaid 语法错、SVG 光栅化失败、putBase64 失败)
 * → 该 block 记 failed(附 reason),**不静默丢、不崩**;调用方据此保留源码文本 + 提示。
 *
 * 附带任务观察(将来抽象素材):
 * - atomsToSvg 是「atoms 入、SVG 字符串出」;Mermaid 是「源码入、往 DOM 注 SVG 元素」——
 *   两种 block→SVG 入口形态不一致,光栅化前都得先归一成「SVG 字符串」。将来抽象
 *   「block→视觉产物」层时,可统一成 renderBlockToSvgString(block) → string。
 * - atomsToSvg 默认 width=200(画板节点宽),公式/代码图按内容自适应更合适;这里给较大
 *   width 让代码不致过早裁切,但 width 语义("画板节点宽" vs "渲染图目标宽")名实不符,
 *   是 atomsToSvg 面向画板设计、被第二类消费者(截图)借用时的不顺手点。
 */

import type { RenderableBlock } from '@drivers/text-editing-driver/serializers/collect-renderable-blocks';
import { atomsToSvg, type Atom } from '../../lib/atom-serializers/svg';
import { renderTeX } from '../../lib/atom-serializers/svg/mathjax-svg';
import { svgToPngDataUrl } from '../../lib/svg-to-png';
import { renderMermaidDiagram } from '@drivers/text-editing-driver/blocks/code-block/mermaid-renderer';
import { mediaPutBase64 } from '../media-storage';

/** 代码块 atomsToSvg viewBox 宽(背景铺满此宽内;短代码按最长行裁,见 renderCodeBlock)。 */
const CODE_CANVAS_WIDTH = 720;
/** 光栅化倍率:X 会再压缩,渲大些保清晰,绝对像素足够不糊。 */
const RASTER_SCALE = 2;
/** 公式 MathJax 渲染基准字号(px);公式最终按卡片内可用区等比缩放,字号只影响初始几何精度。 */
const MATH_FONT_SIZE = 24;
/**
 * 公式图固定卡片尺寸(CSS px,16:9)+ 内边距 + 深色底。
 * 固定卡片让多张公式图尺寸/宽高比一致,X 多图网格 cover 裁切也能完整显示公式。
 * 再叠 RASTER_SCALE 光栅保清晰(560×315 ×2 = 1120×630 device px)。
 */
const MATH_CARD_W = 560;
const MATH_CARD_H = 315;
const MATH_CARD_PAD = 36;
const MATH_CARD_BG = '#15202b';

export interface RenderedBlockMedia {
  /** 成功:写进 media store 的 media:// URL */
  mediaUrl: string;
  /** 来源 block 的源码(latex / code)—— 供「正文删源码」精确匹配 */
  source: string;
  kind: RenderableBlock['kind'];
}

export interface BlockRenderFailure {
  source: string;
  kind: RenderableBlock['kind'];
  reason: string;
}

export interface RenderBlocksResult {
  /** 成功转成 media:// 的图(按输入顺序)*/
  rendered: RenderedBlockMedia[];
  /** 渲染失败的 block(fail loud:正文保留其源码 + 提示用户)*/
  failed: BlockRenderFailure[];
}

/** atomsToSvg 入参是 Atom[];RenderableBlock.atom 是 node.toJSON()(同形),断言之。 */
function atomOf(block: RenderableBlock): Atom {
  return block.atom as unknown as Atom;
}

/** 从 mathBlock atom 抽 LaTeX(content='text*' 存源码;兼容老 attrs.latex)。 */
function extractMathLatex(block: RenderableBlock): string {
  if (block.source && block.source.trim()) return block.source;
  const atom = atomOf(block);
  const fromContent = Array.isArray(atom.content)
    ? atom.content.map((c) => (c?.type === 'text' && typeof c.text === 'string' ? c.text : '')).join('')
    : '';
  return fromContent || (atom.attrs?.latex as string) || '';
}

/**
 * 公式 → 「固定尺寸画布 + 居中公式 + 深色圆角底」的 SVG。
 *
 * ★ 用 `renderTeX`(= atomsToSvg 内部渲公式的同一 MathJax 引擎)拿公式本体,再**包一层固定
 * 尺寸的外层 SVG**(MATH_CARD_W × MATH_CARD_H,16:9 卡片),公式等比缩放后居中放进去。
 *
 * 为何要外层固定卡片(实机两轮踩坑教训):
 * - 直接用公式裸尺寸出图 → 长公式很宽,X 发多图时走并排网格、对图做 cover 裁切,只露中段
 *   (就是「图很大、左右被裁」的现象)。
 * - 固定卡片让每张公式图**尺寸/宽高比一致且适中**,X 网格 cover 也能完整显示;深色圆角底
 *   贴 X 主题、给裁切留边距。公式按卡片内边距等比缩放,长短公式都不溢出。
 * 仍是复用(同一 MathJax 引擎),只在外层做排版。
 */
function renderMathToSvg(block: RenderableBlock): string {
  const latex = extractMathLatex(block);
  if (!latex.trim()) throw new Error('mathBlock 无 LaTeX 源码');

  const result = renderTeX(latex, MATH_FONT_SIZE, true); // display 模式

  // 卡片内可用区(减内边距)。公式等比缩放到「不超内可用区」(长公式按宽缩、高公式按高缩)。
  const innerW = MATH_CARD_W - MATH_CARD_PAD * 2;
  const innerH = MATH_CARD_H - MATH_CARD_PAD * 2;
  const fitRatio = Math.min(innerW / Math.max(1, result.width), innerH / Math.max(1, result.height));
  // 短公式别撑太大(封顶),长公式按 fitRatio 缩。
  const ratio = Math.min(fitRatio, 3);
  const fW = result.width * ratio;
  const fH = result.height * ratio;
  // [DIAG 临时] 公式真实尺寸 + 卡片内缩放后,若仍不对据此判断(定位后删)。
  console.info(
    `[x-math DIAG] renderTeX=${result.width.toFixed(0)}x${result.height.toFixed(0)} ` +
      `ratio=${ratio.toFixed(2)} placed=${fW.toFixed(0)}x${fH.toFixed(0)} in card ${MATH_CARD_W}x${MATH_CARD_H}`,
  );
  // 居中放置
  const fX = (MATH_CARD_W - fW) / 2;
  const fY = (MATH_CARD_H - fH) / 2;

  // 公式本体:MathJax SVG,把 currentColor 换主题色,并设成嵌套 <svg>(x/y/width/height 定位)。
  let inner = result.svg.replace(/currentColor/g, '#e8e8e8');
  // 把根 <svg 的 width/height 改成定位尺寸,并加 x/y(嵌套 svg 用 viewBox 自适应内部坐标)。
  inner = inner.replace(
    /<svg\b/i,
    `<svg x="${fX.toFixed(1)}" y="${fY.toFixed(1)}"`,
  );
  inner = inner
    .replace(/\swidth\s*=\s*"[^"]*"/i, ` width="${fW.toFixed(1)}"`)
    .replace(/\sheight\s*=\s*"[^"]*"/i, ` height="${fH.toFixed(1)}"`);

  // 外层固定卡片 + 深色圆角底。
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${MATH_CARD_W}" height="${MATH_CARD_H}" ` +
    `viewBox="0 0 ${MATH_CARD_W} ${MATH_CARD_H}">` +
    `<rect x="0" y="0" width="${MATH_CARD_W}" height="${MATH_CARD_H}" rx="16" ry="16" fill="${MATH_CARD_BG}"/>` +
    inner +
    `</svg>`
  );
}

/** 普通代码块:atomsToSvg → SVG 字符串(背景已按最长行裁,renderCodeBlock 内做)。 */
async function renderCodeToSvg(block: RenderableBlock): Promise<string> {
  const svg = await atomsToSvg([atomOf(block)], { width: CODE_CANVAS_WIDTH });
  if (!svg || !svg.includes('<svg')) {
    throw new Error('atomsToSvg 产出空 / 非 SVG');
  }
  return svg;
}

/**
 * Mermaid:renderMermaidDiagram 往离屏容器注 SVG,取 <svg> 元素序列化成字符串。
 * 离屏 div 挂进 document(off-screen)让 mermaid 能测量布局,用后即移除。
 */
async function renderMermaidToSvgString(source: string): Promise<string> {
  const host = document.createElement('div');
  host.style.position = 'absolute';
  host.style.left = '-99999px';
  host.style.top = '0';
  host.style.width = `${CODE_CANVAS_WIDTH}px`;
  document.body.appendChild(host);
  try {
    await renderMermaidDiagram(source, host); // 语法错会 throw → fail loud 往上抛
    const svgEl = host.querySelector('svg');
    if (!svgEl) throw new Error('Mermaid 渲染后未找到 <svg>');
    // 确保有显式宽高(svgToPng 量尺寸用);mermaid 输出常带 viewBox,svgToPng 也能回退。
    return new XMLSerializer().serializeToString(svgEl);
  } finally {
    host.remove();
  }
}

/**
 * mathVisual(函数图像):直接拿 thumbnail(SVG)attr,**不重渲**(矩阵建议,省 Canvas 重画)。
 * thumbnail 已是渲好的 SVG 字符串(画板缩略图);拿不到则 fail loud(调用方降级文本)。
 */
function mathVisualSvg(block: RenderableBlock): string {
  const atom = atomOf(block);
  const thumb = (atom.attrs?.thumbnail as string) || block.source || '';
  if (!thumb || !thumb.includes('<svg')) {
    throw new Error('mathVisual 无 thumbnail SVG(无法内嵌图,降级文本)');
  }
  return thumb;
}

/** 单个 block → media://(成功)或抛错(失败,由调用方 catch 记 failed)。 */
async function renderOneBlock(block: RenderableBlock): Promise<string> {
  let svgString: string;
  if (block.kind === 'mermaid') {
    svgString = await renderMermaidToSvgString(block.source);
  } else if (block.kind === 'math') {
    svgString = renderMathToSvg(block); // 紧凑 MathJax SVG(自带正确 viewBox + px 宽高)
  } else if (block.kind === 'mathVisual') {
    svgString = mathVisualSvg(block); // 直接用 thumbnail SVG,不重渲
  } else {
    svgString = await renderCodeToSvg(block);
  }

  // 光栅化:RASTER_SCALE 放大保清晰(X 会再压)。各 SVG 已自带正确尺寸(公式紧贴、代码按
  // 最长行裁、Mermaid 本就紧凑)→ 不再用 getBBox tightCrop(实机证明 getBBox 对带 transform
  // 的 MathJax SVG 量不准,导致错切)。透明底(X 深色主题自配底)。
  const dataUrl = await svgToPngDataUrl(svgString, { scale: RASTER_SCALE });

  const put = await mediaPutBase64(dataUrl, 'image/png', `x-block-${block.kind}.png`);
  if (!put.success || !put.mediaUrl) {
    throw new Error(put.error || 'mediaPutBase64 失败');
  }
  return put.mediaUrl;
}

/**
 * 批量渲染:逐 block 渲染成 media://,失败的记 failed(不中断其余)。
 * 保持输入顺序 → 与文档顺序一致(4 图额度「取前 4」语义对齐)。
 */
export async function renderBlocksToMedia(
  blocks: RenderableBlock[],
): Promise<RenderBlocksResult> {
  const rendered: RenderedBlockMedia[] = [];
  const failed: BlockRenderFailure[] = [];

  for (const block of blocks) {
    try {
      const mediaUrl = await renderOneBlock(block);
      rendered.push({ mediaUrl, source: block.source, kind: block.kind });
    } catch (err) {
      failed.push({
        source: block.source,
        kind: block.kind,
        reason: err instanceof Error ? err.message : String(err),
      });
      console.warn(`[render-blocks-to-media] ${block.kind} 渲染失败,退源码文本:`, err);
    }
  }

  return { rendered, failed };
}
