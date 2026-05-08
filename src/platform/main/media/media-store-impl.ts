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

import { app, protocol, net } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';

const MEDIA_DIR = path.join(app.getPath('userData'), 'krig-data', 'media');
const INDEX_FILE = path.join(MEDIA_DIR, 'media-index.json');

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
   * 注册 media:// 协议(全局 default session)
   *
   * 必须在 app.whenReady 之后、第一个 webview 创建之前调,否则 webview 加载
   * media://... 会 ERR_FILE_NOT_FOUND
   */
  registerProtocol(): void {
    protocol.handle('media', (request) => {
      const urlPath = request.url.replace('media://', '');
      const filePath = path.join(MEDIA_DIR, urlPath);
      return net.fetch(`file://${filePath}`);
    });
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
