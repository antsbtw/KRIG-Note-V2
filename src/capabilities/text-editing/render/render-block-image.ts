/**
 * ⭐ 把 note 的一个块渲染成一张 PNG(发推第④期剩下的,2026-10-28)—— 渲染进程(要 DOM / canvas)
 *
 * 缘起:X 推文只认纯文字,公式 / 代码 / 流程图 / 表格 / HTML / 函数图像 / SVG 图 / 带行内公式的段落
 * 都要先转成图当附件发(效果用户 10-28 定:行内公式 →「整段转成图」;代码 →「短的发文字」,短不短由调用方判)。
 * 放在 text-editing 能力里:「把一个块画成图」是 note 的能力,X 只是第一个用的(以后画板 / 导出也能用)。
 *
 * 统一样式:深色卡片(底 CARD_BG、字 CARD_FG、四周留白 PAD)—— X 上不管深浅主题都看得清,几种块看着是一套。
 * ⭐ 统一宽度 CARD_W(用户 10-29 选「统一宽度」):每张图一样宽、字号一样 —— X 按同一比例缩放,图里的字和推文正文差不多大。
 *   (10-28 第一版按内容大小出图:公式只有 200px 宽,X 放大铺满,字比正文大好几倍、每张还不一样大。)
 *   高度跟内容走;比卡片宽的内容(大流程图)等比缩到放得下。
 * 三条路:
 *  - 公式:MathJax renderTeX 直出紧凑 SVG(别走 atomsToSvg 截大图,见记忆 project-x-unsupported-block-to-image)
 *  - Mermaid / 函数图像 / SVG 图:本来就是 SVG,套进卡片
 *  - 表格 / 代码 / HTML / 带行内公式的段落:排成 HTML,先在页面外量尺寸,再塞进 SVG foreignObject
 * 最后统一 svgToPngDataUrl(data URI,不污染 canvas)。
 *
 * fail loud:渲染不出来就 throw(带原因),调用方把原因给人看,不静默丢、不偷偷退回源码。
 */
import { renderTeX } from '../../../lib/atom-serializers/svg/mathjax-svg';
import { svgToPngDataUrl } from '../../../lib/svg-to-png';
import { renderMermaidToExportSvg } from '@drivers/text-editing-driver/blocks/code-block/mermaid-renderer';

export type BlockJson = {
  readonly type: string;
  readonly attrs?: Readonly<Record<string, unknown>>;
  readonly content?: readonly BlockJson[];
  readonly marks?: ReadonlyArray<{ readonly type: string; readonly attrs?: Readonly<Record<string, unknown>> }>;
  readonly text?: string;
};

export type BlockImage = { readonly dataUrl: string; readonly width: number; readonly height: number };

const CARD_BG = '#16181c';
const CARD_FG = '#e7e9ea';
const CARD_MUTED = '#2f3336';
const PAD = 24;
/** 卡片宽(CSS px;PNG 按 2x 出 = 1200px)。X 时间线上图约 500px 宽 → 缩到 0.85,下面的字号按这个比例定 */
const CARD_W = 600;
const CONTENT_W = CARD_W - PAD * 2;
const FONT = '-apple-system, "PingFang SC", "Microsoft YaHei", "Segoe UI", sans-serif';
const MONO = 'Menlo, Consolas, "SF Mono", monospace';
/** 正文字号:缩到 X 上约 15px,和推文正文差不多 */
const TEXT_SIZE = 18;
const CODE_SIZE = 16;
const MATH_SIZE = 28;
const INLINE_MATH_SIZE = TEXT_SIZE;

const textOf = (n: BlockJson): string => n.text ?? (n.content ?? []).map(textOf).join('');

