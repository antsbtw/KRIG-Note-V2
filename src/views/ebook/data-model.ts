/**
 * EBookView per-workspace 工作位状态(L5-C1)
 *
 * 全局数据(书架 / 文件夹 / 标注)走 ebook-library capability(IPC + main store)。
 * 本文件管理**当前 Workspace 的工作位状态**(看哪本书 / 折哪些书架文件夹 / 选择 / 阅读位置等)。
 *
 * 决策 D-2=A:全部业务字段走 pluginStates['ebook-view'](charter 强制 + V2 既有
 * note-view / web-view 同模式)。WorkspaceState 框架字段不增加 ebook 专属字段。
 *
 * **持久化字段**:activeBookId(left)/ rightActiveBookId / expandedFolders
 * **Transient 字段**:selectedIds(对齐 note-view Q8=B,关闭重启不残留)
 *
 * ## per-slot 化
 *
 * 左右可各看一本书,故「当前书」必须带槽维度 —— 与 note 的 activeNoteId /
 * rightActiveNoteId 同构(4fda395b / 3aabe642)。
 *
 * 槽分发本身**不在本文件实现**:统一走 `workspace-state/slot-resource` 的
 * declareSlotResource(见该文件头「为什么必须收拢」)。本文件只声明"字段叫什么"。
 */

import { workspaceManager } from '@workspace/workspace-state/workspace-manager';
import type { WorkspaceState } from '@workspace/workspace-state/workspace-state';
import { declareSlotResource, type SlotId } from '@workspace/workspace-state/slot-resource';

const STORE_KEY = 'ebook-view';

/**
 * EBook 槽标识 —— 现为 slot-resource 层 `SlotId` 的别名(保留名字避免全仓改签名)。
 *
 * 抽层前这里独立定义,理由记的是"两个 view 的 per-slot 状态互不相干,等抽通用
 * ActiveResourceManager 时再统一"。那一天就是现在:槽是**布局概念不是 view 概念**,
 * SlotArea 传给 note 和 eBook 的是同一个值。
 */
export type EBookSlot = SlotId;

/** per-workspace 工作位状态(persistent + transient 合并视图)*/
export interface EBookWorkspaceState {
  /** left 槽当前书(旧字段,语义不变)*/
  activeBookId: string | null;
  /** right 槽当前书 */
  rightActiveBookId: string | null;
  /** 书架文件夹展开状态(**槽间共享** — 导航是"选内容",属工作区级)*/
  expandedFolders: Set<string>;
  /** Transient — selectedIds 不持久化(对齐 note-view Q8=B)*/
  selectedIds: Set<string>;
}

/** 持久化形态(pluginStates['ebook-view'] 真实存的格式)— Set 序列化为 string[] */
interface PersistedEBookWsState {
  /**
   * left 槽的书。字段名保持 activeBookId 不变(不做 migration):
   * 历史数据天然落到 left 槽,语义正好对得上 —— 旧版单栏就是今天的 left。
   */
  activeBookId: string | null;
  /** right 槽的书(feat/ebook-per-slot 新增,老数据缺此字段 → null)*/
  rightActiveBookId?: string | null;
  expandedFolders: string[];
  // readingState / rightReadingState 已删(2026-08-08):**只写不读**的死字段 ——
  // 唯一写入点是 use-ebook-progress 的每次翻页,全仓无任何读取点。真正的阅读位置
  // 来源是主进程 reading-state atom(entry.lastPosition,capability-impl.ts,被读 8 处),
  // 与本字段同名但完全无关。删掉净省每翻页一次 pluginStates 写 + 持久化 IPC。
  // 老数据里残留的这两个 key 不清理:hydrate 不再读它们,留着无害(不做数据迁移)。
}

const DEFAULT_WS_STATE: EBookWorkspaceState = {
  activeBookId: null,
  rightActiveBookId: null,
  expandedFolders: new Set<string>(),
  selectedIds: new Set<string>(),
};

/**
 * per-slot「当前书」的**唯一**槽分发声明(见 workspace-state/slot-resource.ts)。
 *
 * 抽层前 `slot === 'right' ? … : …` 在本文件三处,且与 note 侧那份逐行同构 ——
 * 正是"两份平行实现"的实体。现在字段名只此一处知道。
 */
const activeBookResource = declareSlotResource<string | null>({
  name: 'ebook.activeBookId',
  storeKey: STORE_KEY,
  leftField: 'activeBookId',
  rightField: 'rightActiveBookId',
  fallback: null,
});
Object.freeze(DEFAULT_WS_STATE);
Object.freeze(DEFAULT_WS_STATE.expandedFolders);
Object.freeze(DEFAULT_WS_STATE.selectedIds);

// ── transient selectedIds(对齐 note-view 的实现)──

const transientSelected: Map<string, Set<string>> = new Map();
const transientListeners: Set<() => void> = new Set();
let transientVersion = 0;

const hydratedCache: WeakMap<WorkspaceState, EBookWorkspaceState> = new WeakMap();

