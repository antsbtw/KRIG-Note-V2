/**
 * mediaStore 实现(main 进程,L5-B4.3.1)
 *
 * 直迁 V1 src/main/media/media-store.ts + media-surreal-store.ts 子集,
 * **DB 路径剥离**(V2 没 SurrealDB),索引存 JSON 文件。
 *
 * 职责:
 * - 注册 media:// 协议,把 media://path → file://{userData}/krig-data/media/path
 * - putBase64:base64 / data URL → 写文件 + 返回 media:// URL(SHA256 去重)
 * - download:远程 URL → 下载 + 写文件 + 返回 media:// URL(URL 去重)
 *
 * 存储结构:
 * {userData}/krig-data/media/
 *   ├── images/       img-{hash16}.{ext}
 *   ├── audio/        audio-{hash16}.{ext}
 *   ├── video/        video-{hash16}.{ext}
 *   ├── files/        file-{hash16}.{ext}        (其他 MIME)
 *   └── media-index.json   { version, entries: { url → entry } }
 *
 * 索引 entries key 是 originalUrl(download 用),putBase64 不写索引(SHA256 + 文件存在性
 * 已经能去重)— 简化设计,跟 V1 mediaSurrealStore.putBase64 写 DB 行为对齐(DB 部分是
 * non-fatal,renderer 走文件系统访问也能用)
 */

import { app, protocol, net, session } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { WEBVIEW_PARTITION } from '@shared/constants/webview';

const MEDIA_DIR = path.join(app.getPath('userData'), 'krig-data', 'media');
const INDEX_FILE = path.join(MEDIA_DIR, 'media-index.json');

/**
 * 注入到 media:// .html 响应中的主题 CSS + 高度回传 bridge
 *
 * - theme:AI artifact 常用 var(--color-*) 引用主题色,iframe 独立文档默认没这些
 *   变量,直接渲染会丢色;在 head 顶部注 :root{ --... } 兜底。
 * - bridge:iframe 与 parent 跨 origin,parent 读不到 contentDocument 测高;让
 *   iframe 内部用 ResizeObserver 监听 body 高度,通过 parent.postMessage 回传。
 *   tag 字段供 parent 过滤其他 message 来源。
 */
const HTML_BLOCK_THEME_BRIDGE = `<style>
:root {
  --color-text-primary: #e8e8e8;
  --color-text-secondary: #a3a3a3;
  --color-text-tertiary: #737373;
  --text-color-primary: #e8e8e8;
  --text-color-secondary: #a3a3a3;
  --text-color-tertiary: #737373;
  --fg-color: #e8e8e8;
  --color-bg-primary: #1e1e1e;
  --color-bg-secondary: #2a2a2a;
  --color-bg-tertiary: #3a3a3a;
  --color-background-primary: #1e1e1e;
  --color-background-secondary: #2a2a2a;
  --color-background-tertiary: #3a3a3a;
  --bg-color: #1e1e1e;
  --color-border-primary: #5a5a5a;
  --color-border-secondary: #4a4a4a;
  --color-border-tertiary: #3a3a3a;
  --color-text-info: #78c8f0;
  --color-background-info: rgba(120, 200, 240, 0.12);
  --color-border-info: rgba(120, 200, 240, 0.25);
  --color-text-warning: #e8a820;
  --color-background-warning: rgba(232, 168, 32, 0.12);
  --color-border-warning: rgba(232, 168, 32, 0.25);
  --color-text-success: #4ade80;
  --color-background-success: rgba(74, 222, 128, 0.12);
  --color-border-success: rgba(74, 222, 128, 0.25);
  --color-text-danger: #f87171;
  --color-background-danger: rgba(248, 113, 113, 0.12);
  --color-border-danger: rgba(248, 113, 113, 0.25);
  --border-radius-sm: 4px;
  --border-radius-md: 8px;
  --border-radius-lg: 12px;
  --border-radius-xl: 16px;
}
body {
  background: var(--color-background-primary, #1e1e1e);
  color: var(--color-text-primary, #e8e8e8);
  font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
}
html, body {
  scrollbar-width: none;
  -ms-overflow-style: none;
}
html::-webkit-scrollbar,
body::-webkit-scrollbar {
  display: none;
}
</style>`;

