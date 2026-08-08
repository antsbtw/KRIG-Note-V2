/**
 * 主进程楼长 —— WorkspaceManager 主进程侧
 *
 * 职责：ws 的生老病死（create/close/remove/open/rename/setActive）。
 * 持久化：SurrealDB workspace 表单记录快照（rid='current'）。
 * 广播：状态变化后向所有 renderer 窗口广播 WORKSPACE_STATE_CHANGED。
 *
 * S3-b：从 JSON 文件换成 SurrealDB（schema 1.7.0）。
 */

import { BrowserWindow, session } from 'electron';
import { RecordId } from 'surrealdb';
import { getDB } from '@storage/surreal/client';
import { IPC_CHANNELS } from '@shared/ipc/channel-names';
import { createDefaultWorkspaceState } from '@workspace/workspace-state/default-state';
import type { WorkspaceState, WorkspaceManagerState } from '@workspace/workspace-state/workspace-state';
import { proxyNodeStore } from '../web-proxy/proxy-node-store';

// ── 状态 ────────────────────────────────────────────────────────

let workspaces = new Map<string, WorkspaceState>();
let activeId: string | null = null;
let counter = 0;

// ── 持久化（SurrealDB）──────────────────────────────────────────

const WS_RECORD_ID = new RecordId('workspace', 'current');

async function loadStateFromDB(): Promise<WorkspaceManagerState | null> {
  try {
    const db = getDB();
    const result = await db.query<[Array<WorkspaceManagerState>]>(
      `SELECT * FROM $rid LIMIT 1`,
      { rid: WS_RECORD_ID },
    );
    return result[0]?.[0] ?? null;
  } catch (err) {
    console.warn('[workspace-manager-main] loadStateFromDB failed:', err);
    return null;
  }
}

/** 写库本体 —— 失败照常抛,由调用方决定吞还是报 */
async function persistStateOrThrow(state: WorkspaceManagerState): Promise<void> {
  const db = getDB();
  await db.query(
    `UPSERT $rid SET workspaces = $workspaces, activeId = $activeId, counter = $counter`,
    {
      rid: WS_RECORD_ID,
      workspaces: state.workspaces,
      // SurrealDB option<string> 需要 undefined（NONE），不接受 null
      activeId: state.activeId ?? undefined,
      counter: state.counter,
    },
  );
}

/**
 * 常规持久化 —— 调用方多为 `void persistState(...)` 的即发即忘路径,失败只记录不抛
 * (抛出会变成未处理 rejection)。需要知道写成没成的路径请直接用 persistStateOrThrow。
 */
async function persistState(state: WorkspaceManagerState): Promise<void> {
  try {
    await persistStateOrThrow(state);
  } catch (err) {
    console.error('[workspace-manager-main] persistState failed:', err);
  }
}

// ── 广播 ────────────────────────────────────────────────────────

const _wsChangeListeners = new Set<() => void>();
export function onWorkspacesChanged(cb: () => void): void {
  _wsChangeListeners.add(cb);
}

async function broadcast(): Promise<void> {
  const state = getFullState();
  // 持久化（异步，不阻塞广播）
  void persistState(state);
  // 广播（同步）
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(IPC_CHANNELS.WORKSPACE_STATE_CHANGED, state);
    }
  }
  // 通知主进程内订阅者（如菜单重建）
  _wsChangeListeners.forEach((cb) => cb());
}

// ── 公共 API ────────────────────────────────────────────────────

export function getFullState(): WorkspaceManagerState {
  return {
    workspaces: Array.from(workspaces.values()),
    activeId,
    counter,
  };
}

export async function initWorkspaceManager(): Promise<void> {
  const saved = await loadStateFromDB();
  if (saved) {
    saved.workspaces.forEach((ws) =>
      workspaces.set(ws.id, { ...ws, isOpen: ws.isOpen ?? true }),
    );
    activeId = saved.activeId ?? null;
    counter = saved.counter;
  }
  ensureMinimum();
}

export function wsCreate(
  inheritSlotBinding?: WorkspaceState['slotBinding'],
): WorkspaceState {
  const id = `ws-${++counter}`;
  const ws = createDefaultWorkspaceState(id, `Workspace ${workspaces.size + 1}`, false);
  if (inheritSlotBinding) {
    ws.slotBinding = { left: inheritSlotBinding.left, right: null };
  }
  workspaces.set(id, ws);
  void broadcast();
  return ws;
}

/**
 * 窗口 ready 后将 workspace 的代理/UA 配置应用到其 session。
 * 在 createWindow(wsId) loadURL 完成后调用，此时 session 已初始化。
 */
export async function applyWsConfigToSession(wsId: string): Promise<void> {
  const ws = workspaces.get(wsId);
  if (!ws) return;

  const partition = `persist:webview-${wsId}`;
  const sess = session.fromPartition(partition);

  // 应用代理
  if (ws.proxyId) {
    const rules = await proxyNodeStore.resolveRules(ws.proxyId);
    await sess.setProxy(rules === 'direct://' ? { mode: 'direct' } : { proxyRules: rules });
  } else {
    await sess.setProxy({ mode: 'direct' });
  }

  // 应用 User-Agent
  if (ws.userAgent) {
    sess.setUserAgent(ws.userAgent);
  }

  console.log('[ws-config] applied ws=', wsId, 'proxy=', ws.proxyId ?? 'direct', 'ua=', ws.userAgent ?? '(default)');
}

