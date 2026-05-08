/**
 * media-storage capability — renderer 侧媒体存储能力
 *
 * 职责:把 base64 / 远程 URL 写进 main 进程的 media 文件夹,返回 `media://` URL;
 * 把 media:// URL 解析为本地文件系统路径(给 shell.openPath / shell.showItemInFolder 用)。
 *
 * 实现位置:src/platform/main/media/media-store-impl.ts(纯 main 进程,文件系统 + JSON 索引)。
 * 本文件是 renderer 侧 IPC 调用封装。
 *
 * ── 历史(audit Wave 3.1)──
 *
 * 文件原位于 src/storage/media-store.ts,但本质是 IPC + 主进程文件系统(不走
 * SurrealDB),与 charter § 1.3 "storage = SurrealDB SDK" 角色不符;并且
 * 7 处 driver + 1 处 view 直接 import @storage/* 形成跨层穿透(audit P1-5)。
 *
 * Wave 3.1 把整文件迁到 capability 层归位,storage/media-store.ts 留
 * @deprecated re-export 兜底。新代码请直接 import from '@capabilities/media-storage'。
 *
 * ── 用途 ──
 *
 * - md-to-pm 转 Markdown 时遇到 base64 图,先 putBase64 转成 media:// URL
 * - paste-media-plugin 粘贴图片/文件 → put → 写入文档 src
 * - file/image/audio/video block 拖入文件 → put → 渲染 media:// URL
 * - file-block / file-link "在 Finder 显示" → resolvePath → shell.showItemInFolder
 * - link-click-plugin 处理 media:// 链接 → resolvePath → shell.openPath
 *
 * 类型契约保留 V1 mediaSurrealStore 同款结构,但去掉 SurrealDB 依赖。
 */

import { capabilityRegistry } from '@slot/capability-registry/capability-registry';

export interface MediaPutResult {
  success: boolean;
  /** media:// 协议 URL,可直接放进 PM image src / webview src */
  mediaUrl?: string;
  /** 内部 ID(去重 hash 前缀)*/
  mediaId?: string;
  error?: string;
}

/**
 * 把 base64(完整 data URL 或 raw)写进 media store,返回 media:// URL
 *
 * - 接受 `data:<mime>;base64,<b64>` 完整 data URL,或 raw base64 + explicitMime
 * - SHA256 去重,同一份内容只写一份文件
 * - 大小限制:image/files 20MB,audio 50MB,video 200MB
 */
export async function mediaPutBase64(
  input: string,
  explicitMime?: string,
  hintedFilename?: string,
): Promise<MediaPutResult> {
  if (!window.electronAPI?.mediaPutBase64) {
    return { success: false, error: 'electronAPI.mediaPutBase64 not available' };
  }
  return window.electronAPI.mediaPutBase64(input, explicitMime, hintedFilename);
}

/**
 * 从远程 URL 下载到 media store,返回 media:// URL
 *
 * - 走 main 进程 net.fetch(无 CORS / cookie 限制)
 * - 同 URL 已下载过 → 返回缓存的 mediaUrl
 * - 下载失败 / HTTP 非 2xx / 超大小 → success:false + error
 */
export async function mediaDownload(
  url: string,
  type: 'audio' | 'image' | 'video',
): Promise<MediaPutResult> {
  if (!window.electronAPI?.mediaDownload) {
    return { success: false, error: 'electronAPI.mediaDownload not available' };
  }
  return window.electronAPI.mediaDownload(url, type);
}

/**
 * media:// URL → 本地文件系统绝对路径(L5-B3.14)
 *
 * 给 file-block / file-link / external-ref 的"打开"和"在 Finder 显示"用 —
 * `shell.openPath` 和 `shell.showItemInFolder` 不接受 media:// 协议,需要本地路径。
 *
 * 失败(URL 无效 / 越界 / 文件不存在)返回 null。
 */
export async function mediaResolvePath(mediaUrl: string): Promise<string | null> {
  if (!window.electronAPI?.mediaResolvePath) return null;
  try {
    const r = await window.electronAPI.mediaResolvePath(mediaUrl);
    return r.success ? r.path ?? null : null;
  } catch {
    return null;
  }
}

// Wave 1 模式:注册到 Registry,让 install 可校验(charter § 1.2)
// Wave 5:加 api 字段(MediaStorageApi 形态),view 通过 requireCapabilityApi 间接拿
capabilityRegistry.register({
  id: 'media-storage',
  api: { mediaPutBase64, mediaDownload, mediaResolvePath },
});