const HTML_BLOCK_BRIDGE_SCRIPT = `<script>
(function() {
  // 一次定型策略(对齐 Claude artifact 哲学):AI artifact 几乎都是"画一次就稳定"
  // 的展示型内容,不需要持续高度跟随。持续监听 + 回传会让 Chart.js / D3 等
  // responsive lib 形成 "iframe 撑高 → 容器变 → lib 重排 → body 又涨" 的反馈
  // 死循环。改为:load 事件后 STABLE_DELAY_MS 单次测量定型,之后不再报告。
  //
  // 用户后续如果需要调整高度,用 resize handle 拖拽(NodeView parent 端已支持)。
  // 稳态收敛策略(应对 iframe 在折叠/不可见容器内、PM hydrate 时序错位等情况):
  //   - 每 POLL_MS 测一次 body content-intrinsic height
  //   - 连续 STABLE_HITS 次值不变(差 <2px)且 > 0 → 报告 + 停轮询
  //   - 测到 0(body 没就绪 / iframe 被隐藏)不计稳定,继续轮询直到 MAX_WAIT_MS
  //   - MAX_WAIT_MS 时:有非 0 历史值就报最后一次;一直 0 则停轮询,改挂
  //     IntersectionObserver 等 iframe 变可见时重启,避免 toggle 折叠 / 懒加载场景
  var POLL_MS = 100;
  var STABLE_HITS = 3;
  var MAX_WAIT_MS = 3000;
  var lastH = -1;
  var stableCount = 0;
  var startedAt = 0;
  var pollId = 0;
  function measure() {
    var body = document.body;
    if (!body) return 0;
    var prevH = body.style.height;
    var prevO = body.style.overflow;
    body.style.height = 'auto';
    body.style.overflow = 'visible';
    var h = body.getBoundingClientRect().height;
    body.style.height = prevH;
    body.style.overflow = prevO;
    return h;
  }
  function postIfReady() {
    if (lastH > 0 && window.parent && window.parent !== window) {
      window.parent.postMessage({ tag: 'krig-html-resize', height: lastH }, '*');
      return true;
    }
    return false;
  }
  function tick() {
    var h = measure();
    if (h > 0) {
      if (Math.abs(h - lastH) < 2) {
        stableCount++;
      } else {
        stableCount = 0;
        lastH = h;
      }
    } else {
      // 测到 0 — 不计稳定也不更新 lastH,继续等
      stableCount = 0;
    }
    if (stableCount >= STABLE_HITS) {
      postIfReady();
      clearInterval(pollId);
      pollId = 0;
      return;
    }
    if (Date.now() - startedAt > MAX_WAIT_MS) {
      // 兜底超时
      if (postIfReady()) {
        clearInterval(pollId);
        pollId = 0;
      } else {
        // 一直 0:iframe 大概率被隐藏(toggle 折叠 / display:none),停轮询省 CPU,
        // 等 IntersectionObserver 报告 iframe 可见时再 start。
        clearInterval(pollId);
        pollId = 0;
        if (typeof IntersectionObserver !== 'undefined' && document.documentElement) {
          var io = new IntersectionObserver(function(entries) {
            for (var i = 0; i < entries.length; i++) {
              if (entries[i].isIntersecting) {
                io.disconnect();
                start();
                break;
              }
            }
          });
          io.observe(document.documentElement);
        }
      }
    }
  }
  function start() {
    if (pollId) return;
    startedAt = Date.now();
    lastH = -1;
    stableCount = 0;
    pollId = setInterval(tick, POLL_MS);
  }
  if (document.readyState === 'complete') {
    start();
  } else {
    window.addEventListener('load', start);
  }
  // parent 可见性变化(toggle 展开 / 滚动进视口)时主动通知 iframe 重测
  window.addEventListener('message', function(e) {
    if (e.data && e.data.tag === 'krig-html-remeasure') start();
  });
})();
</script>`;

function injectHtmlBlockBridge(html: string): string {
  let out = html;
  if (out.includes('</head>')) {
    out = out.replace('</head>', HTML_BLOCK_THEME_BRIDGE + '</head>');
  } else if (out.includes('<body')) {
    out = out.replace('<body', HTML_BLOCK_THEME_BRIDGE + '<body');
  } else {
    out = HTML_BLOCK_THEME_BRIDGE + out;
  }
  if (out.includes('</body>')) {
    out = out.replace('</body>', HTML_BLOCK_BRIDGE_SCRIPT + '</body>');
  } else {
    out = out + HTML_BLOCK_BRIDGE_SCRIPT;
  }
  return out;
}

