/**
 * MathJax SVG 输出适配器
 *
 * 方案 C：MathJax v3 → SVG（fontCache: 'none' 避免 <use> 引用，输出独立 <path>）
 *
 * 使用 browserAdaptor 在 electron renderer 中工作。
 * 单例懒加载——只在第一次 renderTeX 时初始化。
 */
import { mathjax } from 'mathjax-full/js/mathjax.js';
import { TeX } from 'mathjax-full/js/input/tex.js';
import { SVG } from 'mathjax-full/js/output/svg.js';
import { browserAdaptor } from 'mathjax-full/js/adaptors/browserAdaptor.js';
import { RegisterHTMLHandler } from 'mathjax-full/js/handlers/html.js';
import { AllPackages } from 'mathjax-full/js/input/tex/AllPackages.js';

let mjxDocument: ReturnType<typeof mathjax.document> | null = null;
let mjxAdaptor: ReturnType<typeof browserAdaptor> | null = null;
let mjxInitMs = 0;

export function getMathjaxInitMs(): number {
  return mjxInitMs;
}

function ensureInit(): void {
  if (mjxDocument) return;

  const t0 = performance.now();
  const adaptor = browserAdaptor();
  RegisterHTMLHandler(adaptor);

  const tex = new TeX({ packages: AllPackages });
  // fontCache: 'none' → 每次输出完整 <path>，不用 <use href> 引用全局 defs
  // 这样每个 SVG 都是自包含的，且 SVGLoader 能直接解析（不会丢失 use 引用）
  const svg = new SVG({ fontCache: 'none' });
  mjxDocument = mathjax.document('', { InputJax: tex, OutputJax: svg });
  mjxAdaptor = adaptor;

  mjxInitMs = performance.now() - t0;
  console.info(`[mathjax-svg] initialized in ${mjxInitMs.toFixed(1)}ms`);
}

export interface TexRenderResult {
  /** 内层 SVG 字符串（含 <svg> 根元素） */
  svg: string;
  /** SVG 内在宽度（ex 单位转 px，按 fontSize 缩放后） */
  width: number;
  /** SVG 内在高度（ex 单位转 px） */
  height: number;
  /** 基线偏移：SVG 顶部到基线的距离（px） */
  baselineOffset: number;
}

/**
 * 渲染 TeX 为 SVG 字符串 + 尺寸信息
 *
 * MathJax 输出的 SVG 使用 ex 单位 + viewBox，需要转换为像素：
 * - 1 ex ≈ 0.5 em ≈ 0.5 × fontSize px
 */
export function renderTeX(tex: string, fontSize: number, display = false): TexRenderResult {
  ensureInit();
  if (!mjxDocument || !mjxAdaptor) {
    throw new Error('mathjax not initialized');
  }

  const node = mjxDocument.convert(tex, { display });
  // node 是 mjx-container 的 wrapper；它的 firstChild 才是 <svg>
  const innerSvg = mjxAdaptor.firstChild(node) as HTMLElement;
  const outerHtml = mjxAdaptor.outerHTML(innerSvg);

  // 解析尺寸：SVG 的 width/height 用 ex 单位
  const widthAttr = mjxAdaptor.getAttribute(innerSvg, 'width') || '0';
  const heightAttr = mjxAdaptor.getAttribute(innerSvg, 'height') || '0';
  const styleAttr = mjxAdaptor.getAttribute(innerSvg, 'style') || '';

  const widthEx = parseFloat(widthAttr);
  const heightEx = parseFloat(heightAttr);
  const exToPx = fontSize * 0.5;
  const width = widthEx * exToPx;
  const height = heightEx * exToPx;

  // vertical-align 决定基线偏移（style 里如 "vertical-align: -0.566ex"）
  const valignMatch = /vertical-align:\s*(-?[\d.]+)ex/.exec(styleAttr);
  const valignEx = valignMatch ? parseFloat(valignMatch[1]) : 0;
  const baselineOffset = height + valignEx * exToPx;

  return { svg: outerHtml, width, height, baselineOffset };
}
