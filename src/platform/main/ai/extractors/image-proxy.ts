/**
 * Image Proxy — markdown 内跨域 img URL → media:// 替换
 *
 * 场景:
 * - Claude artifact 图(claudeusercontent.com 等跨域)
 * - ChatGPT DALL-E / Code Interpreter 图(已经是 base64 dataUrl,不需要本模块)
 * - Gemini Imagen 图(googleusercontent.com 等)
 *
 * 流程:
 *   1. 扫描 markdown 中所有 ![alt](url) 模式
 *   2. 过滤:跳过 already-media:// / data:base64 / 本地 file:// 路径
 *   3. 对每个外部 URL:用 net.fetch 下载到 buffer
 *   4. base64 编码 + mediaStore.putBase64 写入 media store 得 media:// URL
 *   5. 替换原 URL 为 media:// URL
 *
 * 失败容忍:某个 URL 下载失败时保留原 URL(不阻塞整体提取)。
 * 并发限制:同时最多 5 个下载(避免淹没主进程网络)。
 */

import { net } from 'electron';
import { mediaStore } from '../../media/media-store-impl';

interface ImageRef {
  fullMatch: string;
  alt: string;
  url: string;
  offset: number;
}

const MD_IMAGE_RE = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const MAX_CONCURRENT = 5;

function shouldProxy(url: string): boolean {
  if (!url) return false;
  if (url.startsWith('media://')) return false;
  if (url.startsWith('data:')) return false;
  if (url.startsWith('file://')) return false;
  if (url.startsWith('blob:')) return false;
  return url.startsWith('http://') || url.startsWith('https://');
}

function collectImages(markdown: string): ImageRef[] {
  const refs: ImageRef[] = [];
  MD_IMAGE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = MD_IMAGE_RE.exec(markdown)) !== null) {
    refs.push({
      fullMatch: m[0],
      alt: m[1],
      url: m[2],
      offset: m.index,
    });
  }
  return refs;
}

/**
 * 下载单个 URL → base64 → mediaStore → 返 media:// URL。
 * 失败返 null 保留原 URL。
 */
async function downloadOne(url: string): Promise<string | null> {
  try {
    const resp = await net.fetch(url, {
      // session 用 default(不带 webview cookie);AI 图片大多是公开 URL 不需 auth
      credentials: 'omit',
    });
    if (!resp.ok) {
      console.warn(`[image-proxy] download fail status=${resp.status} url=${url.slice(0, 100)}`);
      return null;
    }
    const ct = resp.headers.get('content-type') || '';
    if (!ct.startsWith('image/') && !ct.startsWith('application/octet-stream')) {
      console.warn(`[image-proxy] not image content-type=${ct} url=${url.slice(0, 100)}`);
      return null;
    }
    const buf = await resp.arrayBuffer();
    if (buf.byteLength === 0) return null;
    const b64 = Buffer.from(buf).toString('base64');
    const hintedName = url.split('?')[0].split('/').pop() || undefined;
    const result = await mediaStore.putBase64(b64, ct, hintedName);
    if (!result.success || !result.mediaUrl) {
      console.warn(`[image-proxy] mediaStore.putBase64 fail`, result.error);
      return null;
    }
    return result.mediaUrl;
  } catch (err) {
    console.warn(`[image-proxy] download exception url=${url.slice(0, 100)}`, err);
    return null;
  }
}

/**
 * 限流并发 — 简化版 promise pool。
 */
async function downloadAll(urls: string[]): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  const queue = [...new Set(urls)]; // 去重
  while (queue.length > 0) {
    const batch = queue.splice(0, MAX_CONCURRENT);
    const results = await Promise.all(
      batch.map(async (url) => ({ url, result: await downloadOne(url) })),
    );
    for (const { url, result } of results) {
      out.set(url, result);
    }
  }
  return out;
}

/**
 * 入口:扫 markdown,代理所有外部图,返回替换后的 markdown。
 */
export async function proxyImagesInMarkdown(markdown: string): Promise<string> {
  const refs = collectImages(markdown);
  const externalUrls = refs.filter((r) => shouldProxy(r.url)).map((r) => r.url);
  if (externalUrls.length === 0) return markdown;

  console.log(`[image-proxy] downloading ${externalUrls.length} image(s)`);
  const urlMap = await downloadAll(externalUrls);

  // 替换 — 从后往前扫(避免 offset 漂移)
  let result = markdown;
  const sortedRefs = [...refs].sort((a, b) => b.offset - a.offset);
  for (const ref of sortedRefs) {
    const mediaUrl = urlMap.get(ref.url);
    if (!mediaUrl) continue; // 失败保留原 URL
    const newMd = `![${ref.alt}](${mediaUrl})`;
    result = result.slice(0, ref.offset) + newMd + result.slice(ref.offset + ref.fullMatch.length);
  }
  const successCount = Array.from(urlMap.values()).filter((v) => v !== null).length;
  console.log(`[image-proxy] proxied ${successCount}/${externalUrls.length} image(s) to media://`);
  return result;
}
