/**
 * graph-library-store capability — 对外类型(L5-G1)
 *
 * view 通过 requireCapabilityApi<GraphLibraryStoreApi>('graph-library-store') 取 api;
 * driver/slot 内部消费可直 import 单例 export(对齐 W5 严格态 A 边界)。
 *
 * 类型与 platform/main/graph 内部存储类型对齐(IPC 边界两侧形状一致)。
 * 不直接 import platform 内部类型,在此独立声明 — 跨进程边界对齐契约,
 * 不引入跨层依赖(对齐 ebook-library types 模式)。
 */

// ── 数据模型(对齐 platform/main/graph/canvas-store)──

/** v1 仅 'canvas';里程碑 H 接 family-tree;v1.5+ 加 knowledge / mindmap */
export type GraphVariant = 'canvas' | 'family-tree' | 'knowledge' | 'mindmap';

/** 画板内容 — 结构化 JSON(serialize.ts 输出形态);跨边界用 unknown 通用 */
export type CanvasDocumentJson = unknown;

/** 完整记录(load 时返回,含 doc_content)*/
export interface GraphCanvasRecord {
  id: string;
  title: string;
  doc_content: CanvasDocumentJson;
  variant: GraphVariant;
  folder_id: string | null;
  created_at: number;
  updated_at: number;
}

/** 列表项(list 时返回,不含 doc_content;决策 G1-6)*/
export interface GraphCanvasListItem {
  id: string;
  title: string;
  variant: GraphVariant;
  folder_id: string | null;
  updated_at: number;
}

export interface GraphFolderRecord {
  id: string;
  title: string;
  parent_id: string | null;
  sort_order: number;
  created_at: number;
}

// ── view 业务路径 API ──

export interface GraphLibraryStoreApi {
  // ── 画板 CRUD ──

  /** 列出全部画板(按 updated_at 倒序);不返 doc_content */
  list(): Promise<GraphCanvasListItem[]>;
  /** 按 id 取单画板(含 doc_content);不存在返 null */
  load(id: string): Promise<GraphCanvasRecord | null>;
  /** 新建画板(title 默认 'Untitled Canvas';返回完整记录) */
  create(
    title: string,
    variant: GraphVariant,
    folderId?: string | null,
  ): Promise<GraphCanvasRecord | null>;
  /** 保存画板内容(doc_content)+ 同步 title */
  save(id: string, docContent: CanvasDocumentJson, title: string): Promise<void>;
  remove(id: string): Promise<void>;
  rename(id: string, title: string): Promise<void>;
  moveToFolder(id: string, folderId: string | null): Promise<void>;
  duplicate(
    id: string,
    targetFolderId?: string | null,
  ): Promise<GraphCanvasRecord | null>;

  // ── 文件夹 CRUD ──

  folderList(): Promise<GraphFolderRecord[]>;
  folderCreate(title: string, parentId?: string | null): Promise<GraphFolderRecord | null>;
  folderRename(id: string, title: string): Promise<void>;
  folderDelete(id: string): Promise<void>;
  folderMove(id: string, parentId: string | null): Promise<void>;

  // ── 推送订阅 ──

  /** 订阅画板列表变化(create / save / rename / delete / move / duplicate / folder ops 全广播)*/
  onGraphListChanged(callback: (list: GraphCanvasListItem[]) => void): () => void;
}
