/**
 * WorkspaceManager
 *
 * V2 Workspace 实例池 + 切换 + 持久化。
 *
 * V2 vs V1 差异:
 * - WorkspaceState 字段精简(去散落业务字段,加 navSideCollapsed)
 * - 加 subscribe(useSyncExternalStore 友好)
 * - 加 toggleNavSide 助手
 * - 持久化抽象成 PersistenceAPI(默认 localStorage,未来可换 SurrealDB)
 *
 * V2 决策(charter § 1.4):取消 WorkMode 概念,用 viewType。
 */

import type { WorkspaceState, WorkspaceManagerState } from './workspace-state';
import { createDefaultWorkspaceState, DIVIDER_RATIO_MIN, DIVIDER_RATIO_MAX } from './default-state';
import type { PersistenceAPI } from '../persistence/persistence-api';
import type { SlotUpdateSource } from '@slot/workspace-bus/bus-types';
import { WorkspaceBus } from '@slot/workspace-bus/workspace-bus';

/** WorkspaceManager.update 可选元数据 */
export interface UpdateMeta {
  /** slotBinding 修改来源(诊断 / 审计用)*/
  source?: SlotUpdateSource;
}

export class WorkspaceManager {
  private workspaces: Map<string, WorkspaceState> = new Map();
  private activeId: string | null = null;
  private counter = 0;
  private listeners: Set<() => void> = new Set();
  private persistence: PersistenceAPI | null = null;
  /** 每 Workspace 一个 bus 实例(L3.5,lazy 创建)*/
  private buses: Map<string, WorkspaceBus> = new Map();

  /**
   * 缓存 getAll() 结果(用于 useSyncExternalStore getSnapshot 稳定引用)
   *
   * React useSyncExternalStore 要求 getSnapshot 返回稳定引用(===),
   * 否则触发"Maximum update depth exceeded"无限循环。
   *
   * 缓存在数据变化时(notify 内)失效。
   */
  private cachedAll: WorkspaceState[] | null = null;
  /** getOpen 缓存(同 cachedAll,notify 时失效)*/
  private cachedOpen: WorkspaceState[] | null = null;

  /** 注入持久化实现(允许测试 / 未来切 SurrealDB) */
  setPersistence(persistence: PersistenceAPI | null): void {
    this.persistence = persistence;
  }

  /** 创建新 Workspace */
  create(label?: string): WorkspaceState {
    const id = `ws-${++this.counter}`;
    const ws = createDefaultWorkspaceState(
      id,
      label ?? `Workspace ${this.counter}`,
      !!label,
    );
    this.workspaces.set(id, ws);
    this.notify();
    return ws;
  }

  /** 从持久化恢复 Workspace(保留原始 ID + counter) */
  restore(state: WorkspaceState): WorkspaceState {
    this.workspaces.set(state.id, state);
    const match = state.id.match(/^ws-(\d+)$/);
    if (match) {
      const num = parseInt(match[1], 10);
      if (num > this.counter) this.counter = num;
    }
    return state;
  }

  /** 切换活跃 Workspace */
  setActive(id: string): WorkspaceState | undefined {
    const ws = this.workspaces.get(id);
    if (!ws) return undefined;
    this.activeId = id;
    this.notify();
    return ws;
  }

  /** 获取活跃 Workspace */
  getActive(): WorkspaceState | undefined {
    if (!this.activeId) return undefined;
    return this.workspaces.get(this.activeId);
  }

  /** 获取活跃 Workspace ID */
  getActiveId(): string | null {
    return this.activeId;
  }

  /** 获取指定 Workspace */
  get(id: string): WorkspaceState | undefined {
    return this.workspaces.get(id);
  }

  /**
   * 获取所有 Workspace(按创建顺序)
   *
   * 返回缓存数组 — 数据未变时返回同一引用(useSyncExternalStore 要求)。
   * 缓存在 notify() 时失效。
   */
  getAll(): WorkspaceState[] {
    if (this.cachedAll === null) {
      this.cachedAll = Array.from(this.workspaces.values());
    }
    return this.cachedAll;
  }

