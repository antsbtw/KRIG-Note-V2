/**
 * NoteView per-workspace 工作位状态管理
 *
 * 见 docs/90-archive/refactor-v2/stages/L5B1-folder-tree-design.md § 2.3。
 *
 * 用户数据(笔记/文件夹)走 noteCapability / folderCapability (L7-sub2:SurrealDB);
 * 本文件管理 **当前 Workspace 的工作位状态**(看哪条笔记 / 折哪些文件夹 / 选了什么 / 排序 / 剪贴板)。
 *
 * **持久化字段**(写 pluginStates):activeNoteId(left 槽)/ rightActiveNoteId(right 槽)
 *   / expandedFolders / folderSortMap / clipboard
 * **Transient 字段**(只内存,Q8=B):selectedIds — 关闭重启后清空,避免干扰新操作
 *
 * Set 字段持久化策略:Set ↔ string[] 编/解码在 hydrate/encode 内做,view 业务无感。
 *
 * L7-sub2 改造 (decision 012):
 * - 写 API (create/update/delete) 转 async;caller 需 await
 * - 读笔记/文件夹列表交给 view 层 hook (useAllNotes / useAllFolders)
 */

import { workspaceManager } from '@workspace/workspace-state/workspace-manager';
import type { WorkspaceState } from '@workspace/workspace-state/workspace-state';
import { declareSlotResource, type SlotId } from '@workspace/workspace-state/slot-resource';
import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import type { NoteCapabilityApi } from '@capabilities/note/types';
import type { FolderCapabilityApi, FolderDeleteResult } from '@capabilities/folder/types';
import type { DriverSerialized, TextEditingApi } from '@capabilities/text-editing/types';
import { getClientId } from '@shared/client-identity';

// ── Phase 1 多窗口 merge:renderer 端 block hash 工具 ─────────────────────────

/** renderer 端 SHA-1 实现（Web Crypto API，与主进程 crypto.createHash('sha1') 等价） */
async function computeBlockHashAsync(blockPayload: unknown): Promise<string> {
  const json = JSON.stringify(blockPayload);
  const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(json));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * 遍历当前 doc，计算所有 block 的 blockId → blockHash 映射。
 * 只处理顶层 content 数组中有 attrs.id 的直接子节点（和主进程 dissect 逻辑一致）。
 * 结构性容器（table/tableRow/列表容器等）内的 cell paragraph 也含 attrs.id，按需递归。
 */
async function computeCurrentBlockHashes(doc: DriverSerialized): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  const pmDoc = doc.payload as { type?: string; content?: unknown[] } | undefined;
  if (!pmDoc || !Array.isArray(pmDoc.content)) return result;

  async function visitBlock(block: unknown): Promise<void> {
    if (!block || typeof block !== 'object') return;
    const b = block as Record<string, unknown>;
    const attrs = b.attrs as Record<string, unknown> | undefined;
    const blockId = attrs?.id;
    if (typeof blockId === 'string' && blockId) {
      // 用整个 block JSON 作 hash（去掉 blockHash/lastEditedBy/lastEditedBySession/lastEditedAt
      // 等同步元字段，避免主进程写入这些字段后 hash 变化而产生假冲突）
      const payloadForHash = stripSyncMeta(b);
      result.set(blockId, await computeBlockHashAsync(payloadForHash));
    }
    // 递归处理 content（table/tableRow/列表容器等结构性容器内的子 block）
    const children = b.content as unknown[] | undefined;
    if (Array.isArray(children)) {
      for (const child of children) {
        await visitBlock(child);
      }
    }
  }

  for (const block of pmDoc.content) {
    await visitBlock(block);
  }
  return result;
}

/**
 * 去掉主进程写入的同步元字段再做 hash，使 renderer 端计算的 hash 与主进程一致。
 * 主进程在 applyDiff 里写完 attrs 后才计算 blockHash，计算时 payload 已含这些字段；
 * 而 renderer 发来的 payload 没有这些字段。
 *
 * 一致性保证：主进程 computeBlockHash(payload) 在 stampedPayload（含 syncMeta）上算；
 * renderer 端从 getNote/getVersionInfo 拿到的 blockHashes 也是主进程在 stampedPayload 上算的。
 * 所以 renderer 端要重算"当前 block 的 hash"，必须模拟主进程 stamp 后的 payload。
 *
 * 问题：renderer 端拿不到主进程算进去的 lastEditedAt（时间戳每次写都变），导致每次保存
 * 后重算的 hash 都和数据库里的不同，changedBlocks 始终全量。
 *
 * 解法：只比较"内容"相关字段，不含 lastEditedAt（时间戳）和 lastEditedBySession（窗口 ID）。
 * 主进程在算 blockHash 时也只对内容负责 — 同步元字段变化不构成真冲突。
 *
 * 实现：去掉 attrs 里的 blockHash/lastEditedBy/lastEditedBySession/lastEditedAt。
 */
