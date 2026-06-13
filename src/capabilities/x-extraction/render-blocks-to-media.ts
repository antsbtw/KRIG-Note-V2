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
import { renderMermaidToExportSvg } from '@drivers/text-editing-driver/blocks/code-block/mermaid-renderer';
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
 * Mermaid → 纯 SVG 字符串(导出成图)。
 *
 * ★ 用 `renderMermaidToExportSvg`(htmlLabels:false,纯 SVG `<text>` 标签,**无 foreignObject**)——
 *   编辑器默认 htmlLabels:true 会让 SVG 带 foreignObject(嵌 HTML),画进 canvas 时污染 canvas →
 *   `toDataURL()` 报 "Tainted canvases may not be exported"(实机暴露的真根因)。纯 SVG 标签不污染。
 *
 * ★ 字号/尺寸(2026-06-13 实机):导出用 `useMaxWidth:false`,mermaid 出**内容自然尺寸**的 SVG
 *   (自带 px 宽高)→ ×2 光栅后是「2倍清晰的原尺寸图」,节点/字号比例 = 编辑器一致(不再被 720
 *   容器撑大)。故离屏容器**不再固定 720 宽**(那会干扰自然布局),用自适应宽。
 */
async function renderMermaidToSvgString(source: string): Promise<string> {
  // 1. 纯 SVG 渲染
  const rawSvg = await renderMermaidToExportSvg(source);

  // 2. 离屏挂载,**量真实渲染尺寸(getBBox/viewBox),把 SVG 的 width/height 直接固定成
  //    留白系数**(2026-06-13 实机:之前靠 readSvgSize 读 SVG width 算 scale,
  //    但 mermaid useMaxWidth 把 width 设成 "100%"/style 量不准 → scale 算错出 3168px 大图。
  //    这里**直接把 SVG 宽高写死成目标宽 + 等比高**,svgToPng 按 scale=1 出图 = 正好目标宽,
  //    彻底绕开 readSvgSize 量不准的坑)。
  const host = document.createElement('div');
  host.style.position = 'absolute';
  host.style.left = '-99999px';
  host.style.top = '0';
  host.innerHTML = rawSvg;
  document.body.appendChild(host);
  try {
    const svgEl = host.querySelector('svg');
    if (!svgEl) throw new Error('Mermaid 渲染后未找到 <svg>');
    // 量真实宽高:优先 viewBox(mermaid 一定有),兜底 getBBox。
    let natW = 0;
    let natH = 0;
    const vb = (svgEl.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
    if (vb.length === 4 && vb[2] > 0 && vb[3] > 0) {
      natW = vb[2];
      natH = vb[3];
    } else {
      try {
        const bb = (svgEl as SVGGraphicsElement).getBBox();
        natW = bb.width;
        natH = bb.height;
      } catch { /* ignore */ }
    }
    // ★★ 字号真解(2026-06-13 定论):X 文章图**一律 fit 到列宽显示**(与 PNG 像素大小无关)→
    //   显示字号 = 列宽 × (字/图宽比例)。所以**改图的像素大小没用**(矢量,比例恒定),唯一能让字变小的
    //   办法是 **把图的「字/图总宽比例」做小** —— 即给 mermaid 图**两侧留白**,让图内容只占总宽一部分,
    //   fit 到列宽时图(连字)就显得小。把 253px 的图框进留白画布居中,
    //   字/总宽比例 = 253/FRAME 倍缩小 → 显示字号同比缩小。
    const safeW = natW > 0 ? natW : 253;
    const safeH = natH > 0 ? natH : 180;
    const FRAME_W = Math.round(safeW * MERMAID_FRAME_FACTOR); // 外框宽 = 图宽 × 留白系数
    const frameH = safeH; // 高度=图高(只左右留白,不竖向留白)
    const offsetX = Math.max(0, Math.round((FRAME_W - safeW) / 2));
    // 把原 SVG 内容包进一个 FRAME_W 宽的外层 SVG,居中。
    svgEl.setAttribute('width', String(safeW));
    svgEl.setAttribute('height', String(safeH));
    svgEl.style.removeProperty('max-width');
    svgEl.style.removeProperty('width');
    svgEl.style.removeProperty('height');
    const inner = new XMLSerializer().serializeToString(svgEl);
    const framed =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${FRAME_W}" height="${frameH}" viewBox="0 0 ${FRAME_W} ${frameH}">` +
      `<g transform="translate(${offsetX},0)">${inner}</g>` +
      `</svg>`;
    console.log(`[render-mermaid] 自然=${Math.round(natW)}×${Math.round(natH)} → 框进 ${FRAME_W}px 画布(左右留白,字按 ${(safeW / FRAME_W).toFixed(2)} 缩小)`);
    return framed;
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

/**
 * Mermaid 图「留白系数」:外框宽 = 图内容宽 × 此系数。>1 = 左右留白,把「字/图总宽」比例做小,
 * X fit 到列宽显示时字就小。1.9 ≈ 把字号缩到原来的 1/1.9(实机微调:大了再加,小了再减)。
 * 实测:图自然 253px、字 ~16px(占 6.3%);×1.9 框成 480px → 字占 3.3% → X 列宽 ~600 显示时字 ~20px。
 */
const MERMAID_FRAME_FACTOR = 1.9;

/** 单个 block → media://(成功)或抛错(失败,由调用方 catch 记 failed)。 */
async function renderOneBlock(block: RenderableBlock): Promise<string> {
  let svgString: string;
  let rasterScale: number = RASTER_SCALE;
  if (block.kind === 'mermaid') {
    // ★★ 代码生效自检(2026-06-13 v3 标记):若此行没在【宿主窗口】控制台出现,说明这段没跑到
    //   (旧代码/未重载/跑在别的 instance)→ 一切 mermaid 改动都不会生效。注:此 log 在**宿主主窗口**
    //   控制台,不是 X webview 那个 devtools。
    console.log('[MERMAID-EXPORT v4] renderOneBlock(mermaid) 开始 — 留白系数 ' + MERMAID_FRAME_FACTOR);
    // SVG 已在 renderMermaidToSvgString 框进留白画布(字/总宽比例做小)→ scale 1.5 光栅保清晰。
    svgString = await renderMermaidToSvgString(block.source);
    rasterScale = 1.5;
  } else if (block.kind === 'math') {
    svgString = renderMathToSvg(block); // 紧凑 MathJax SVG(自带正确 viewBox + px 宽高)
  } else if (block.kind === 'mathVisual') {
    svgString = mathVisualSvg(block); // 直接用 thumbnail SVG,不重渲
  } else {
    svgString = await renderCodeToSvg(block);
  }

  // 光栅化:mermaid 按目标宽算的 scale;其余 RASTER_SCALE 放大保清晰(X 会再压)。
  const dataUrl = await svgToPngDataUrl(svgString, { scale: rasterScale });

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