  /**
   * 获取在顶部 bar 打开的 Workspace(isOpen=true,按创建顺序)。
   *
   * 顶部 bar / WorkspaceContainer 用。同 getAll 的引用稳定要求:带缓存,notify 时失效。
   */
  getOpen(): WorkspaceState[] {
    if (this.cachedOpen === null) {
      this.cachedOpen = this.getAll().filter((w) => w.isOpen);
    }
    return this.cachedOpen;
  }

  /**
   * 部分更新 Workspace(id 不可变,触发 notify)
   *
   * @param meta 可选元数据 — `source` 标记 slotBinding 修改来源(L3.5):
   *   'navside' / 'bus' / 'frame'。诊断 / 审计用,manager 不据此分支。
   */
  update(
    id: string,
    partial: Partial<WorkspaceState>,
    _meta?: UpdateMeta,
  ): WorkspaceState | undefined {
    const ws = this.workspaces.get(id);
    if (!ws) return undefined;

    // dividerRatio 限制
    let normalized = { ...partial };
    if (typeof normalized.dividerRatio === 'number') {
      normalized.dividerRatio = Math.max(DIVIDER_RATIO_MIN, Math.min(DIVIDER_RATIO_MAX, normalized.dividerRatio));
    }

    const updated = { ...ws, ...normalized, id };
    this.workspaces.set(id, updated);
    this.notify();
    return updated;
  }

  /**
   * 获取 Workspace 的 bus 实例(L3.5)
   *
   * lazy 创建,每 Workspace 一个,跨 Workspace 不通(铁律 2)。
   * Workspace 不存在返回 undefined。
   */
  getBus(id: string): WorkspaceBus | undefined {
    if (!this.workspaces.has(id)) return undefined;
    let bus = this.buses.get(id);
    if (!bus) {
      bus = new WorkspaceBus(id, this);
      this.buses.set(id, bus);
    }
    return bus;
  }

  /** 已创建的 bus 实例数(诊断用)*/
  get busCount(): number {
    return this.buses.size;
  }

  /** NavSide Toggle 助手(L2 WorkspaceBar 调用) */
  toggleNavSide(id: string): void {
    const ws = this.get(id);
    if (ws) this.update(id, { navSideCollapsed: !ws.navSideCollapsed });
  }

  /**
   * NavSide 命令式设值(2026-05-24:供 view 触发"复合操作"用,如 ⛶ 全屏需强制收 NavSide)。
   *
   * 分层原则:view 不直接 mutate workspace state;通过本 API 触发高层副作用 —
   * 与 commandRegistry / bus.slot / channels 同模式(高层提供 API,底层调用)。
   *
   * 已是目标值时跳过 update(避免无意义 listener 通知)。
   */
  setNavSideCollapsed(id: string, collapsed: boolean): void {
    const ws = this.get(id);
    if (!ws || ws.navSideCollapsed === collapsed) return;
    this.update(id, { navSideCollapsed: collapsed });
  }

  /**
   * 关闭 Workspace(顶部 bar 「×」)= 从顶部收起,**不删数据**。
   *
   * 工作空间连同 cookie/配置保留在库里(NavSide 工作空间列表仍可见,点击可重新打开)。
   * bus 不在收起时 dispose(重新打开要复用);真删见 remove()。
   */
  close(id: string): string | null {
    const ws = this.workspaces.get(id);
    if (!ws || ws.isOpen === false) return this.activeId;

    this.update(id, { isOpen: false });

    // 收起的若是活跃,切到另一个【打开的】;无则至少打开一个
    if (this.activeId === id) this.activateAnotherOpen();

    return this.activeId;
  }

