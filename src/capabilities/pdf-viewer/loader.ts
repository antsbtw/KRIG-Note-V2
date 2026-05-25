/**
 * pdf-viewer capability — 文档加载 / 元数据 / 截图(L5)
 *
 * 命令式 API 实现:loadDocument / destroyDocument / getOutline / getPageLabels /
 * capturePageRect / searchText / hasTextContent。
 *
 * 设计原则:
 * - 句柄 ↔ PDFDocumentProxy 映射在模块级 Map 维护;view 看 opaque DocumentHandle,
 *   adapter 内反查得到 pdfjs proxy。
 * - getDocument 全配置一次性传齐(cMap / 字体 / 安全 / HWA / 像素上限)— 旧 renderer
 *   只传 `{ data }` 是中日韩字符乱码 / fake worker 警告根因。
 * - TOC destRef 由原始 dest 序列化 (JSON.stringify) 而成,goToDestination 反序列化后
 *   交给 LinkService.goToDestination 处理。
 *
 * 详见 docs/refactor/pdf-viewer-adapter-plan.md § 3 + Stage 1 配置清单。
 */

import * as pdfjsLib from 'pdfjs-dist';
import type {
  PDFDocumentProxy,
  PDFPageProxy,
} from 'pdfjs-dist';
import type {
  DocumentHandle,
  TOCItem,
  SearchResult,
} from './types';
import { ensurePdfWorker } from './worker-setup';

// ── 句柄 ↔ proxy 映射 ──

interface DocumentRecord {
  proxy: PDFDocumentProxy;
  /**
   * destRef → 原始 dest(string named-dest / array explicit-dest)。
   * getOutline 时构建,goToDestination 反查。
   */
  destRefMap: Map<string, string | unknown[]>;
  /** 页号 → 已 fetch 的 PDFPageProxy 缓存(capturePageRect / hasTextContent 复用)*/
  pageCache: Map<number, PDFPageProxy>;
}

const docRegistry = new Map<string, DocumentRecord>();
let docIdSeq = 0;

function nextDocId(): string {
  docIdSeq += 1;
  return `pdf-doc-${docIdSeq}`;
}

function getRecord(handle: DocumentHandle): DocumentRecord {
  const rec = docRegistry.get(handle.id);
  if (!rec) {
    throw new Error(
      `[pdf-viewer] handle ${handle.id} not found — already destroyed or wrong adapter`,
    );
  }
  return rec;
}

/**
 * adapter 内部使用:从 handle 拿 PDFDocumentProxy(给 PDFViewerCanvas / services 用)。
 * **不暴露到 PdfViewerApi**(view 看不到这个函数,符合 npm 屏障)。
 */
export function getProxy(handle: DocumentHandle): PDFDocumentProxy {
  return getRecord(handle).proxy;
}

/**
 * adapter 内部使用:goToDestination 反查 raw dest。
 */
export function resolveDestRef(
  handle: DocumentHandle,
  destRef: string,
): string | unknown[] | undefined {
  return getRecord(handle).destRefMap.get(destRef);
}

// ── 公开 API 实现 ──

export async function loadDocument(
  data: ArrayBuffer | Uint8Array,
): Promise<DocumentHandle> {
  ensurePdfWorker();
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);

  // 全配置 — cMap / 字体 走 Vite asset URL(`new URL(..., import.meta.url)`)。
  // 末尾必须带 `/`,pdfjs 内部用 `cMapUrl + filename` 拼路径。
  const cMapUrl = new URL('pdfjs-dist/cmaps/', import.meta.url).href;
  const standardFontDataUrl = new URL(
    'pdfjs-dist/standard_fonts/',
    import.meta.url,
  ).href;

  const proxy = await pdfjsLib.getDocument({
    data: bytes,
    cMapUrl,
    cMapPacked: true,
    standardFontDataUrl,
    isEvalSupported: false, // 安全:禁 eval 字体解码降级
    enableHWA: true,        // 4.x 硬件加速
    // 注:maxCanvasPixels 是 PDFViewer 构造参数,不是 getDocument 参数;
    // 在 Stage 2 services.ts 内传给 PDFViewer。
  }).promise;

  const id = nextDocId();
  docRegistry.set(id, {
    proxy,
    destRefMap: new Map(),
    pageCache: new Map(),
  });

  return {
    _brand: 'pdf-viewer.DocumentHandle',
    id,
    totalPages: proxy.numPages,
  };
}

export async function destroyDocument(handle: DocumentHandle): Promise<void> {
  const rec = docRegistry.get(handle.id);
  if (!rec) return;
  docRegistry.delete(handle.id);
  rec.pageCache.clear();
  rec.destRefMap.clear();
  await rec.proxy.destroy();
}

// ── TOC ──

interface RawOutlineItem {
  title?: string;
  dest?: string | unknown[];
  items?: RawOutlineItem[];
}

