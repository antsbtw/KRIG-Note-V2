/**
 * EBookView per-workspace 工作位状态(L5-C1)
 *
 * 全局数据(书架 / 文件夹 / 标注)走 ebook-library capability(IPC + main store)。
 * 本文件管理**当前 Workspace 的工作位状态**(看哪本书 / 折哪些书架文件夹 / 选择 / 阅读位置等)。
 *
 * 决策 D-2=A:全部业务字段走 pluginStates['ebook-view'](charter 强制 + V2 既有
 * note-view / web-view 同模式)。WorkspaceState 框架字段不增加 ebook 专属字段。
 *
 * **持久化字段**:activeBookId(left)/ rightActiveBookId / expandedFolders /
 *                 readingState(left)/ rightReadingState
 * **Transient 字段**:selectedIds(对齐 note-view Q8=B,关闭重启不残留)
 *
 * ## per-slot 化(feat/ebook-per-slot)
 *
 * 左右可各看一本书,故「当前书」与「阅读位置」都必须带槽维度 —— 与 note 的
 * activeNoteId / rightActiveNoteId 同构(4fda395b)。
 *
 * readingState 按槽拆**比 note 更要紧**:note 的 activeNoteId 只在切笔记时写,
 * 而 PDF 每翻一页都写 readingState,写频率差一个数量级。不拆的话左栏翻页会持续
 * 覆盖右栏的位置,重启后两栏一起跳到最后一次翻页的地方。
 */

import { workspaceManager } from '@workspace/workspace-state/workspace-manager';
import type { WorkspaceState } from '@workspace/workspace-state/workspace-state';
import type { ReadingPosition } from '@capabilities/ebook-library/types';

const STORE_KEY = 'ebook-view';

/** 阅读状态(per-ws,跟书 entry.lastPosition 互补 — entry 是"全局最后一次",ws 是"本 ws 上次")*/
export interface EBookReadingState {
  position: ReadingPosition;
  /** 缩放(冗余存,fitWidth=true 时用 entry.lastPosition.scale 兜底)*/
  scale?: number;
  /** 适应宽度 */
  fitWidth?: boolean;
}

/**
 * EBook 槽标识(feat/ebook-per-slot)
 *
 * 与 note 的 NoteSlot 同义但**各自定义**:两个 view 的 per-slot 状态互不相干,
 * 共用一个类型只会制造无谓的跨 view 依赖。等抽通用 ActiveResourceManager 时
 * 再统一(本次不抽,见 docs/RefactorV2/stages/ebook-per-slot-design.md §4.3)。
 */
export type EBookSlot = 'left' | 'right';

/** per-workspace 工作位状态(persistent + transient 合并视图)*/
export interface EBookWorkspaceState {
  /** left 槽当前书(旧字段,语义不变)*/
  activeBookId: string | null;
  /** right 槽当前书 */
  rightActiveBookId: string | null;
  /** 书架文件夹展开状态(**槽间共享** — 导航是"选内容",属工作区级)*/
  expandedFolders: Set<string>;
  /**
   * left 槽阅读状态。
   *
   * ⚠️ 现状:**只写不读** —— 恢复阅读位置实际走 `entry.lastPosition`(书的全局
   * 最后位置,存主进程)。本字段的原设计意图是"本 ws 上次读到哪"(与全局位置
   * 互补),但至今没有消费点。
   * 仍按槽拆:它每翻页都写,不拆的话左栏会持续覆盖右栏 —— 等将来真要"每栏各自
   * 记位置"时,数据是干净的;否则那天再拆得先清一遍脏数据。
   */
  readingState: EBookReadingState | null;
  /** right 槽阅读状态(同上,只写不读)*/
  rightReadingState: EBookReadingState | null;
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
  readingState: EBookReadingState | null;
  /** right 槽阅读位置(同上,老数据缺 → null)*/
  rightReadingState?: EBookReadingState | null;
}

const DEFAULT_WS_STATE: EBookWorkspaceState = {
  activeBookId: null,
  rightActiveBookId: null,
  expandedFolders: new Set<string>(),
  readingState: null,
  rightReadingState: null,
  selectedIds: new Set<string>(),
};
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
    readingState: raw?.readingState ?? null,
    rightReadingState: raw?.rightReadingState ?? null,
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
    readingState: null,
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
  return slot === 'right' ? state.rightActiveBookId : state.activeBookId;
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
  writePersistent(
    workspaceId,
    slot === 'right' ? { rightActiveBookId: bookId } : { activeBookId: bookId },
  );
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

/**
 * 写**某个槽**的阅读位置。
 *
 * 这是本次 per-slot 化里写得最频繁的一条(PDF 每翻页都经 debounce 落这里),
 * 不按槽拆的话左栏翻页会持续覆盖右栏位置 —— 重启后两栏一起跳到最后一次翻页处。
 */
export function setReadingState(
  workspaceId: string,
  state: EBookReadingState | null,
  slot: EBookSlot = 'left',
): void {
  writePersistent(
    workspaceId,
    slot === 'right' ? { rightReadingState: state } : { readingState: state },
  );
}

// ── transient selectedIds ──

export function setSelectedIds(workspaceId: string, ids: Set<string>): void {
  writeTransientSelected(workspaceId, ids);
}

export function getSelectedIds(workspaceId: string): Set<string> {
  return transientSelected.get(workspaceId) ?? new Set();
}