const SIZE_LIMITS: Record<string, number> = {
  audio: 50 * 1024 * 1024,
  video: 200 * 1024 * 1024,
  image: 20 * 1024 * 1024,
};

const MIME_TO_EXT: Record<string, string> = {
  // audio
  'audio/mpeg': 'mp3',
  'audio/ogg': 'ogg',
  'audio/wav': 'wav',
  'audio/webm': 'webm',
  'audio/aac': 'aac',
  'audio/flac': 'flac',
  'audio/mp4': 'm4a',
  // image
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  // video
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
  // documents
  'application/pdf': 'pdf',
  'application/zip': 'zip',
  'application/x-tar': 'tar',
  'application/gzip': 'gz',
  'application/x-7z-compressed': '7z',
  'application/json': 'json',
  'application/xml': 'xml',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  // text
  'text/plain': 'txt',
  'text/html': 'html',
  'text/css': 'css',
  'text/csv': 'csv',
  'text/markdown': 'md',
  'text/javascript': 'js',
  'application/javascript': 'js',
  'application/typescript': 'ts',
};

interface MediaIndexEntry {
  mediaId: string;
  originalUrl: string;
  localPath: string;
  size: number;
  mimeType: string;
  createdAt: number;
}

interface MediaIndex {
  version: number;
  entries: Record<string, MediaIndexEntry>;
}

function ensureDirs(): void {
  for (const sub of ['images', 'audio', 'video', 'files']) {
    fs.mkdirSync(path.join(MEDIA_DIR, sub), { recursive: true });
  }
}

function extFromUrl(url: string): string {
  const m = url.match(/\.(\w{2,5})(?:\?|$)/);
  return m?.[1] || '';
}

function extForMime(mimeType: string): string {
  const core = mimeType.split(';')[0].trim();
  return MIME_TO_EXT[core] || 'bin';
}

/**
 * MIME 分桶(决定子目录 + 文件名前缀)
 *   image/*   → 'images',前缀 'img'
 *   audio/*   → 'audio',前缀 'audio'
 *   video/*   → 'video',前缀 'video'
 *   其他      → 'files',前缀 'file'(pdf / zip / json / 等)
 */
function bucketForMime(mimeType: string): 'images' | 'audio' | 'video' | 'files' {
  const core = mimeType.split(';')[0].trim();
  if (core.startsWith('image/')) return 'images';
  if (core.startsWith('audio/')) return 'audio';
  if (core.startsWith('video/')) return 'video';
  return 'files';
}

function prefixForBucket(bucket: 'images' | 'audio' | 'video' | 'files'): string {
  if (bucket === 'images') return 'img';
  if (bucket === 'audio') return 'audio';
  if (bucket === 'video') return 'video';
  return 'file';
}

function sizeLimitForBucket(bucket: 'images' | 'audio' | 'video' | 'files'): number {
  if (bucket === 'audio') return SIZE_LIMITS.audio;
  if (bucket === 'video') return SIZE_LIMITS.video;
  // images / files 都用 image 限额(V1 默认行为)
  return SIZE_LIMITS.image;
}

class MediaStore {
  private index: MediaIndex = { version: 1, entries: {} };

  /**
   * media:// 协议 handler(default + 每个 webview partition session 复用同一函数)。
   * registerProtocol 时构建一次。
   */
  private mediaHandler: ((request: Request) => Promise<Response>) | null = null;

  /**
   * per-ws 代理阶段1:partition 改 `persist:webview-${wsId}` 后,每个 ws 是不同 session,
   * media:// 协议必须按 session 实例补注册(去重),否则 webview 图片 ERR_UNKNOWN_URL_SCHEME。
   */
  private wiredMediaSessions = new WeakSet<Electron.Session>();

  constructor() {
    this.ensureLoaded();
  }

  /** 启动时调一次:建目录 + load 索引 */
  private ensureLoaded(): void {
    ensureDirs();
    try {
      if (fs.existsSync(INDEX_FILE)) {
        this.index = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf-8'));
      }
    } catch {
      this.index = { version: 1, entries: {} };
    }
  }

  private saveIndex(): void {
    try {
      fs.writeFileSync(INDEX_FILE, JSON.stringify(this.index, null, 2));
    } catch {
      /* non-fatal: renderer 仍能通过文件系统访问 media:// */
    }
  }