function stripSyncMeta(block: Record<string, unknown>): unknown {
  const attrs = block.attrs as Record<string, unknown> | undefined;
  if (!attrs) return block;
  const {
    blockHash: _bh,
    lastEditedBy: _leb,
    lastEditedBySession: _lebs,
    lastEditedAt: _lea,
    ...rest
  } = attrs;
  return { ...block, attrs: rest };
}

// ── Phase 0 多窗口同步:NoteBaseSnapshot ──────────────────────────────────────

/**
 * 每个窗口打开笔记时在内存中保存的快照（不持久化，窗口关闭即释放）。
 * 规范：docs/00-architecture/multi-window-sync-spec.md §3.4
 */
export interface NoteBaseSnapshot {
  noteId: string;
  docVersion: number;
  docHash: string;
  blockHashes: Map<string, string>;
  openedAt: number;
  openedBySession: string;
}

/**
 * per-scope 快照 Map（内存，不持久化）
 *
 * fix/slot-per-slot-active-note:key 从 wsId 改为 scopeKey(`${wsId}::${slot}`)。
 * 左右双开各看一篇笔记时,两栏各自维护自己的 baseSnapshot —— 否则后开的那栏
 * 会覆盖前一栏的快照,而 updateNoteWithMerge Step 1 的
 * `baseSnapshot.noteId !== noteId` 守卫会持续不命中 → 每次写都走
 * "跳过 merge 直接写 + warn" 的 fail-safe 路径(日志刷屏 + 丢并发保护)。
 */
const noteBaseSnapshots: Map<string, NoteBaseSnapshot> = new Map();

/** 取该 scope 的 baseSnapshot（Phase 1 merge 引擎用） */
export function getNoteBaseSnapshot(scopeKey: string): NoteBaseSnapshot | undefined {
  return noteBaseSnapshots.get(scopeKey);
}

/** 写入/更新 baseSnapshot（updateNote 成功后由调用方更新） */
export function setNoteBaseSnapshot(scopeKey: string, snapshot: NoteBaseSnapshot): void {
  noteBaseSnapshots.set(scopeKey, snapshot);
}

/** 清除该 scope 的 baseSnapshot（ws 关闭 / 切换 note 时） */
export function clearNoteBaseSnapshot(scopeKey: string): void {
  noteBaseSnapshots.delete(scopeKey);
}

function noteCap(): NoteCapabilityApi {
  return requireCapabilityApi<NoteCapabilityApi>('note');
}
function folderCap(): FolderCapabilityApi {
  return requireCapabilityApi<FolderCapabilityApi>('folder');
}

export type SortState = 'title-asc' | 'title-desc' | 'date-asc' | 'date-desc' | null;

/**
 * Note 槽标识 —— 现为 slot-resource 层 `SlotId` 的别名(保留名字避免全仓改签名)。
 *
 * 抽层前这里是独立定义,与 eBook 的 `EBookSlot` 同义却各定义一份。槽是**布局概念
 * 不是 view 概念**(SlotArea 传给两者的是同一个值),故统一到 SlotId。
 */
export type NoteSlot = SlotId;

/** 构造 per-slot 作用域 key(baseSnapshot 等内存 Map 用)*/
export function noteScopeKey(wsId: string, slot: NoteSlot): string {
  return `${wsId}::${slot}`;
}

/**
 * 构造 NoteView 的 PM instanceId(单一来源)。
 *
 * NoteView 挂 Host 时用它,命令按槽定位实例时也用它 —— 格式只此一处定义,
 * 避免各处硬编码 `${wsId}::slot:${slot}` 字面量后漂移。
 */
export function noteInstanceId(wsId: string, slot: NoteSlot): string {
  return `${wsId}::slot:${slot}`;
}

/** per-workspace 工作位状态(persistent + transient 合并视图)*/
export interface NoteWorkspaceState {
  /** left 槽活跃笔记(旧字段,语义不变)*/
  activeNoteId: string | null;
  /** right 槽活跃笔记 */
  rightActiveNoteId: string | null;
  expandedFolders: Set<string>;
  folderSortMap: Record<string, SortState>;
  clipboard: { type: 'note' | 'folder'; id: string } | null;
  /** Transient — 不持久化(Q8=B)*/
  selectedIds: Set<string>;
}

