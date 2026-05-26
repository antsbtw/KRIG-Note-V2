/**
 * pdfjs-dist Worker 初始化 — 4.x `workerPort` 风格
 *
 * 4.x deprecate 了 `GlobalWorkerOptions.workerSrc = string`(旧版会触发
 * "fake worker" fallback,主线程跑 PDF 解析,大文件直接卡死)。
 *
 * 新风格:`GlobalWorkerOptions.workerPort = Worker 实例`,适配器在 capability
 * 首次 import 时一次性初始化,后续 getDocument 自动复用。
 *
 * Vite + Electron renderer 装载方式:
 *   `new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url)` 让 Vite
 *   把 worker 脚本作为静态资源处理(dev 期走 dev server URL,packaged 期走 app://
 *   相对路径),配 `new Worker(url, { type: 'module' })` 即可。
 *
 * 不用 Vite 的 `?worker` 后缀:
 *   ?worker 会让 Vite 把脚本编译为一个独立 chunk,这对 pdfjs.worker.min.mjs(已是
 *   bundled IIFE-like ESM)是多余的;`new URL` 路径让 Vite 走 asset 处理,行为
 *   一致 + 与 Electron file:// 协议下的相对 URL 解析兼容。
 *
 * idempotent:重复 import 本模块只触发一次 Worker 构造(模块级单例)。
 */

import { GlobalWorkerOptions } from 'pdfjs-dist';

let workerInstance: Worker | null = null;

/**
 * 确保 pdfjs Worker 已初始化(idempotent)。
 *
 * adapter 内 loadDocument 调用前必须先调一次;模块顶层 import 时自调一次,
 * 让"import pdf-viewer capability"即可激活 Worker。
 */
export function ensurePdfWorker(): void {
  if (workerInstance) return;
  const url = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url,
  );
  workerInstance = new Worker(url, { type: 'module' });
  GlobalWorkerOptions.workerPort = workerInstance;
}

// 模块加载即初始化 — capability 入口 import 本文件触发
ensurePdfWorker();