export async function renderBlockImage(node: BlockJson): Promise<BlockImage> {
  switch (node.type) {
    case 'mathBlock': {
      const tex = ((node.attrs?.latex as string) || textOf(node)).trim();
      if (tex === '') throw new Error('公式是空的');
      const r = renderTeX(tex, MATH_SIZE, true);
      return svgCard(r.svg, r.width, r.height);
    }
    case 'codeBlock': {
      const lang = ((node.attrs?.language as string) || '').toLowerCase();
      const src = textOf(node);
      if (lang === 'mermaid') {
        const svg = await renderMermaidToExportSvg(src);
        const size = svgSize(svg);
        if (!size) throw new Error('流程图渲染出来量不出尺寸');
        return svgCard(svg, size.width, size.height);
      }
      const pre = el('pre', { margin: '0', fontFamily: MONO, fontSize: `${CODE_SIZE}px`, lineHeight: '1.5', whiteSpace: 'pre-wrap', wordBreak: 'break-all' });
      pre.textContent = src.replace(/\n$/, '');
      return htmlCard(pre);
    }
    case 'mathVisual': {
      const svg = (node.attrs?.thumbnail as string) || '';
      if (svg.trim() === '') throw new Error('函数图像还没生成缩略图(在 note 里双击进全屏画一次再退出)');
      const size = svgSize(svg);
      if (!size) throw new Error('函数图像量不出尺寸');
      return svgCard(svg, size.width, size.height);
    }
    case 'image': {
      const src = (node.attrs?.src as string) || '';
      if (!/\.svg$/i.test(src)) throw new Error('这张图不用转');
      const res = await fetch(src);
      if (!res.ok) throw new Error(`读不到这张 SVG 图(${res.status})`);
      const svg = await res.text();
      const size = svgSize(svg);
      if (!size) throw new Error('SVG 图量不出尺寸');
      return svgCard(svg, size.width, size.height);
    }
    case 'table': return htmlCard(tableEl(node));
    case 'htmlBlock': {
      const box = el('div', {});
      box.innerHTML = textOf(node);
      box.querySelectorAll('script').forEach((s) => s.remove());
      return htmlCard(box);
    }
    case 'paragraph': case 'heading': {
      const p = el(node.type === 'heading' ? 'div' : 'p', { margin: '0', fontSize: `${node.type === 'heading' ? TEXT_SIZE + 4 : TEXT_SIZE}px`, fontWeight: node.type === 'heading' ? '700' : '400', lineHeight: '1.7' });
      inline(node.content, p);
      return htmlCard(p);
    }
    default: throw new Error(`不会把「${node.type}」画成图`);
  }
}

// ── SVG 卡片 ──

/** 量 SVG 的尺寸:width/height(px)→ 退 viewBox */
function svgSize(svg: string): { width: number; height: number } | null {
  const tag = /<svg\b[^>]*>/i.exec(svg)?.[0];
  if (!tag) return null;
  const vb = /\bviewBox\s*=\s*"([^"]+)"/i.exec(tag)?.[1].trim().split(/[\s,]+/).map(Number);
  const num = (k: string): number => {
    const m = new RegExp(`\\b${k}\\s*=\\s*"([\\d.]+)(px)?"`, 'i').exec(tag);
    return m ? parseFloat(m[1]) : NaN;
  };
  const w = num('width');
  const h = num('height');
  if (w > 0 && h > 0) return { width: w, height: h };
  if (vb && vb.length === 4 && vb[2] > 0 && vb[3] > 0) return { width: vb[2], height: vb[3] };
  return null;
}

/**
 * 把一个 <svg>(原尺寸 w × h)摆进卡片:比内容区宽就等比缩小,水平居中;颜色定成卡片字色。
 * ⚠️ 原 SVG 要有 viewBox 才能缩放 —— 没有就按原尺寸补一个。
 */