const STORE_KEY = 'note';

/** 持久化的形态(pluginStates['note'] 真实存的格式)— Set 序列化为 string[] */
interface PersistedNoteWsState {
  /**
   * left 槽的活跃笔记。
   *
   * 字段名保持 activeNoteId 不变(不做 migration):历史数据天然落到 left 槽,
   * 语义正好对得上 —— 旧版单栏就是今天的 left。
   */
  activeNoteId: string | null;
  /**
   * right 槽的活跃笔记(fix/slot-per-slot-active-note 新增)。
   *
   * V1 曾有同名的 rightActiveNoteId,V2 初期砍掉并在 link-click-integration.ts
   * 里记为"等 ActiveResourceManager 到位再补"。左右双开落地后必须补回 ——
   * 否则两栏订阅同一字段,永远显示同一篇笔记。
   */
  rightActiveNoteId?: string | null;
  expandedFolders: string[];
  folderSortMap: Record<string, SortState>;
  clipboard: { type: 'note' | 'folder'; id: string } | null;
}

/**
 * per-slot「当前笔记」的**唯一**槽分发声明(见 workspace-state/slot-resource.ts)。
 *
 * 抽层前 `slot === 'right' ? s.rightActiveNoteId : s.activeNoteId` 散在 6 处
 * (NoteView / nav-side / toolbar / link-click / note-commands / 本文件两处),
 * 与 eBook 侧另一份逐行同构。现在字段名只此一处知道。
 */
const activeNoteResource = declareSlotResource<string | null>({
  name: 'note.activeNoteId',
  storeKey: STORE_KEY,
  leftField: 'activeNoteId',
  rightField: 'rightActiveNoteId',
  fallback: null,
});

/**
 * 读**指定槽**的活跃笔记 —— per-slot 字段的唯一读取入口。
 *
 * 各处不要自己写 `slot === 'right' ? s.rightActiveNoteId : s.activeNoteId`:
 * 字段名散出去后加第三个槽 / 改名就要全仓翻(eBook 侧已因此重踩三个坑)。
 */
export function getActiveNoteId(state: NoteWorkspaceState, slot: NoteSlot): string | null {
  // 从 hydrate 后的视图对象读(而非 pluginStates 原始对象)—— 调用方手上普遍
  // 只有 getNoteWsState() 的结果。字段名仍由 slot-resource 单一持有。
  return activeNoteResource.read(state as unknown as Record<string, unknown>, slot);
}

/** 冻结常量(避免 useSyncExternalStore 死循环)*/
const DEFAULT_WS_STATE: NoteWorkspaceState = {
  activeNoteId: null,
  rightActiveNoteId: null,
  expandedFolders: new Set<string>(),
  folderSortMap: {},
  clipboard: null,
  selectedIds: new Set<string>(),
};
Object.freeze(DEFAULT_WS_STATE);
Object.freeze(DEFAULT_WS_STATE.expandedFolders);
Object.freeze(DEFAULT_WS_STATE.folderSortMap);
Object.freeze(DEFAULT_WS_STATE.selectedIds);

/** Transient selectedIds(每 ws 独立)— 关闭重启后清空 */
const transientSelected: Map<string, Set<string>> = new Map();
const transientListeners: Set<() => void> = new Set();
let transientVersion = 0;

/** 缓存 hydrated state(避免 useSyncExternalStore 每次 ws 变化都新建对象 → 死循环)*/
const hydratedCache: WeakMap<WorkspaceState, NoteWorkspaceState> = new WeakMap();

function hydrate(ws: WorkspaceState): NoteWorkspaceState {
  const cached = hydratedCache.get(ws);
  if (cached) {
    // 但 selectedIds 是 transient,可能在缓存外变化 — 重新拉
    const sel = transientSelected.get(ws.id) ?? DEFAULT_WS_STATE.selectedIds;
    if (cached.selectedIds === sel) return cached;
    const fresh = { ...cached, selectedIds: sel };
    hydratedCache.set(ws, fresh);
    return fresh;
  }
  const raw = ws.pluginStates[STORE_KEY] as PersistedNoteWsState | undefined;
  const result: NoteWorkspaceState = {
    activeNoteId: raw?.activeNoteId ?? null,
    rightActiveNoteId: raw?.rightActiveNoteId ?? null,
    expandedFolders: new Set(raw?.expandedFolders ?? []),
    folderSortMap: raw?.folderSortMap ?? {},
    clipboard: raw?.clipboard ?? null,
    // selectedIds 兜底用 DEFAULT_WS_STATE.selectedIds(冻结引用),与 cached
    // 分支兜底一致 — useSyncExternalStore getSnapshot 多次调用返回稳定引用,
    // 避免 React 19 dev mode "getSnapshot should be cached" 警告(V2 既有 bug,
    // L5-G2 顺手修;memory feedback_use_sync_external_store_stable_ref)
    selectedIds: transientSelected.get(ws.id) ?? DEFAULT_WS_STATE.selectedIds,
  };
  hydratedCache.set(ws, result);
  return result;
}

