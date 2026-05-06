/**
 * note-store — 全局笔记池
 *
 * 跟 WorkspaceState.pluginStates 区分(用户拍板):
 * - 笔记数据(notes / counter)= 用户资产 → 全局共享 → **本 store**
 * - workspace 工作位状态(activeNoteId)= per-workspace → pluginStates['note']
 *
 * 隔离原则:
 * - NavSide 笔记列表:订阅本 store → 显**所有笔记**(跨 Workspace 共享)
 * - NoteView 编辑器:订阅本 store + workspaceManager → 当前 ws 的 activeNoteId 取笔记
 *
 * L5-A 用 localStorage('krig.notes' key)。L7+ 切 SurrealDB 时迁到 src/storage/。
 */

import type { DriverSerialized } from '@drivers/text-editing-driver';

export interface Note {
  id: string;
  title: string;
  doc: DriverSerialized;
  createdAt: number;
  updatedAt: number;
}

interface NoteStoreData {
  notes: Record<string, Note>;
  counter: number;
}

const STORAGE_KEY = 'krig.notes';

/** 默认状态(冻结常量,避免 useSyncExternalStore 死循环)*/
const DEFAULT_STATE: NoteStoreData = Object.freeze({
  notes: Object.freeze({}) as Record<string, Note>,
  counter: 0,
}) as NoteStoreData;

class NoteStore {
  private state: NoteStoreData = DEFAULT_STATE;
  private listeners = new Set<() => void>();
  /** 缓存数组(useSyncExternalStore 稳定引用)*/
  private cachedAllNotes: Note[] | null = null;

  constructor() {
    this.load();
    this.migrateLegacy();
  }

  // ── 持久化 ──

  private load(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && parsed.notes && typeof parsed.counter === 'number') {
        this.state = parsed as NoteStoreData;
      }
    } catch (err) {
      console.warn('[note-store] load failed:', err);
    }
  }

  /**
   * L5-A v0.2.2 → v0.2.3 一次性迁移:
   * 把笔记从 WorkspaceState.pluginStates['note'].notes 提到全局 store。
   *
   * 仅当新 store 为空时才迁移(避免重复迁移)。运行一次后旧 pluginStates 数据保留(无害)。
   */
  private migrateLegacy(): void {
    if (Object.keys(this.state.notes).length > 0) return; // 新 store 已有数据,跳过

    try {
      const wsRaw = localStorage.getItem('krig.workspaces');
      if (!wsRaw) return;
      const wsData = JSON.parse(wsRaw);
      if (!wsData?.workspaces) return;

      let migratedCount = 0;
      let maxCounter = 0;
      const collectedNotes: Record<string, Note> = {};

      for (const ws of wsData.workspaces) {
        const noteData = ws.pluginStates?.note as { notes?: Record<string, Note>; counter?: number } | undefined;
        if (!noteData?.notes) continue;
        for (const [id, note] of Object.entries(noteData.notes)) {
          if (!collectedNotes[id]) {
            collectedNotes[id] = note as Note;
            migratedCount++;
          }
        }
        if (typeof noteData.counter === 'number' && noteData.counter > maxCounter) {
          maxCounter = noteData.counter;
        }
      }

      if (migratedCount > 0) {
        this.state = { notes: collectedNotes, counter: maxCounter };
        this.save();
        console.log(`[note-store] migrated ${migratedCount} notes from legacy pluginStates`);
      }
    } catch (err) {
      console.warn('[note-store] legacy migration failed:', err);
    }
  }

  private save(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
    } catch (err) {
      console.warn('[note-store] save failed:', err);
    }
  }

  private notify(): void {
    this.cachedAllNotes = null;
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

  // ── 读 API(useSyncExternalStore 用,稳定引用)──

  getAll(): Note[] {
    if (this.cachedAllNotes === null) {
      this.cachedAllNotes = Object.values(this.state.notes);
    }
    return this.cachedAllNotes;
  }

  get(id: string): Note | undefined {
    return this.state.notes[id];
  }

  get count(): number {
    return Object.keys(this.state.notes).length;
  }

  // ── 写 API ──

  create(doc: DriverSerialized, title = '未命名'): string {
    const newCounter = this.state.counter + 1;
    const id = `note-${newCounter}`;
    const newNote: Note = {
      id,
      title,
      doc,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.state = {
      notes: { ...this.state.notes, [id]: newNote },
      counter: newCounter,
    };
    this.notify();
    return id;
  }

  update(id: string, patch: Partial<Note>): void {
    const existing = this.state.notes[id];
    if (!existing) return;
    this.state = {
      ...this.state,
      notes: {
        ...this.state.notes,
        [id]: { ...existing, ...patch, id: existing.id, updatedAt: Date.now() },
      },
    };
    this.notify();
  }

  delete(id: string): void {
    if (!this.state.notes[id]) return;
    const newNotes = { ...this.state.notes };
    delete newNotes[id];
    this.state = { ...this.state, notes: newNotes };
    this.notify();
  }

  has(id: string): boolean {
    return id in this.state.notes;
  }
}

export const noteStore = new NoteStore();
