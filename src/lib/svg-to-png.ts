/**
 * svgToPng — 把「SVG 字符串」光栅化成 PNG dataURL(Retina 2x,渲染进程)
 *
 * 缘起(X 截图 2026-06):atomsToSvg / MathJax 产出的是**自包含 SVG 字符串**
 * (带显式 width/height/viewBox,字体已转 path),手上没有挂进 DOM 的 SVG 元素。
 * 全仓既有的两份 `svgToPngBlob`(MermaidPreviewPane / MathVisualFullscreenPanel)
 * 都靠 `getBoundingClientRect()` 量尺寸 —— 需要元素先在 DOM 里,语义不同,不能直接复用。
 * 故新增这一份「字符串入」的公共版,放 lib/ 供以后复用(别每处再抄)。
 *
 * 实现:string → Blob(image/svg+xml)→ objectURL → <img> 解码 → canvas 2x 绘制
 * → toDataURL('image/png')。纯渲染进程 DOM/canvas API(需 document),不进 main。
 *
 * fail loud:尺寸取不到 / <img> 解码失败 / canvas 不可用 → reject,由调用方退源码文本
 * (X 截图链路铁律 4:渲染失败退源码,不静默丢)。
 *
 * 附带任务观察(将来「block→视觉产物层」抽象立项时归并素材):
 *   现有两份私有 svgToPngBlob(元素入、bbox 量尺寸)与本份(字符串入、attr/viewBox
 *   量尺寸)是同一职责的两种入参形态,将来可合成一个 `svgToPng(elOrString, opts)`。
 */

/**
 * 从 SVG 字符串顶层 <svg ...> 里抽 width/height(px 数值)。取不到回退 viewBox 的 w/h。
 * 导出供单测(纯函数,无 DOM 依赖;svgToPngDataUrl 本身需 canvas/Image 进 node env 测不了)。
 */
export function readSvgSize(svgString: string): { width: number; height: number } | null {
  const svgTagMatch = /<svg\b[^>]*>/i.exec(svgString);
  if (!svgTagMatch) return null;
  const tag = svgTagMatch[0];

  const wMatch = /\bwidth\s*=\s*"([\d.]+)/i.exec(tag);
  const hMatch = /\bheight\s*=\s*"([\d.]+)/i.exec(tag);
  let width = wMatch ? parseFloat(wMatch[1]) : NaN;
  let height = hMatch ? parseFloat(hMatch[1]) : NaN;

  // width/height 缺失或非数值(如 "2ex")→ 回退 viewBox 的后两位(minX minY w h)
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    const vbMatch = /\bviewBox\s*=\s*"([^"]+)"/i.exec(tag);
    if (vbMatch) {
      const parts = vbMatch[1].trim().split(/[\s,]+/).map(Number);
      if (parts.length === 4 && parts.every((n) => Number.isFinite(n))) {
        width = parts[2];
        height = parts[3];
      }
    }
  }

  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null;
  }
  return { width, height };
}

export interface SvgToPngOptions {
  /** 设备像素倍率(默认 2,Retina 清晰)。 */
  scale?: number;
  /**
   * 背景填充(默认透明)。X compose 框 / 推文是深色主题,透明 PNG 上传后由 X 自配底,
   * 不会白底黑边突兀;若需固定底色可传(如 '#15202b')。
   */
  background?: string;
}

/**
 * SVG 字符串 → PNG dataURL(`data:image/png;base64,...`)。
 *
 * 调用方须保证 SVG 已带正确 width/height(或 viewBox)且**紧贴内容**(本函数不裁白边)。
 * X 截图链路里:公式走 renderTeX 直出紧凑 SVG、代码块背景按最长行裁、Mermaid 本就紧凑。
 * (曾试过用 DOM getBBox 自动裁白边,但 getBBox 对带 transform 的 MathJax SVG 量不准、
 *  导致公式错切 —— 已废弃,改为"上游各自产出紧凑 SVG"。)
 *
 * @throws 尺寸读不到 / 解码失败 / canvas 不可用 时 reject(fail loud)。
 */
export function svgToPngDataUrl(svgString: string, options: SvgToPngOptions = {}): Promise<string> {
  const scale = options.scale ?? 2;

  const size = readSvgSize(svgString);
  if (!size) {
    return Promise.reject(
      new Error('svgToPng: 无法从 SVG 读出尺寸(无 width/height 也无 viewBox)'),
    );
  }
  const baseW = size.width;
  const baseH = size.height;

  return new Promise((resolve, reject) => {
    const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const img = new Image();

    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(baseW * scale));
        canvas.height = Math.max(1, Math.round(baseH * scale));
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          URL.revokeObjectURL(url);
          reject(new Error('svgToPng: canvas 2d context 不可用'));
          return;
        }
        if (options.background) {
          ctx.fillStyle = options.background;
          ctx.fillRect(0, 0, canvas.width, canvas.height);
        }
        ctx.scale(scale, scale);
        ctx.drawImage(img, 0, 0, baseW, baseH);
        URL.revokeObjectURL(url);
        resolve(canvas.toDataURL('image/png'));
      } catch (err) {
        URL.revokeObjectURL(url);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('svgToPng: SVG 解码为图像失败(SVG 语法错 / 字体外链等)'));
    };
    img.src = url;
  });
}