export function getNoteWsState(ws: WorkspaceState): NoteWorkspaceState {
  return hydrate(ws);
}

/** 写持久化字段(activeNoteId / expandedFolders / folderSortMap / clipboard)*/
function writePersistent(workspaceId: string, patch: Partial<PersistedNoteWsState>): void {
  const ws = workspaceManager.get(workspaceId);
  if (!ws) return;
  const current = (ws.pluginStates[STORE_KEY] as PersistedNoteWsState | undefined) ?? {
    activeNoteId: null,
    expandedFolders: [],
    folderSortMap: {},
    clipboard: null,
  };
  const merged: PersistedNoteWsState = { ...current, ...patch };
  workspaceManager.update(workspaceId, {
    pluginStates: { ...ws.pluginStates, [STORE_KEY]: merged },
  });
}

/** 写 transient selectedIds + 触发本地监听器(useSyncExternalStore 用)*/
function writeTransientSelected(workspaceId: string, ids: Set<string>): void {
  transientSelected.set(workspaceId, ids);
  transientVersion++;
  // 同时让 hydratedCache 失效(下次 hydrate 拿新 selectedIds)
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

// ── Phase 1 多窗口 merge:跨窗口基线同步订阅 ────────────────────────────────────

/**
 * 订阅主进程广播的 NOTE_BASE_SNAPSHOT_UPDATED。
 * 其他窗口写成功后，本窗口收到广播，更新本地 baseSnapshot 基线
 * （只更新版本和 blockHashes，不覆盖本地未提交编辑内容）。
 *
 * 调用一次即可（renderer/index.tsx 初始化阶段调）。
 */
export function initNoteBaseSnapshotSync(): void {
  if (!window.electronAPI?.onNoteBaseSnapshotUpdated) return;
  window.electronAPI.onNoteBaseSnapshotUpdated((payload) => {
    const { noteId, docVersion, docHash, blockHashes, fromSession } = payload;
    // 遍历所有 scope 的 baseSnapshot，找 noteId 匹配且 fromSession 不同于自己的
    // (scope = `${wsId}::${slot}`;左右双开时两栏各有一条,若都开着同一篇则各自更新)
    for (const [scopeKey, snapshot] of noteBaseSnapshots) {
      if (snapshot.noteId !== noteId) continue;
      if (snapshot.openedBySession === fromSession) continue; // 自己发的，跳过
      // 更新基线（不覆盖本地编辑；本地编辑内容由 PM editor 持有，不在 baseSnapshot 里）
      setNoteBaseSnapshot(scopeKey, {
        ...snapshot,
        docVersion,
        // 存主进程权威 docHash（SHA-1），本窗口下次写时 Step 4 快路径才能正确命中；
        // 之前留空 '' → 快路径永远失败 → 每次写误判并发写（刷屏 bug 的另一半）。
        docHash,
        blockHashes: new Map(Object.entries(blockHashes)),
      });
      console.info(
        `[sync/base] scope=${scopeKey} noteId=${noteId} 基线更新至 v${docVersion}（由 ${fromSession} 触发）`,
      );
    }
  });
}

// ── 业务 API ──

export function deriveTitle(doc: DriverSerialized): string {
  const text = requireCapabilityApi<TextEditingApi>('text-editing').extractFirstParagraphText(doc);
  return text || '未命名';
}

/**
 * 创建笔记(noteCapability)+ 当前 ws activeNoteId
 * L7-sub2:async (IPC roundtrip);caller 需 await
 */
export async function createNote(
  workspaceId: string,
  folderId: string | null = null,
  /** 新笔记在哪个槽打开(fix/slot-toolbar-command-targets-own-slot;默认 left = 旧行为)*/
  slot: NoteSlot = 'left',
): Promise<string | null> {
  const ws = workspaceManager.get(workspaceId);
  if (!ws) return null;
  const textEditing = requireCapabilityApi<TextEditingApi>('text-editing');
  const note = await noteCap().createNote(textEditing.createEmptyDoc(), folderId);
  // 走 setActiveNote 而非直接 writePersistent —— 后者只会写 left 字段,
  // 且会跳过 baseSnapshot 初始化(新笔记第一次保存就走 fail-safe 无 merge 路径)
  setActiveNote(workspaceId, note.id, slot);
  // 创建到 folder 时自动展开它
  if (folderId) {
    const cur = hydrate(ws).expandedFolders;
    if (!cur.has(folderId)) {
      const next = new Set(cur);
      next.add(folderId);
      writePersistent(workspaceId, { expandedFolders: Array.from(next) });
    }
  }
  return note.id;
}

/**
 * 更新笔记 doc (+ 可选 folderId 移动)
 * L7-sub2:async;title 字段已不存(派生),patch.title 忽略。
 * patch.folderId 与 patch.doc 同时存在时:先 update doc,再 move 到新 folder。
 *
 * Phase 1:保存前插入 merge 逻辑，检测并发冲突，自动 merge 无冲突部分。
 * wsId 可选，传入时用于定向更新该 ws 的快照。
 */
export async function updateNote(
  noteId: string,
  patch: { doc?: DriverSerialized; title?: string; folderId?: string | null },
  /**
   * merge 作用域 key(`${wsId}::${slot}`,由 noteScopeKey 构造)。
   *
   * fix/slot-per-slot-active-note:原先传裸 wsId。左右双开各编辑一篇时,
   * 两栏共用一条 baseSnapshot 会互相覆盖 → Step 1 的 noteId 守卫持续不命中 →
   * 每次写都走 fail-safe「跳过 merge 直接写 + warn」,既刷屏又丢并发保护。
   */
  scopeKey?: string,
): Promise<void> {
  if (patch.doc !== undefined) {
    const clientId = getClientId();
    await updateNoteWithMerge(noteId, patch.doc, clientId, scopeKey);
  }
  if (patch.folderId !== undefined) {
    await noteCap().moveNote(noteId, patch.folderId);
  }
  // patch.title 在 L7-sub2 已不可写 (派生自 doc.content[0]),忽略
}

/**
 * Phase 1 merge 引擎核心：在写库前检测并发冲突，自动 merge，带乐观锁写入。
 * 最多重试 3 次（乐观锁冲突时重算 changedBlocks 再试）。
 */
async function updateNoteWithMerge(
  noteId: string,
  doc: DriverSerialized,
  clientId: string,
  scopeKey?: string,
  retryCount = 0,
): Promise<void> {
  const MAX_RETRIES = 3;

  // Step 1:取本窗口 baseSnapshot
  const baseSnapshot = scopeKey ? getNoteBaseSnapshot(scopeKey) : undefined;
  if (!baseSnapshot || baseSnapshot.noteId !== noteId) {
    // 无快照时 fail-safe：直接写，但留痕
    if (scopeKey) {
      console.warn(
        `[sync/merge] noteId=${noteId} scopeKey=${scopeKey} baseSnapshot 不存在或对应不同 note，跳过 merge 直接写`,
      );
    }
    const result = await noteCap().updateNote(noteId, doc, clientId, scopeKey);
    applySnapshotFromResult(noteId, scopeKey, result);
    return;
  }

  // Step 2:计算本窗口 changedBlockIds（当前 doc vs baseSnapshot）
  const currentHashes = await computeCurrentBlockHashes(doc);
  const changedBlockIds = new Set<string>();
  for (const [blockId, currentHash] of currentHashes) {
    const baseHash = baseSnapshot.blockHashes.get(blockId);
    if (baseHash !== currentHash) {
      changedBlockIds.add(blockId);
    }
  }
  // 新增的 block（baseSnapshot 里没有的）也是"本窗口改了"
  for (const blockId of currentHashes.keys()) {
    if (!baseSnapshot.blockHashes.has(blockId)) {
      changedBlockIds.add(blockId);
    }
  }

  if (changedBlockIds.size === 0 && baseSnapshot.blockHashes.size >= currentHashes.size) {
    // 本窗口未改任何内容（可能是纯删块场景另行处理，此处保守直写）
  }

  // Step 3:拉数据库当前版本
  const dbInfo = await window.electronAPI.noteGetVersionInfo(noteId);
  if (!dbInfo) {
    console.warn(`[sync/merge] noteId=${noteId} getNoteVersionInfo 返回 null，直接写`);
    const result = await noteCap().updateNote(noteId, doc, clientId, scopeKey);
    applySnapshotFromResult(noteId, scopeKey, result);
    return;
  }

  // Step 4:若 db.docHash == baseSnapshot.docHash → 无并发写，直接写
  if (dbInfo.docHash === baseSnapshot.docHash) {
    const result = await noteCap().updateNote(noteId, doc, clientId, scopeKey, baseSnapshot.docVersion);
    if (result === null) {
      // 乐观锁冲突（Step 4 期间又有写入）→ 重试
      await handleOptimisticLockConflict(noteId, doc, clientId, scopeKey, retryCount, MAX_RETRIES);
      return;
    }
    applySnapshotFromResult(noteId, scopeKey, result);
    return;
  }

  // Step 5:有并发写 — block 级 merge
  console.info(
    `[sync/merge] noteId=${noteId} 检测到并发写 base.docHash=${baseSnapshot.docHash.slice(0, 8)} db.docHash=${dbInfo.docHash.slice(0, 8)}`,
  );
  for (const blockId of changedBlockIds) {
    const dbHash = dbInfo.blockHashes[blockId];
    const baseHash = baseSnapshot.blockHashes.get(blockId);
    if (dbHash !== undefined && dbHash !== baseHash) {
      // 冲突：数据库和本窗口都改了该 block → Phase 1 last-write-wins（本窗口赢）+ warn
      console.warn(
        `[sync/conflict] noteId=${noteId} blockId=${blockId} dbHash=${dbHash?.slice(0, 8)} localHash=${baseHash?.slice(0, 8) ?? 'none'} → last-write-wins(local)`,
      );
    }
    // 若 dbHash == baseHash：只有本窗口改了 → 安全，写本窗口版本（无需特殊处理）
  }

  // Step 6:带乐观锁写入（expectedVersion = 数据库当前版本）
  const result = await noteCap().updateNote(noteId, doc, clientId, scopeKey, dbInfo.docVersion);
  if (result === null) {
    // 乐观锁冲突（Step 5-6 期间又有写入）→ 重试
    await handleOptimisticLockConflict(noteId, doc, clientId, scopeKey, retryCount, MAX_RETRIES);
    return;
  }
  applySnapshotFromResult(noteId, scopeKey, result);
}

/** 乐观锁冲突处理：重试或 fail loud */
async function handleOptimisticLockConflict(
  noteId: string,
  doc: DriverSerialized,
  clientId: string,
  scopeKey: string | undefined,
  retryCount: number,
  maxRetries: number,
): Promise<void> {
  if (retryCount >= maxRetries) {
    console.error(
      `[sync/merge] noteId=${noteId} 乐观锁冲突超过最大重试次数 ${maxRetries}，放弃写入 — fail loud`,
    );
    return;
  }
  console.info(
    `[sync/merge] noteId=${noteId} 乐观锁冲突，第 ${retryCount + 1} 次重试`,
  );
  // 刷新 baseSnapshot 到最新数据库状态，再重走 merge 流程
  if (scopeKey) {
    const freshInfo = await window.electronAPI.noteGetVersionInfo(noteId);
    if (freshInfo) {
      const prev = getNoteBaseSnapshot(scopeKey);
      setNoteBaseSnapshot(scopeKey, {
        noteId,
        docVersion: freshInfo.docVersion,
        docHash: freshInfo.docHash,
        blockHashes: new Map(Object.entries(freshInfo.blockHashes)),
        openedAt: prev?.openedAt ?? Date.now(),
        openedBySession: scopeKey,
      });
    }
  }
  await updateNoteWithMerge(noteId, doc, clientId, scopeKey, retryCount + 1);
}

/** 写库成功后更新 baseSnapshot */
function applySnapshotFromResult(
  noteId: string,
  scopeKey: string | undefined,
  result: import('@capabilities/note/types').NoteInfo | null,
): void {
  if (result && scopeKey) {
    const blockHashesMap = new Map(Object.entries(result.blockHashes));
    setNoteBaseSnapshot(scopeKey, {
      noteId,
      docVersion: result.docVersion,
      // 直接存主进程返回的**权威** docHash(SHA-1,与 getNoteVersionInfo 同算法)。
      // 绝不本地用 computeDocHashFromMap 重算 —— 那是裸拼接串,与 db 的 SHA-1 永不相等,
      // 会让 updateNoteWithMerge Step 4 快路径永远失败 → 每次写都误判并发写(日志刷屏 bug)。
      docHash: result.docHash,
      blockHashes: blockHashesMap,
      openedAt: getNoteBaseSnapshot(scopeKey)?.openedAt ?? Date.now(),
      openedBySession: scopeKey,
    });
  }
}

export async function deleteNote(
  noteId: string,
  opts?: { progressTaskId?: string },
): Promise<void> {
  await noteCap().deleteNote(noteId, opts);
}

/**
 * 重命名 note(L7-sub2:title 派生自 doc.content[0],改名 = 反写首段 text)
 *
 * 写入策略(Q1/Q2 决议):
 * - 首段 block 自身 type/attrs 保留(原 paragraph/heading/isTitle 不变)
 * - 首段 content 全部 inline 合并为单一 text 节点 = newTitle
 * - 保留首个原 text 节点的 marks(若有)
 *
 * NoteView Host 收到 doc 广播会 swap PM doc(setMeta addToHistory:false)。
 */
export async function renameNote(noteId: string, newTitle: string): Promise<void> {
  const note = await noteCap().getNote(noteId);
  if (!note) return;
  const docCopy = JSON.parse(JSON.stringify(note.doc)) as { payload?: unknown };
  const root = docCopy.payload as { content?: Array<Record<string, unknown>> } | undefined;
  const firstBlock = root?.content?.[0];
  if (!firstBlock) return;
  // 保留首个 text 的 marks(Q1:保留 mark)
  const existingMarks = pluckFirstTextMarks(firstBlock);
  const newInline: Record<string, unknown> = { type: 'text', text: newTitle };
  if (existingMarks && existingMarks.length > 0) newInline.marks = existingMarks;
  // Q2:合并所有 inline 为单一 text 节点
  (firstBlock as { content?: unknown[] }).content = [newInline];
  await noteCap().updateNote(noteId, docCopy as DriverSerialized);
}

function pluckFirstTextMarks(node: Record<string, unknown>): unknown[] | null {
  if (node.type === 'text') return (node.marks as unknown[] | undefined) ?? null;
  const children = node.content as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(children)) return null;
  for (const c of children) {
    const r = pluckFirstTextMarks(c);
    if (r !== null) return r;
  }
  return null;
}

