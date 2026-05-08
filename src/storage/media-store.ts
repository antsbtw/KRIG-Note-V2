/**
 * @deprecated Wave 3.1 起 media-store 已迁到 src/capabilities/media-storage/index.ts
 *
 * 本文件保留 re-export 兜底。新代码请直接 import from '@capabilities/media-storage'。
 *
 * 迁移原因:media-store 本质是 IPC + 主进程文件系统(不走 SurrealDB),
 * 与 charter § 1.3 "storage = SurrealDB SDK" 角色不符;并且 driver/view
 * 直接 import @storage/* 形成跨层穿透(audit P1-5)。
 *
 * 实现归位到 capability 层,storage/ 恢复为 SurrealDB 专属。
 */

export {
  mediaPutBase64,
  mediaDownload,
  mediaResolvePath,
} from '@capabilities/media-storage';
export type { MediaPutResult } from '@capabilities/media-storage';
