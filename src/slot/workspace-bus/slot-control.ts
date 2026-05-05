/**
 * SlotControl — 容器控制(框架级保留指令)
 *
 * 见 PROTOCOL.md 铁律 6/7/8/9 + DESIGN.md § 4.1(right→left 升级)。
 *
 * 三个 API:
 * - openRight(viewId, payload?) — 装 right slot
 * - closeRight() — 关 right slot
 * - closeLeft() — 关 left slot;有 right 则升级 right→left,无 right 则拒绝(铁律 8)
 *
 * 实施铁律 7:right→left 升级时 view 实例不重建(由 SlotArea 按 viewId 缓存负责)。
 * 这里只改 slotBinding 字段,SlotArea 看到 left 字段值变成原 right 的 viewId,
 * 而该 viewId 的 React 实例继续存在,React key 不变 ⇒ 状态保留。
 */

import { ok, fail } from './bus-types';
import type { Result } from './bus-types';
import type { WorkspaceManager } from '@workspace/workspace-state/workspace-manager';

export class SlotControl {
  constructor(
    private wsId: string,
    private workspaceManager: WorkspaceManager,
  ) {}

  /** 装 right slot — viewId 必填,payload 可选 */
  openRight(viewId: string, payload?: unknown): Result<void> {
    const ws = this.workspaceManager.get(this.wsId);
    if (!ws) return fail('workspace-not-found', { wsId: this.wsId });

    this.workspaceManager.update(
      this.wsId,
      {
        slotBinding: {
          ...ws.slotBinding,
          right: viewId,
          rightPayload: payload,
        },
      },
      { source: 'bus' },
    );
    return ok(undefined);
  }

  /** 关 right slot */
  closeRight(): Result<void> {
    const ws = this.workspaceManager.get(this.wsId);
    if (!ws) return fail('workspace-not-found', { wsId: this.wsId });

    this.workspaceManager.update(
      this.wsId,
      {
        slotBinding: {
          ...ws.slotBinding,
          right: null,
          rightPayload: undefined,
        },
      },
      { source: 'bus' },
    );
    return ok(undefined);
  }

  /**
   * 关 left slot
   *
   * - right !== null:升级 right → left(view 实例不重建)
   * - right === null:拒绝(铁律 8 — 最后一个 view 不可关)
   */
  closeLeft(): Result<void> {
    const ws = this.workspaceManager.get(this.wsId);
    if (!ws) return fail('workspace-not-found', { wsId: this.wsId });

    if (ws.slotBinding.right === null) {
      return fail('last-view-cannot-close', {
        wsId: this.wsId,
        currentLeft: ws.slotBinding.left,
      });
    }

    this.workspaceManager.update(
      this.wsId,
      {
        slotBinding: {
          left: ws.slotBinding.right,
          leftPayload: ws.slotBinding.rightPayload,
          right: null,
          rightPayload: undefined,
        },
      },
      { source: 'bus' },
    );
    return ok(undefined);
  }
}