/**
 * 切某个槽的活跃笔记。
 *
 * fix/slot-per-slot-active-note:显式带 slot(默认 'left' 保持既有调用点语义 ——
 * 旧版单栏即今天的 left)。左右双开时两栏各写各的字段,互不覆盖。
 */
export function setActiveNote(
  workspaceId: string,
  noteId: string | null,
  slot: NoteSlot = 'left',
): void {
  const ws = workspaceManager.get(workspaceId);
  if (!ws) return;
  const current = getActiveNoteId(hydrate(ws), slot);
  if (current === noteId) return;
  writePersistent(workspaceId, activeNoteResource.patch(slot, noteId));
  // Phase 0:切换笔记时清旧快照，然后异步加载新快照(按槽隔离)
  const scope = noteScopeKey(workspaceId, slot);
  clearNoteBaseSnapshot(scope);
  if (noteId) {
    void initNoteBaseSnapshot(workspaceId, noteId, slot);
  }
}

/**
 * 异步初始化 NoteBaseSnapshot。
 * setActiveNote 以 fire-and-forget 方式调用（保持 setActiveNote 同步签名不变）。
 * 快照在用户第一次触发保存前必须就绪（通常有充足时间）。
 */
async function initNoteBaseSnapshot(
  wsId: string,
  noteId: string,
  slot: NoteSlot = 'left',
): Promise<void> {
  try {
    const note = await noteCap().getNote(noteId);
    if (!note) return;
    // 若在 getNote 期间用户已切换到别的 note，跳过（防竞态覆盖）—— 只看本槽
    const ws = workspaceManager.get(wsId);
    if (!ws) return;
    const current = getActiveNoteId(hydrate(ws), slot);
    if (current !== noteId) return;
    const blockHashesMap = new Map(Object.entries(note.blockHashes));
    setNoteBaseSnapshot(noteScopeKey(wsId, slot), {
      noteId,
      docVersion: note.docVersion,
      // 存 getNote 返回的**权威** docHash（SHA-1，与 getNoteVersionInfo 同算法）。
      // 不本地 computeDocHashFromMap（裸拼接串 ≠ db 的 SHA-1 → Step 4 永失败 → 误判并发写）。
      docHash: note.docHash,
      blockHashes: blockHashesMap,
      openedAt: Date.now(),
      openedBySession: wsId,
    });
  } catch (err) {
    console.error(`[data-model/initNoteBaseSnapshot] wsId=${wsId} noteId=${noteId}:`, err);
  }
}