function hydrate(ws: WorkspaceState): EBookWorkspaceState {
  const cached = hydratedCache.get(ws);
  if (cached) {
    const sel = transientSelected.get(ws.id) ?? DEFAULT_WS_STATE.selectedIds;
    if (cached.selectedIds === sel) return cached;
    const fresh = { ...cached, selectedIds: sel };
    hydratedCache.set(ws, fresh);
    return fresh;
  }
  const raw = ws.pluginStates[STORE_KEY] as PersistedEBookWsState | undefined;
  const result: EBookWorkspaceState = {
    activeBookId: raw?.activeBookId ?? null,
    rightActiveBookId: raw?.rightActiveBookId ?? null,
    expandedFolders: new Set(raw?.expandedFolders ?? []),
    // selectedIds 兜底用 DEFAULT_WS_STATE.selectedIds(冻结引用),与 cached
    // 分支兜底一致 — useSyncExternalStore getSnapshot 多次调用返回稳定引用,
    // 避免 React 19 dev mode "getSnapshot should be cached" 警告(V2 既有 bug,
    // L5-G2 顺手修;memory feedback_use_sync_external_store_stable_ref)
    selectedIds: transientSelected.get(ws.id) ?? DEFAULT_WS_STATE.selectedIds,
  };
  hydratedCache.set(ws, result);
  return result;
}

export function getEBookWsState(ws: WorkspaceState): EBookWorkspaceState {
  return hydrate(ws);
}

function writePersistent(workspaceId: string, patch: Partial<PersistedEBookWsState>): void {
  const ws = workspaceManager.get(workspaceId);
  if (!ws) return;
  const current = (ws.pluginStates[STORE_KEY] as PersistedEBookWsState | undefined) ?? {
    activeBookId: null,
    expandedFolders: [],
  };
  const merged: PersistedEBookWsState = { ...current, ...patch };
  workspaceManager.update(workspaceId, {
    pluginStates: { ...ws.pluginStates, [STORE_KEY]: merged },
  });
}

function writeTransientSelected(workspaceId: string, ids: Set<string>): void {
  transientSelected.set(workspaceId, ids);
  transientVersion++;
  const ws = workspaceManager.get(workspaceId);
  if (ws) hydratedCache.delete(ws);
  transientListeners.forEach((l) => l());
}

export function subscribeTransient(listener: () => void): () => void {
  transientListeners.add(listener);
  return () => {
    transientListeners.delete(listener);
  };
}

export function getTransientVersion(): number {
  return transientVersion;
}

// ── 业务 setters ──

/**
 * 读**指定槽**的当前书 —— per-slot 字段的唯一读取入口。
 *
 * 各处不要自己写 `slot === 'right' ? s.rightActiveBookId : s.activeBookId`,
 * 字段名散落出去后加第三个槽 / 改名就要全仓翻(note 侧的教训)。
 */
export function getActiveBookId(state: EBookWorkspaceState, slot: EBookSlot): string | null {
  // 从 hydrate 后的视图对象读(而非 pluginStates 原始对象)—— 调用方手上普遍
  // 只有 getEBookWsState() 的结果。字段名仍由 slot-resource 单一持有。
  return activeBookResource.read(state as unknown as Record<string, unknown>, slot);
}

/**
 * 切**某个槽**的当前书。
 *
 * feat/ebook-per-slot:显式带 slot(默认 'left' 保持既有调用点语义 ——
 * 旧版单栏即今天的 left)。左右双开时两栏各写各的字段,互不覆盖。
 */
export function setActiveBookId(
  workspaceId: string,
  bookId: string | null,
  slot: EBookSlot = 'left',
): void {
  const ws = workspaceManager.get(workspaceId);
  if (!ws) return;
  if (getActiveBookId(hydrate(ws), slot) === bookId) return;
  writePersistent(workspaceId, activeBookResource.patch(slot, bookId));
}

export function setFolderExpanded(
  workspaceId: string,
  folderId: string,
  expanded: boolean,
): void {
  const ws = workspaceManager.get(workspaceId);
  if (!ws) return;
  const cur = hydrate(ws).expandedFolders;
  const next = new Set(cur);
  if (expanded) next.add(folderId);
  else next.delete(folderId);
  writePersistent(workspaceId, { expandedFolders: Array.from(next) });
}

export function setExpandedFolders(workspaceId: string, ids: Set<string>): void {
  writePersistent(workspaceId, { expandedFolders: Array.from(ids) });
}

// setReadingState 已删(2026-08-08):写进 pluginStates 的那份 readingState 是**只写不读**
// 的死字段 —— 每次翻页都写一遍(还带持久化 IPC),全仓却无任何读取点。
// 阅读位置恢复实际走主进程 reading-state atom(entry.lastPosition),与之同名但无关,
// 未受本次改动影响。将来真要做"每栏各记各的位置"时,来 slot-resource declare 一次即可。

// ── transient selectedIds ──

export function setSelectedIds(workspaceId: string, ids: Set<string>): void {
  writeTransientSelected(workspaceId, ids);
}

export function getSelectedIds(workspaceId: string): Set<string> {
  return transientSelected.get(workspaceId) ?? new Set();
}