  /**
   * 从库彻底删除 Workspace(NavSide 删除入口)= 真删 + 释放 bus。
   *
   * cookie 真删需主进程 session API(renderer 不能直接动 session)— 暂留 TODO,
   * 后续随 IPC 接通。先做写库删除(fail loud:删不掉不静默)。
   */
  remove(id: string): string | null {
    if (!this.workspaces.has(id)) return this.activeId;

    // L3.5:释放 bus 实例(channel listeners / request handlers / lastValues 全清)
    const bus = this.buses.get(id);
    if (bus) {
      bus.dispose();
      this.buses.delete(id);
    }

    this.workspaces.delete(id);

    // 删的是活跃 → 切到另一个打开的
    if (this.activeId === id) this.activateAnotherOpen();

    // TODO: 清该 ws 的 webview partition cookie(主进程 session.clearStorageData)

    this.notify();
    return this.activeId;
  }

  /**
   * 重新打开一个已收起的 Workspace(NavSide 点击列表项时用)。
   * 标记 isOpen=true,使其重新出现在顶部 bar。
   */
  open(id: string): void {
    const ws = this.workspaces.get(id);
    if (!ws || ws.isOpen) return;
    this.update(id, { isOpen: true });
  }

  /** 活跃被收起/删除后,切到任一仍打开的;一个打开的都没有则新建一个保底 */
  private activateAnotherOpen(): void {
    const open = this.getAll().filter((w) => w.isOpen);
    if (open.length > 0) {
      this.activeId = open[open.length - 1].id;
      this.notify();
    } else {
      const ws = this.create(); // create 内已 notify
      this.activeId = ws.id;
      this.notify(); // 落 activeId(create 那次 notify 时 activeId 还是旧的)
    }
  }

  /** 重命名 Workspace */
  rename(id: string, label: string): void {
    this.update(id, { label, customLabel: true });
  }

  /** Workspace 数量 */
  get count(): number {
    return this.workspaces.size;
  }

  // ── 订阅(React useSyncExternalStore 用)──

  /** 订阅状态变化,返回取消订阅函数 */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** 内部通知所有订阅者 + 自动持久化 + 失效缓存 */
  private notify(): void {
    this.cachedAll = null; // 数据变化,失效缓存(下次 getAll 重建)
    this.cachedOpen = null; // 同失效 open 缓存
    this.listeners.forEach((l) => l());
    this.saveToPersistence();
  }

  // ── 持久化 ──

  /** 加载持久化状态(应用启动时调) */
  loadFromPersistence(): void {
    if (!this.persistence) return;
    const state = this.persistence.load();
    if (!state) return;

    // 老数据无 isOpen → 视为 true(向后兼容)
    state.workspaces.forEach((ws) =>
      this.workspaces.set(ws.id, { ...ws, isOpen: ws.isOpen ?? true }),
    );
    this.activeId = state.activeId;
    this.counter = state.counter;
    this.notify();
  }

  /** 保存当前状态到持久化(私有,通过 notify 自动调用)*/
  private saveToPersistence(): void {
    if (!this.persistence) return;
    const state: WorkspaceManagerState = {
      workspaces: this.getAll(),
      activeId: this.activeId,
      counter: this.counter,
    };
    this.persistence.save(state);
  }

  /** 确保至少有一个【打开的】 Workspace,且 active 指向打开的(启动时,持久化加载后调) */
  ensureMinimum(): void {
    if (this.count === 0) {
      const ws = this.create();
      this.setActive(ws.id);
      return;
    }
    const open = this.getAll().filter((w) => w.isOpen);
    if (open.length === 0) {
      // 库里有,但全收起了 → 打开第一个(顶部 bar 不能空)
      const first = this.getAll()[0];
      this.update(first.id, { isOpen: true });
      this.setActive(first.id);
    } else if (!this.activeId || !this.workspaces.get(this.activeId)?.isOpen) {
      // active 缺失或指向已收起的 → 切到一个打开的
      this.setActive(open[0].id);
    }
  }
}

/** 全局单例 */
export const workspaceManager = new WorkspaceManager();