// computeDocHashFromMap 已删除(2026-07-25):它返回裸拼接串,与主进程 computeDocHash 的
// SHA-1 hex 永不相等,导致 updateNoteWithMerge Step 4 快路径永远失败 → 每次写误判并发写。
// baseSnapshot.docHash 现统一存主进程返回的权威 docHash(NoteInfo.docHash),不再本地重算。

// ── 文件夹 ──

export async function createFolder(
  workspaceId: string,
  parentId: string | null = null,
): Promise<{ id: string; title: string } | null> {
  // 同父级同名 → 取最小可用序号("新建文件夹" → "新建文件夹 2" → "新建文件夹 3" ...)
  const all = await folderCap().listFolders('note');
  const siblings = all.filter((f) => f.parentId === parentId);
  const title = nextAvailableFolderName('新建文件夹', siblings.map((s) => s.title));

  const folder = await folderCap().createFolder(title, parentId, 'note');
  if (!folder) return null;
  // 父文件夹自动展开
  if (parentId) {
    const ws = workspaceManager.get(workspaceId);
    if (ws) {
      const cur = hydrate(ws).expandedFolders;
      if (!cur.has(parentId)) {
        const next = new Set(cur);
        next.add(parentId);
        writePersistent(workspaceId, { expandedFolders: Array.from(next) });
      }
    }
  }
  return { id: folder.id, title: folder.title };
}