export async function getOutline(handle: DocumentHandle): Promise<TOCItem[]> {
  const rec = getRecord(handle);
  const outline = (await rec.proxy.getOutline()) as RawOutlineItem[] | null;
  if (!outline || outline.length === 0) return [];
  return outline.map((item) => convertOutlineItem(item, rec));
}

function convertOutlineItem(
  item: RawOutlineItem,
  rec: DocumentRecord,
): TOCItem {
  // destRef 由原始 dest 序列化(JSON 化数组 / 直接用字符串名)
  // 反查时 LinkService.goToDestination 接 raw dest,故同时存 raw → ref 双向。
  let destRef = '';
  if (item.dest !== undefined && item.dest !== null) {
    destRef =
      typeof item.dest === 'string' ? `n:${item.dest}` : `e:${JSON.stringify(item.dest)}`;
    rec.destRefMap.set(destRef, item.dest);
  }
  return {
    label: item.title ?? '',
    destRef,
    children: item.items && item.items.length > 0
      ? item.items.map((child) => convertOutlineItem(child, rec))
      : undefined,
  };
}

// ── 页面 labels ──

export async function getPageLabels(
  handle: DocumentHandle,
): Promise<string[] | null> {
  const rec = getRecord(handle);
  return rec.proxy.getPageLabels();
}

// ── 单页 fetch + 缓存 ──

async function getPage(
  rec: DocumentRecord,
  pageNum: number,
): Promise<PDFPageProxy> {
  const cached = rec.pageCache.get(pageNum);
  if (cached) return cached;
  const page = await rec.proxy.getPage(pageNum);
  rec.pageCache.set(pageNum, page);
  return page;
}

// ── hasTextContent ──

export async function hasTextContent(
  handle: DocumentHandle,
  pageNum: number,
): Promise<boolean> {
  const rec = getRecord(handle);
  if (pageNum < 1 || pageNum > rec.proxy.numPages) return false;
  const page = await getPage(rec, pageNum);
  const tc = await page.getTextContent();
  return tc.items.length > 0;
}

// ── 全文搜索 ──

export async function searchText(
  handle: DocumentHandle,
  query: string,
): Promise<SearchResult[]> {
  if (!query) return [];
  const rec = getRecord(handle);
  const results: SearchResult[] = [];
  const lowerQuery = query.toLowerCase();

  for (let i = 1; i <= rec.proxy.numPages; i++) {
    const page = await getPage(rec, i);
    const textContent = await page.getTextContent();
    const pageText = textContent.items
      .map((item) => ('str' in item ? item.str : ''))
      .join('');
    const lowerText = pageText.toLowerCase();

    let pos = 0;
    while ((pos = lowerText.indexOf(lowerQuery, pos)) !== -1) {
      const start = Math.max(0, pos - 20);
      const end = Math.min(pageText.length, pos + query.length + 20);
      results.push({
        pageNum: i,
        index: pos,
        text: pageText.slice(start, end),
      });
      pos += query.length;
    }
  }
  return results;
}

// ── 截屏(2x DPR 高清 → JPEG dataUrl)──

export async function capturePageRect(
  handle: DocumentHandle,
  pageNum: number,
  rect: { x: number; y: number; w: number; h: number },
): Promise<string> {
  const rec = getRecord(handle);
  if (pageNum < 1 || pageNum > rec.proxy.numPages) {
    throw new Error(`[pdf-viewer] capturePageRect: page ${pageNum} out of range`);
  }
  const captureScale = 2;
  const page = await getPage(rec, pageNum);
  const viewport = page.getViewport({ scale: captureScale });

  // 先 render 整页到离屏 canvas,再裁 rect — 比 partial viewport transform 跨版本稳。
  const pageCanvas = document.createElement('canvas');
  pageCanvas.width = Math.ceil(viewport.width);
  pageCanvas.height = Math.ceil(viewport.height);
  const pageCtx = pageCanvas.getContext('2d');
  if (!pageCtx) throw new Error('[pdf-viewer] capturePageRect: 2d context failed');

  await page.render({ canvasContext: pageCtx, viewport }).promise;

  const sx = Math.max(0, Math.floor(rect.x * captureScale));
  const sy = Math.max(0, Math.floor(rect.y * captureScale));
  const sw = Math.max(1, Math.ceil(rect.w * captureScale));
  const sh = Math.max(1, Math.ceil(rect.h * captureScale));

  const cropCanvas = document.createElement('canvas');
  cropCanvas.width = sw;
  cropCanvas.height = sh;
  const cropCtx = cropCanvas.getContext('2d');
  if (!cropCtx) throw new Error('[pdf-viewer] capturePageRect: crop 2d context failed');

  // 白底 — PDF 透明区域 JPEG 编码会泛黑
  cropCtx.fillStyle = '#ffffff';
  cropCtx.fillRect(0, 0, sw, sh);
  cropCtx.drawImage(pageCanvas, sx, sy, sw, sh, 0, 0, sw, sh);

  return cropCanvas.toDataURL('image/jpeg', 0.85);
}
