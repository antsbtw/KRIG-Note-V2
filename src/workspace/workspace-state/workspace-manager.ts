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

  /** 关闭 Workspace */
  close(id: string): string | null {
    if (!this.workspaces.has(id)) return null;

    // L3.5:释放 bus 实例(channel listeners / request handlers / lastValues 全清)
    const bus = this.buses.get(id);
    if (bus) {
      bus.dispose();
      this.buses.delete(id);
    }

    this.workspaces.delete(id);

    // 关闭活跃 Workspace 时切到相邻
    if (this.activeId === id) {
      const remaining = this.getAll();
      if (remaining.length > 0) {
        this.activeId = remaining[remaining.length - 1].id;
      } else {
        // 至少保留一个 Workspace
        const newWs = this.create();
        this.activeId = newWs.id;
      }
    }

    this.notify();
    return this.activeId;
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
    this.listeners.forEach((l) => l());
    this.saveToPersistence();
  }

  // ── 持久化 ──

  /** 加载持久化状态(应用启动时调) */
  loadFromPersistence(): void {
    if (!this.persistence) return;
    const state = this.persistence.load();
    if (!state) return;

    state.workspaces.forEach((ws) => this.workspaces.set(ws.id, ws));
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

  /** 确保至少有一个 Workspace(应用启动时,持久化加载后调) */
  ensureMinimum(): void {
    if (this.count === 0) {
      const ws = this.create();
      this.setActive(ws.id);
    } else if (!this.activeId || !this.workspaces.has(this.activeId)) {
      const first = this.getAll()[0];
      this.setActive(first.id);
    }
  }
}

/** 全局单例 */
export const workspaceManager = new WorkspaceManager();