  /**
   * 注册 media:// 协议
   *
   * 注册范围:
   * - default session:主 renderer 内 iframe / img / video / audio 等
   * - 旧全局 persist:webview partition:legacy/防御性补一次(per-ws 化后 AI/X/浏览器
   *   都走 persist:webview-${ws},各 ws session 由 did-attach-webview →
   *   registerMediaForSession 补注册,见下方)。
   *
   * Electron `protocol.handle` 默认只在 default session 生效;webview 用独立
   * partition session,**必须显式再注册一次**,否则 webview 加载 media:// 会
   * ERR_UNKNOWN_URL_SCHEME / ERR_FILE_NOT_FOUND。
   *
   * 必须在 app.whenReady 之后、第一个 webview 创建之前调。
   */
  registerProtocol(): void {
    const handler = async (request: Request): Promise<Response> => {
      const urlPath = request.url.replace('media://', '');
      const filePath = path.join(MEDIA_DIR, urlPath);
      // .html 资源:在主进程注入 theme + bridge,让 NoteView htmlBlock 内嵌的 iframe
      // 加载 media:// HTML 时获得跨 origin(脱离 parent CSP)的 inline script 执行能力
      // + 高度自适应回传。详见 drivers/text-editing-driver/blocks/html-block/node-view.ts。
      if (filePath.toLowerCase().endsWith('.html') || filePath.toLowerCase().endsWith('.htm')) {
        try {
          const html = await fs.promises.readFile(filePath, 'utf-8');
          const injected = injectHtmlBlockBridge(html);
          return new Response(injected, {
            status: 200,
            headers: { 'Content-Type': 'text/html; charset=utf-8' },
          });
        } catch (err) {
          return new Response(`Failed to load ${urlPath}: ${(err as Error).message}`, { status: 404 });
        }
      }
      return net.fetch(`file://${filePath}`);
    };

    this.mediaHandler = handler;

    protocol.handle('media', handler);
    // default session 不进 wiredMediaSessions(它走 protocol.handle 全局,不是 partition session)。
    const legacySess = session.fromPartition(WEBVIEW_PARTITION);
    legacySess.protocol.handle('media', handler);
    this.wiredMediaSessions.add(legacySess);
  }

  /**
   * per-ws:某个 ws 的 webview 首次 attach 时,对其 partition session 补注册 media:// 协议
   * (WeakSet 去重)。在主进程 did-attach-webview 钩子里对 guest.session 调。
   * protocol.handle 同步,且 did-attach-webview 早于 guest 内页面发 media:// 请求,时序安全。
   */
  registerMediaForSession(sess: Electron.Session): void {
    if (this.wiredMediaSessions.has(sess)) return;
    if (!this.mediaHandler) {
      // registerProtocol 必在 createMainWindow 前调,理论不会走到这。防御性 warn。
      console.warn('[media] registerMediaForSession 在 registerProtocol 之前调用,跳过');
      return;
    }
    this.wiredMediaSessions.add(sess);
    sess.protocol.handle('media', this.mediaHandler);
  }

