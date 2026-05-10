/**
 * Graph 画板 store(L5-G1)
 *
 * V1 → V2 改写:src/main/storage/graph-store.ts(SurrealDB,287 行)→ V2 JSON 实现。
 * 用户拍板 D-3=B JSON 起步(对齐 v1-graph-migration-plan.md v0.2 + ebook bookshelf-store)。
 *
 * 文件结构(决策 G1-4 / G1-5):
 *   {userData}/krig-data/graph/
 *   ├── canvases.json              metadata + folders 合一
 *   │                              { version: '1', entries: GraphCanvasListItem[], folders: GraphFolderRecord[] }
 *   └── documents/
 *       └── {id}.json              GraphCanvasRecord.doc_content(每画板一文件)
 *
 * 写入策略:atomic — `*.json.tmp` → `fs.renameSync`(POSIX 保证原子);
 * save 时先写 documents/{id}.json → 再更新 canvases.json(metadata 是真理之源,
 * 中途挂掉留孤儿 documents/ 文件可后期 GC,G1 不做)。
 *
 * 退出条件(D-4 v0.3):跟 ebook 一起,W6 SurrealDB 客户端 epic 时整体迁
 * src/storage/graph/ + 升 SurrealDB 实现。V1
 * src/main/storage/graph-store.ts(SurrealDB)保留作 W6 起点参考。
 */

import { app } from 'electron';
import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  unlinkSync,
  renameSync,
} from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

// ── 数据模型(V1 src/shared/types/graph-types.ts 直迁,保持类型不变)──

/** v1 仅 'canvas';M2 加 'family-tree';里程碑 H 单独阶段加 'knowledge' / 'mindmap' */
export type GraphVariant = 'canvas' | 'family-tree' | 'knowledge' | 'mindmap';

/** 画板内容是结构化 JSON(serialize.ts 输出形态);store 层用 unknown 通用 */
export type CanvasDocumentJson = unknown;

export interface GraphCanvasRecord {
  id: string;
  title: string;
  doc_content: CanvasDocumentJson;
  variant: GraphVariant;
  folder_id: string | null;
  created_at: number;
  updated_at: number;
}

/** list 时返回的轻量项(不含 doc_content,决策 G1-6)*/
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

interface CanvasesFile {
  version: '1';
  entries: GraphCanvasListItem[];
  folders: GraphFolderRecord[];
}

// ── 路径常量 ──

const GRAPH_DIR = path.join(app.getPath('userData'), 'krig-data', 'graph');
const DOCUMENTS_DIR = path.join(GRAPH_DIR, 'documents');
const CANVASES_PATH = path.join(GRAPH_DIR, 'canvases.json');

// ── 工具 ──

function isVariant(v: unknown): v is GraphVariant {
  return v === 'canvas' || v === 'family-tree' || v === 'knowledge' || v === 'mindmap';
}

function emptyDocument(): CanvasDocumentJson {
  // 与 V1 graph-store create 时存的初值对齐(canvas variant 默认空画布)
  return {
    schema_version: 2,
    view: { centerX: 0, centerY: 0, zoom: 1 },
    instances: [],
  };
}

// ── Store ──

class CanvasStore {
  private data: CanvasesFile = { version: '1', entries: [], folders: [] };
  private loaded = false;

  private ensureDir(): void {
    if (!existsSync(GRAPH_DIR)) mkdirSync(GRAPH_DIR, { recursive: true });
    if (!existsSync(DOCUMENTS_DIR)) mkdirSync(DOCUMENTS_DIR, { recursive: true });
  }

  private load(): void {
    if (this.loaded) return;
    this.loaded = true;

    try {
      this.ensureDir();
      if (!existsSync(CANVASES_PATH)) return;

      const raw = JSON.parse(readFileSync(CANVASES_PATH, 'utf-8'));
      if (raw && typeof raw === 'object' && raw.version === '1') {
        this.data = {
          version: '1',
          entries: Array.isArray(raw.entries)
            ? (raw.entries as GraphCanvasListItem[]).filter((e) =>
                e && typeof e.id === 'string' && typeof e.title === 'string',
              ).map((e) => ({
                ...e,
                variant: isVariant(e.variant) ? e.variant : 'canvas',
                folder_id: e.folder_id ?? null,
              }))
            : [],
          folders: Array.isArray(raw.folders)
            ? (raw.folders as GraphFolderRecord[]).filter((f) =>
                f && typeof f.id === 'string' && typeof f.title === 'string',
              )
            : [],
        };
      }
    } catch (err) {
      console.warn('[graph/canvas-store] load failed (file 损坏或权限问题):', err);
      // 起空 store,后续 write 会重建
    }
  }

  /** atomic 写 metadata 文件 */
  private save(): void {
    try {
      this.ensureDir();
      const tmp = CANVASES_PATH + '.tmp';
      writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf-8');
      renameSync(tmp, CANVASES_PATH);
    } catch (err) {
      console.warn('[graph/canvas-store] save metadata failed:', err);
    }
  }

  /** atomic 写单画板 doc_content 文件 */
  private saveDocument(id: string, doc: CanvasDocumentJson): void {
    try {
      this.ensureDir();
      const docPath = path.join(DOCUMENTS_DIR, `${id}.json`);
      const tmp = docPath + '.tmp';
      writeFileSync(tmp, JSON.stringify(doc, null, 2), 'utf-8');
      renameSync(tmp, docPath);
    } catch (err) {
      console.warn(`[graph/canvas-store] save document ${id} failed:`, err);
    }
  }