function svgCard(svg: string, w: number, h: number): Promise<BlockImage> {
  const k = Math.min(1, CONTENT_W / w);
  const dw = w * k;
  const dh = h * k;
  const x = PAD + (CONTENT_W - dw) / 2;
  const inner = svg
    .replace(/currentColor/g, CARD_FG)
    .replace(/<svg\b([^>]*)>/i, (_all, attrs: string) => {
      const vb = /\bviewBox\s*=/i.test(attrs) ? '' : ` viewBox="0 0 ${w} ${h}"`;
      const rest = attrs.replace(/\s(width|height|x|y|style)\s*=\s*"[^"]*"/gi, '');
      return `<svg${rest}${vb} x="${x}" y="${PAD}" width="${dw}" height="${dh}">`;
    });
  const W = CARD_W;
  const H = Math.ceil(dh + PAD * 2);
  const card = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`
    + `<rect width="100%" height="100%" rx="12" fill="${CARD_BG}"/>${inner}</svg>`;
  return toPng(card, W, H);
}

async function toPng(svg: string, w: number, h: number): Promise<BlockImage> {
  const dataUrl = await svgToPngDataUrl(svg, { scale: 2 });
  return { dataUrl, width: w, height: h };
}

// ── HTML 卡片(foreignObject)──

function el(tag: string, style: Partial<CSSStyleDeclaration>, text?: string): HTMLElement {
  const e = document.createElement(tag);
  Object.assign(e.style, style);
  if (text !== undefined) e.textContent = text;
  return e;
}

/** 先放到页面外量出尺寸,再整块序列化进 foreignObject */
async function htmlCard(content: HTMLElement): Promise<BlockImage> {
  const card = el('div', {
    position: 'fixed', left: '-100000px', top: '0', display: 'block', width: `${CARD_W}px`,
    padding: `${PAD}px`, background: CARD_BG, color: CARD_FG, fontFamily: FONT, fontSize: `${TEXT_SIZE}px`, borderRadius: '12px', boxSizing: 'border-box',
  });
  card.appendChild(content);
  document.body.appendChild(card);
  let W: number;
  let H: number;
  try {
    const r = card.getBoundingClientRect();
    W = Math.ceil(r.width);
    H = Math.ceil(r.height);
  } finally {
    card.remove();
  }
  if (!(W > 0 && H > 0)) throw new Error('排出来是空的,量不出尺寸');
  card.style.position = 'static';
  card.style.left = '';
  card.style.width = `${W}px`;
  const xhtml = new XMLSerializer().serializeToString(card);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`
    + `<foreignObject x="0" y="0" width="${W}" height="${H}">${xhtml}</foreignObject></svg>`;
  return toPng(svg, W, H);
}

/** 行内:字(粗 / 斜 / 行内代码)、换行、行内公式(MathJax SVG,按基线对齐)、note 链接 */
function inline(nodes: readonly BlockJson[] | undefined, into: HTMLElement): void {
  for (const n of nodes ?? []) {
    if (n.type === 'text') {
      let e: HTMLElement = el('span', {}, n.text ?? '');
      for (const m of n.marks ?? []) {
        if (m.type === 'bold' || m.type === 'strong') e.style.fontWeight = '700';
        if (m.type === 'italic' || m.type === 'em') e.style.fontStyle = 'italic';
        if (m.type === 'code') { e = el('code', { fontFamily: MONO, background: CARD_MUTED, padding: '0 4px', borderRadius: '4px' }, n.text ?? ''); }
      }
      into.appendChild(e);
    } else if (n.type === 'hardBreak') {
      into.appendChild(document.createElement('br'));
    } else if (n.type === 'mathInline') {
      const tex = ((n.attrs?.latex as string) || textOf(n)).trim();
      if (tex === '') continue;
      const r = renderTeX(tex, INLINE_MATH_SIZE, false);
      const span = el('span', { display: 'inline-block', verticalAlign: `${-(r.height - r.baselineOffset)}px` });
      span.innerHTML = r.svg.replace(/currentColor/g, CARD_FG).replace(/<svg\b([^>]*)>/i, (_a, attrs: string) =>
        `<svg${attrs.replace(/\s(width|height|style)\s*=\s*"[^"]*"/gi, '')} width="${r.width}" height="${r.height}">`);
      into.appendChild(span);
    } else if (n.type === 'noteLink') {
      into.appendChild(el('span', {}, (n.attrs?.label as string) || textOf(n)));
    } else {
      into.appendChild(el('span', {}, textOf(n)));
    }
  }
}

function tableEl(node: BlockJson): HTMLElement {
  const t = el('table', { borderCollapse: 'collapse', fontSize: `${CODE_SIZE}px`, lineHeight: '1.5', maxWidth: '100%' });
  for (const row of node.content ?? []) {
    const tr = document.createElement('tr');
    for (const cell of row.content ?? []) {
      const head = cell.type === 'tableHeader';
      const td = el(head ? 'th' : 'td', {
        border: `1px solid ${CARD_MUTED}`, padding: '6px 12px', textAlign: 'left', verticalAlign: 'top',
        fontWeight: head ? '700' : '400', background: head ? '#202327' : 'transparent',
      });
      (cell.content ?? []).forEach((p, i) => {
        if (i > 0) td.appendChild(document.createElement('br'));
        inline(p.content, td);
      });
      tr.appendChild(td);
    }
    t.appendChild(tr);
  }
  if (t.childElementCount === 0) throw new Error('表格是空的');
  return t;
}
