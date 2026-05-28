/**
 * emf-decoder — 把 docx 嵌入的 EMF/WMF 矢量图转 PNG data URL
 *
 * 背景(2026-05-27 反馈):docx 嵌的 Office 元文件(EMF/WMF)走 mammoth/pandoc 后
 * 以 `data:image/x-emf;base64,...` 形态进入 markdown。**Chromium 不渲染 EMF/WMF**,
 * 用户感知"图丢了"。emf-converter npm 包能在 Node 端解析 EMF 记录流并 replay 到
 * Canvas 出 PNG —— 但它假设浏览器环境,需 polyfill OffscreenCanvas/FileReader/
 * ImageData/Image 才能在 Electron main 进程跑。
 *
 * 实测(/tmp probe,2026-05-27):
 * - 1.8MB EMF → 205KB PNG,46ms,产物正确(架构图复刻完整)
 * - @napi-rs/canvas 1.0 提供原生 Canvas(macOS arm64 / linux x64 / win 全平台预编 binary)
 *
 * 用法:
 *   import { decodeMetafileToPngDataUrl, isMetafileMime } from './emf-decoder';
 *   const pngUrl = await decodeMetafileToPngDataUrl(emfBuffer, 'image/x-emf');
 *   // pngUrl === null → 转换失败,caller 决定 fallback(留原图 / 用 placeholder)
 */

import {
  Canvas,
  Image as NapiImage,
  ImageData as NapiImageData,
} from '@napi-rs/canvas';

// ── polyfill 一次性安装(模块加载即生效)───────────────────────────────────
// 注:这些 global 在 main 进程默认不存在,emf-converter 用 instanceof 检测必须满足
let polyfillInstalled = false;

function ensurePolyfills(): void {
  if (polyfillInstalled) return;

  // V2 tsconfig 加载了 lib.dom(因 renderer 用),globalThis 上的 OffscreenCanvas /
  // ImageData / Image / FileReader 都有浏览器原生类型声明,跟我们 main 进程的
  // napi-rs polyfill 不兼容。本模块只在 main 跑,赋值统一 cast 中转。
  const g = globalThis as unknown as Record<string, unknown>;

  if (typeof g.ImageData === 'undefined') {
    g.ImageData = NapiImageData;
  }
  if (typeof g.Image === 'undefined') {
    g.Image = NapiImage;
  }

  // OffscreenCanvas:emf-converter 用 `canvas instanceof OffscreenCanvas` 判分支,
  // 必须**真**继承 napi-rs Canvas(否则 drawImage(canvas) 不被 napi-rs 接受)
  if (typeof g.OffscreenCanvas === 'undefined') {
    class PolyOffscreenCanvas extends Canvas {
      // 不声明覆盖父类签名(napi-rs Canvas 的 convertToBlob 类型跟我们 shim 不一致),
      // 用 any 通道注入运行时方法
    }
    (PolyOffscreenCanvas.prototype as unknown as {
      convertToBlob: (opts?: { type?: string }) => Promise<unknown>;
    }).convertToBlob = async function (opts?: { type?: string }) {
      const mime = opts?.type ?? 'image/png';
      const buf = (this as unknown as Canvas).toBuffer('image/png');
      return {
        type: mime,
        size: buf.byteLength,
        arrayBuffer: async () => buf,
      };
    };
    g.OffscreenCanvas = PolyOffscreenCanvas;
  }

  // FileReader:emf-converter 用 readAsDataURL(blob) → onload 取 .result
  if (typeof g.FileReader === 'undefined') {
    class PolyFileReader {
      onload: (() => void) | null = null;
      onerror: ((e: unknown) => void) | null = null;
      result: string | null = null;
      readAsDataURL(blob: { type: string; arrayBuffer: () => Promise<ArrayBuffer> }): void {
        Promise.resolve(blob.arrayBuffer())
          .then((ab) => {
            const buf = Buffer.from(ab);
            this.result = `data:${blob.type};base64,${buf.toString('base64')}`;
            this.onload?.();
          })
          .catch((e) => this.onerror?.(e));
      }
    }
    g.FileReader = PolyFileReader;
  }

  polyfillInstalled = true;
}

/** 判定 mimetype 是否是需要降级转 PNG 的 Office 元文件 */
export function isMetafileMime(mime: string | undefined | null): boolean {
  if (!mime) return false;
  const lower = mime.toLowerCase();
  return (
    lower === 'image/x-emf' ||
    lower === 'image/emf' ||
    lower === 'image/x-wmf' ||
    lower === 'image/wmf'
  );
}

/** 判定文件路径扩展名是否是 EMF/WMF(给 pandoc --extract-media 输出的文件用)*/
export function isMetafileExt(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  return lower.endsWith('.emf') || lower.endsWith('.wmf');
}

/**
 * 把 EMF/WMF 二进制转 PNG data URL
 *
 * @param buffer  EMF/WMF 原始字节(Buffer 或 ArrayBuffer)
 * @param mime    `image/x-emf` / `image/x-wmf` / `image/emf` / `image/wmf`
 *                未知或不匹配 → 直接返 null
 * @returns       `data:image/png;base64,...` 或 null(转换失败)
 */
export async function decodeMetafileToPngDataUrl(
  buffer: Buffer | ArrayBuffer,
  mime: string,
): Promise<string | null> {
  if (!isMetafileMime(mime)) return null;

  ensurePolyfills();

  // 转 ArrayBuffer slice(emf-converter 签名要 ArrayBuffer;Node Buffer.buffer
  // 在 ts lib 严格态被推断成 ArrayBufferLike,必须显式拷一份纯 ArrayBuffer)
  let ab: ArrayBuffer;
  if (buffer instanceof ArrayBuffer) {
    ab = buffer;
  } else {
    const view = buffer as Buffer;
    ab = new ArrayBuffer(view.byteLength);
    new Uint8Array(ab).set(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
  }

  try {
    // 动态 import 避免启动期把 emf-converter 的 ~4000 行常量表都装进 main bundle
    const lower = mime.toLowerCase();
    const isWmf = lower.includes('wmf');

    const mod = await import('emf-converter');
    const fn = isWmf ? mod.convertWmfToDataUrl : mod.convertEmfToDataUrl;
    return await fn(ab);
  } catch (err) {
    console.warn('[emf-decoder] decode failed:', err);
    return null;
  }
}