  private loadDocument(id: string): CanvasDocumentJson | null {
    try {
      const docPath = path.join(DOCUMENTS_DIR, `${id}.json`);
      if (!existsSync(docPath)) return null;
      return JSON.parse(readFileSync(docPath, 'utf-8'));
    } catch (err) {
      console.warn(`[graph/canvas-store] load document ${id} failed:`, err);
      return null;
    }
  }

  private deleteDocument(id: string): void {
    try {
      const docPath = path.join(DOCUMENTS_DIR, `${id}.json`);
      if (existsSync(docPath)) unlinkSync(docPath);
    } catch (err) {
      console.warn(`[graph/canvas-store] delete document ${id} failed:`, err);
    }
  }

  // ── 画板 ──

  list(): GraphCanvasListItem[] {
    this.load();
    return [...this.data.entries].sort((a, b) => b.updated_at - a.updated_at);
  }

  get(id: string): GraphCanvasRecord | null {
    this.load();
    const entry = this.data.entries.find((e) => e.id === id);
    if (!entry) return null;
    const doc = this.loadDocument(id) ?? emptyDocument();
    return {
      id: entry.id,
      title: entry.title,
      variant: entry.variant,
      folder_id: entry.folder_id,
      doc_content: doc,
      created_at: entry.updated_at, // metadata 不存 created_at,用 updated_at 兜底(V1 类型保持兼容)
      updated_at: entry.updated_at,
    };
  }

  create(
    title: string,
    variant: GraphVariant,
    folderId: string | null,
  ): GraphCanvasRecord {
    this.load();
    const id = randomUUID();
    const now = Date.now();
    const doc = emptyDocument();
    const entry: GraphCanvasListItem = {
      id,
      title: title || 'Untitled Canvas',
      variant,
      folder_id: folderId,
      updated_at: now,
    };
    this.data.entries.push(entry);
    this.saveDocument(id, doc);
    this.save();
    return {
      ...entry,
      doc_content: doc,
      created_at: now,
    };
  }

  /** 保存画板内容(doc_content)+ 同步 title;`save` 已被 private 用,这里用 `update`)*/
  update(id: string, docContent: CanvasDocumentJson, title: string): void {
    this.load();
    const entry = this.data.entries.find((e) => e.id === id);
    if (!entry) return;
    const now = Date.now();
    entry.title = title || entry.title;
    entry.updated_at = now;
    this.saveDocument(id, docContent);
    this.save();
  }

  delete(id: string): void {
    this.load();
    const idx = this.data.entries.findIndex((e) => e.id === id);
    if (idx < 0) return;
    this.data.entries.splice(idx, 1);
    this.deleteDocument(id);
    this.save();
  }

  rename(id: string, title: string): void {
    this.load();
    const entry = this.data.entries.find((e) => e.id === id);
    if (!entry) return;
    entry.title = title;
    entry.updated_at = Date.now();
    this.save();
  }

  moveToFolder(id: string, folderId: string | null): void {
    this.load();
    const entry = this.data.entries.find((e) => e.id === id);
    if (!entry) return;
    entry.folder_id = folderId;
    entry.updated_at = Date.now();
    this.save();
  }

  duplicate(id: string, targetFolderId?: string | null): GraphCanvasRecord | null {
    this.load();
    const original = this.get(id);
    if (!original) return null;
    const newId = randomUUID();
    const now = Date.now();
    const folder_id = targetFolderId !== undefined ? targetFolderId : original.folder_id;
    const entry: GraphCanvasListItem = {
      id: newId,
      title: `${original.title} (副本)`,
      variant: original.variant,
      folder_id,
      updated_at: now,
    };
    const doc = JSON.parse(JSON.stringify(original.doc_content));
    this.data.entries.push(entry);
    this.saveDocument(newId, doc);
    this.save();
    return {
      ...entry,
      doc_content: doc,
      created_at: now,
    };
  }

  // ── 文件夹 ──

  folderList(): GraphFolderRecord[] {
    this.load();
    return [...this.data.folders].sort((a, b) => a.sort_order - b.sort_order);
  }

  folderCreate(title: string, parentId: string | null): GraphFolderRecord {
    this.load();
    const siblings = this.data.folders.filter((f) => f.parent_id === parentId);
    const folder: GraphFolderRecord = {
      id: randomUUID(),
      title,
      parent_id: parentId,
      sort_order: siblings.length + 1,
      created_at: Date.now(),
    };
    this.data.folders.push(folder);
    this.save();
    return folder;
  }

  folderRename(id: string, title: string): void {
    this.load();
    const folder = this.data.folders.find((f) => f.id === id);
    if (!folder) return;
    folder.title = title;
    this.save();
  }

  /** 删文件夹 → 子画板的 folder_id 置 null;子文件夹递归删 */
  folderDelete(id: string): void {
    this.load();

    // 子文件夹递归(把 id 集合一次性收齐再批量改,避免 splice 期间 index 失效)
    const toDelete = new Set<string>();
    const collect = (fid: string): void => {
      toDelete.add(fid);
      for (const child of this.data.folders) {
        if (child.parent_id === fid) collect(child.id);
      }
    };
    collect(id);

    // 该集合下所有文件夹的子画板回根级
    for (const entry of this.data.entries) {
      if (entry.folder_id && toDelete.has(entry.folder_id)) {
        entry.folder_id = null;
      }
    }

    // 实际删文件夹
    this.data.folders = this.data.folders.filter((f) => !toDelete.has(f.id));
    this.save();
  }

  folderMove(id: string, parentId: string | null): void {
    this.load();
    const folder = this.data.folders.find((f) => f.id === id);
    if (!folder) return;
    folder.parent_id = parentId;
    this.save();
  }
}

// 单例(跟 ebook bookshelfStore 同形)
export const canvasStore = new CanvasStore();
