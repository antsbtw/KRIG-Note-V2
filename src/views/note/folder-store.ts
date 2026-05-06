/**
 * folder-store — 全局文件夹池
 *
 * 跟 noteStore 平级(都是用户资产,跨 Workspace 共享)。
 * persistence:localStorage 'krig.folders'。
 */

export interface Folder {
  id: string;
  title: string;
  parentId: string | null;
  createdAt: number;
  updatedAt: number;
}

interface FolderStoreData {
  folders: Record<string, Folder>;
  counter: number;
}

const STORAGE_KEY = 'krig.folders';

const DEFAULT_STATE: FolderStoreData = Object.freeze({
  folders: Object.freeze({}) as Record<string, Folder>,
  counter: 0,
}) as FolderStoreData;

class FolderStore {
  private state: FolderStoreData = DEFAULT_STATE;
  private listeners = new Set<() => void>();
  private cachedAll: Folder[] | null = null;

  constructor() {
    this.load();
  }

  // ── 持久化 ──

  private load(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && parsed.folders && typeof parsed.counter === 'number') {
        this.state = parsed as FolderStoreData;
      }
    } catch (err) {
      console.warn('[folder-store] load failed:', err);
    }
  }

  private save(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
    } catch (err) {
      console.warn('[folder-store] save failed:', err);
    }
  }

  private notify(): void {
    this.cachedAll = null;
    this.save();
    this.listeners.forEach((l) => l());
  }

  // ── 订阅 ──

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  // ── 读 API ──

  getAll(): Folder[] {
    if (this.cachedAll === null) {
      this.cachedAll = Object.values(this.state.folders);
    }
    return this.cachedAll;
  }

  get(id: string): Folder | undefined {
    return this.state.folders[id];
  }

  has(id: string): boolean {
    return id in this.state.folders;
  }

  get count(): number {
    return Object.keys(this.state.folders).length;
  }

  /** 递归收集 folder 的所有子孙 folder id(含自身)*/
  getDescendants(folderId: string): string[] {
    const result: string[] = [folderId];
    const all = Object.values(this.state.folders);
    let queue = [folderId];
    while (queue.length > 0) {
      const next: string[] = [];
      for (const parentId of queue) {
        for (const f of all) {
          if (f.parentId === parentId) {
            result.push(f.id);
            next.push(f.id);
          }
        }
      }
      queue = next;
    }
    return result;
  }

  /** target 是否在 source 的子树里(含自身)— 拖拽防环用 */
  isDescendantOf(targetId: string, sourceId: string): boolean {
    return this.getDescendants(sourceId).includes(targetId);
  }

  // ── 写 API ──

  create(title: string, parentId: string | null = null): string {
    const newCounter = this.state.counter + 1;
    const id = `folder-${newCounter}`;
    const folder: Folder = {
      id,
      title,
      parentId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.state = {
      folders: { ...this.state.folders, [id]: folder },
      counter: newCounter,
    };
    this.notify();
    return id;
  }

  update(id: string, patch: Partial<Folder>): void {
    const existing = this.state.folders[id];
    if (!existing) return;
    this.state = {
      ...this.state,
      folders: {
        ...this.state.folders,
        [id]: { ...existing, ...patch, id: existing.id, updatedAt: Date.now() },
      },
    };
    this.notify();
  }

  /** 改 parent(防环由 caller 负责;本 store 只做赋值)*/
  move(id: string, newParentId: string | null): void {
    this.update(id, { parentId: newParentId });
  }

  /** 删 folder + 递归子 folder。注意:笔记不在本 store 内,caller 需要单独把笔记 folderId → null */
  delete(id: string): string[] {
    if (!this.state.folders[id]) return [];
    const toDelete = this.getDescendants(id);
    const newFolders = { ...this.state.folders };
    for (const did of toDelete) delete newFolders[did];
    this.state = { ...this.state, folders: newFolders };
    this.notify();
    return toDelete;
  }
}

export const folderStore = new FolderStore();