/** 同父级同名兜底:base 未占用直接用,否则取最小可用 "base N" (N>=2) */
function nextAvailableFolderName(base: string, existingTitles: string[]): string {
  const taken = new Set(existingTitles);
  if (!taken.has(base)) return base;
  for (let n = 2; n < 10000; n++) {
    const candidate = `${base} ${n}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base} ${Date.now()}`;
}

/**
 * 删 folder (Path Y:递归删子 folder + 内含资源,对齐 macOS Finder)
 * 业务契约变更见 decision 012 设计师批复 + decision 014 §6.2.6 (cascade scope 扩展)
 * 返回删除统计(deletedFolders + deletedResources + cascadedEdges),caller 可记账。
 */
export async function deleteFolder(
  folderId: string,
  opts?: { progressTaskId?: string },
): Promise<FolderDeleteResult> {
  return folderCap().deleteFolder(folderId, opts);
}

/** 重命名 folder (L7-sub2:title 写 atom.payload.title) */
export async function renameFolder(folderId: string, newTitle: string): Promise<void> {
  await folderCap().renameFolder(folderId, newTitle);
}

/** 移动 folder (改 parentId,内部走 user:krig:inFolder 边重写) */
export async function moveFolder(
  folderId: string,
  newParentId: string | null,
): Promise<void> {
  await folderCap().moveFolder(folderId, newParentId);
}

export function setFolderExpanded(workspaceId: string, folderId: string, expanded: boolean): void {
  const ws = workspaceManager.get(workspaceId);
  if (!ws) return;
  const cur = hydrate(ws).expandedFolders;
  const next = new Set(cur);
  if (expanded) next.add(folderId);
  else next.delete(folderId);
  writePersistent(workspaceId, { expandedFolders: Array.from(next) });
}

// ── 选中(transient)──

export function setSelectedIds(workspaceId: string, ids: Set<string>): void {
  writeTransientSelected(workspaceId, ids);
}

export function getSelectedIds(workspaceId: string): Set<string> {
  return transientSelected.get(workspaceId) ?? new Set();
}

// ── 排序 ──

export function setFolderSort(workspaceId: string, folderKey: string, sort: SortState): void {
  const ws = workspaceManager.get(workspaceId);
  if (!ws) return;
  const cur = hydrate(ws).folderSortMap;
  writePersistent(workspaceId, {
    folderSortMap: { ...cur, [folderKey]: sort },
  });
}

export function cycleSortByTitle(workspaceId: string, folderKey: string): void {
  const ws = workspaceManager.get(workspaceId);
  if (!ws) return;
  const cur = hydrate(ws).folderSortMap[folderKey];
  const next: SortState = cur === 'title-asc' ? 'title-desc' : 'title-asc';
  setFolderSort(workspaceId, folderKey, next);
}

export function cycleSortByDate(workspaceId: string, folderKey: string): void {
  const ws = workspaceManager.get(workspaceId);
  if (!ws) return;
  const cur = hydrate(ws).folderSortMap[folderKey];
  const next: SortState = cur === 'date-asc' ? 'date-desc' : 'date-asc';
  setFolderSort(workspaceId, folderKey, next);
}

// ── 剪贴板 ──

export function setClipboard(workspaceId: string, clip: { type: 'note' | 'folder'; id: string } | null): void {
  writePersistent(workspaceId, { clipboard: clip });
}
