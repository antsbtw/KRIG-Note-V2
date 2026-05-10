/**
 * Graph 平台层入口(L5-G1)
 *
 * 由 platform/main/ipc/ipc-bus.ts 调 registerGraphHandlers() 一次性接进 ipc 路由。
 * 单例 canvasStore 在首次 IPC 触发时 lazy load(对齐 ebook bookshelfStore 模式)。
 */

export { registerGraphHandlers } from './library-handlers';
export { canvasStore } from './canvas-store';
export type {
  GraphCanvasRecord,
  GraphCanvasListItem,
  GraphFolderRecord,
  GraphVariant,
  CanvasDocumentJson,
} from './canvas-store';