export function getActiveWorkspace(): WorkspaceState | null {
  return activeId ? (workspaces.get(activeId) ?? null) : null;
}

export function wsClose(id: string): void {
  const ws = workspaces.get(id);
  if (!ws || !ws.isOpen) return;
  workspaces.set(id, { ...ws, isOpen: false });
  if (activeId === id) activateAnotherOpen();
  void broadcast();
}

/** BrowserWindow 创建/关闭时同步更新 hasWindow 并持久化 */
export function wsSetHasWindow(id: string, value: boolean): void {
  const ws = workspaces.get(id);
  if (!ws) return;
  workspaces.set(id, { ...ws, hasWindow: value });
  void persistState(getFullState());
}

export function wsRemove(id: string): void {
  if (!workspaces.has(id)) return;
  workspaces.delete(id);
  if (activeId === id) activateAnotherOpen();
  void broadcast();
}

export function wsOpen(id: string): void {
  const ws = workspaces.get(id);
  if (!ws || ws.isOpen) return;
  workspaces.set(id, { ...ws, isOpen: true });
  void broadcast();
}

export function wsRename(id: string, label: string): void {
  const ws = workspaces.get(id);
  if (!ws) return;
  workspaces.set(id, { ...ws, label, customLabel: true });
  void broadcast();
}

export function wsSetActive(id: string): void {
  if (!workspaces.has(id)) return;
  activeId = id;
  void broadcast();
}

export function wsSetConfig(
  wsId: string,
  config: { color?: string; proxyId?: string | null; userAgent?: string | null },
): void {
  const ws = workspaces.get(wsId);
  if (!ws) return;
  const next = { ...ws };
  if ('color' in config) next.color = config.color;
  if ('proxyId' in config) {
    if (config.proxyId) next.proxyId = config.proxyId;
    else delete next.proxyId;
  }
  if ('userAgent' in config) {
    if (config.userAgent) next.userAgent = config.userAgent;
    else delete next.userAgent;
  }
  workspaces.set(wsId, next);
  void broadcast();
}

/**
 * 退出前对账 hasWindow —— 「上次退出瞬间的窗口布局」的唯一真源。
 *
 * 背景(启动重复开窗 bug):hasWindow 原先只在 createWindow 置 true、在窗口 closed 时
 * 置 false,而 closed 那条路被 `!appIsQuitting` 守卫挡住(守卫本意是别在 Cmd+Q 时把
 * 多窗口布局擦掉)。结果:用 New Window 开过第二个 ws 的窗口后**直接退出**(而非先手动
 * 关掉它),该 ws 的 hasWindow 永久停在 true → 下次启动 index.ts 按 hasWindow 过滤时
 * 又开一个窗口 → 又置 true → 自我永续,再无自然路径清除。
 *
 * 修法:退出时以「此刻真实存活的窗口集合」为准整体覆写,存活的 true、其余一律 false。
 * 语义由「曾经开过窗」纠正为「退出瞬间开着窗」,且首次运行即自愈历史脏值。
 *
 * 只写一次库(全量改完再 persist),因为调用点紧接 shutdownStorageSync —— 逐个
 * wsSetHasWindow 会产生 N 次异步写、关库前未必落完(与本 bug 同源的竞态)。
 */
export async function reconcileHasWindow(liveWsIds: string[]): Promise<void> {
  const live = new Set(liveWsIds);
  for (const [id, ws] of workspaces) {
    workspaces.set(id, { ...ws, hasWindow: live.has(id) });
  }
  // 用 OrThrow 版:这是退出前最后一次写,吞掉异常会让「以为对好了」而实际仍是旧快照
  // (正是本 bug 的失效模式)。调用方 catch 后记录并照常退出。
  await persistStateOrThrow(getFullState());
}

/** renderer 回写布局字段 + pluginStates，只持久化不广播（避免循环）*/
export function wsPersistState(wsId: string, patch: Record<string, unknown>): void {
  const ws = workspaces.get(wsId);
  if (!ws) return;
  workspaces.set(wsId, { ...ws, ...patch } as typeof ws);
  void persistState(getFullState());
}

// ── 内部工具 ────────────────────────────────────────────────────

function activateAnotherOpen(): void {
  const open = Array.from(workspaces.values()).filter((w) => w.isOpen);
  if (open.length > 0) {
    activeId = open[open.length - 1].id;
  } else if (workspaces.size > 0) {
    // 全收起了，打开第一个
    const first = Array.from(workspaces.values())[0];
    workspaces.set(first.id, { ...first, isOpen: true });
    activeId = first.id;
  } else {
    // 全删了，新建一个
    wsCreate();
  }
}

function ensureMinimum(): void {
  if (workspaces.size === 0) {
    const ws = wsCreate();
    activeId = ws.id;
    return;
  }
  const open = Array.from(workspaces.values()).filter((w) => w.isOpen);
  if (open.length === 0) {
    const first = Array.from(workspaces.values())[0];
    workspaces.set(first.id, { ...first, isOpen: true });
    activeId = first.id;
  } else if (!activeId || !workspaces.get(activeId)?.isOpen) {
    activeId = open[0].id;
  }
}