  /**
   * 下载远程媒体到本地(URL 去重)
   *
   * - 同 URL 已下载过且文件还在 → 返回缓存
   * - HTTP 非 2xx / 超大小 → success:false
   * - net.fetch 失败 → success:false
   */
  async download(
    url: string,
    mediaType: 'audio' | 'image' | 'video',
  ): Promise<{ success: boolean; mediaUrl?: string; mediaId?: string; error?: string }> {
    // URL 去重
    const existing = this.index.entries[url];
    if (existing && fs.existsSync(existing.localPath)) {
      return {
        success: true,
        mediaId: existing.mediaId,
        mediaUrl: `media://${path.relative(MEDIA_DIR, existing.localPath)}`,
      };
    }

    try {
      const response = await net.fetch(url);
      if (!response.ok) return { success: false, error: `HTTP ${response.status}` };

      const limit = SIZE_LIMITS[mediaType] ?? SIZE_LIMITS.image;
      const contentLength = parseInt(response.headers.get('content-length') || '0', 10);
      if (contentLength > limit) {
        return {
          success: false,
          error: `File too large (${Math.round(contentLength / 1024 / 1024)}MB > ${Math.round(limit / 1024 / 1024)}MB limit)`,
        };
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      // 实际下载完后再次校验大小(content-length 可能为 0 / 谎报)
      if (buffer.length > limit) {
        return {
          success: false,
          error: `File too large (${Math.round(buffer.length / 1024 / 1024)}MB > ${Math.round(limit / 1024 / 1024)}MB limit)`,
        };
      }

      const hash = createHash('sha256').update(buffer).digest('hex').slice(0, 16);
      const mimeType = response.headers.get('content-type') || '';
      const ext = MIME_TO_EXT[mimeType.split(';')[0].trim()] || extFromUrl(url) || 'bin';
      const subDir = mediaType === 'audio' ? 'audio' : mediaType === 'video' ? 'video' : 'images';
      const prefix = prefixForBucket(subDir);
      const mediaId = `${prefix}-${hash}`;
      const fileName = `${mediaId}.${ext}`;
      const filePath = path.join(MEDIA_DIR, subDir, fileName);

      if (!fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, buffer);
      }

      this.index.entries[url] = {
        mediaId,
        originalUrl: url,
        localPath: filePath,
        size: buffer.length,
        mimeType,
        createdAt: Date.now(),
      };
      this.saveIndex();

      return { success: true, mediaId, mediaUrl: `media://${subDir}/${fileName}` };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  }

  /**
   * base64(完整 data URL 或 raw)→ 媒体文件 + media:// URL
   *
   * - 接受 `data:<mime>;base64,<b64>` 或 raw base64 + explicitMime
   * - SHA256 去重,同内容只写一份(MIME 决定子目录)
   * - 文件名 ext 来源:hintedFilename 后缀 > MIME 查表 > 'bin'
   *   (macOS Finder 看 ext 选 handler,错的 ext 会让 Archive Utility 误启)
   * - 不写 index entries(SHA256 + 文件存在性已能跨调用去重)
   */
  async putBase64(
    input: string,
    explicitMime?: string,
    hintedFilename?: string,
  ): Promise<{ success: boolean; mediaUrl?: string; mediaId?: string; error?: string }> {
    try {
      let b64: string;
      let mimeType = explicitMime || '';
      const m = input.match(/^data:([^;]+);base64,(.*)$/s);
      if (m) {
        mimeType = mimeType || m[1];
        b64 = m[2];
      } else {
        b64 = input;
      }
      if (!b64) return { success: false, error: 'empty base64 payload' };
      if (!mimeType) return { success: false, error: 'no mimeType for raw base64' };

      const buffer = Buffer.from(b64, 'base64');
      if (buffer.length === 0) return { success: false, error: 'decoded buffer is empty' };

      const subDir = bucketForMime(mimeType);
      const limit = sizeLimitForBucket(subDir);
      if (buffer.length > limit) {
        return {
          success: false,
          error: `Data too large (${Math.round(buffer.length / 1024 / 1024)}MB > ${Math.round(limit / 1024 / 1024)}MB limit)`,
        };
      }

      const hash = createHash('sha256').update(buffer).digest('hex').slice(0, 16);
      const hintExt = hintedFilename && hintedFilename.includes('.')
        ? hintedFilename.slice(hintedFilename.lastIndexOf('.') + 1).toLowerCase()
        : '';
      const ext = hintExt || extForMime(mimeType);
      const prefix = prefixForBucket(subDir);
      const mediaId = `${prefix}-${hash}`;
      const fileName = `${mediaId}.${ext}`;
      const filePath = path.join(MEDIA_DIR, subDir, fileName);
      const mediaUrl = `media://${subDir}/${fileName}`;

      if (!fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, buffer);
      }

      return { success: true, mediaUrl, mediaId };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  }
}

export const mediaStore = new MediaStore();

/**
 * L5-B3.14:把 media:// URL 解析为本地文件系统绝对路径
 *
 * 用于 file-block / file-link / external-ref 的"打开"和"在 Finder 显示"路径
 * (`shell.openPath` / `shell.showItemInFolder` 不接受 media:// 协议,需要本地路径)。
 *
 * 安全:防 ../../etc/passwd 越界 — path.resolve 后必须仍在 MEDIA_DIR 内。
 */
export function resolveMediaPath(mediaUrl: string): string | null {
  if (typeof mediaUrl !== 'string' || !mediaUrl.startsWith('media://')) return null;
  const urlPath = mediaUrl.replace('media://', '');
  const candidate = path.resolve(MEDIA_DIR, urlPath);
  // 越界白名单兜底:必须以 MEDIA_DIR + 分隔符 开头(防 sibling 路径如 .../media-evil)
  if (!candidate.startsWith(MEDIA_DIR + path.sep) && candidate !== MEDIA_DIR) return null;
  // 文件存在才返回
  try {
    if (!fs.existsSync(candidate)) return null;
  } catch {
    return null;
  }
  return candidate;
}
