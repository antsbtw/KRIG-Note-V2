/**
 * SlotControl — 容器控制(框架级保留指令)
 *
 * 见 PROTOCOL.md 铁律 6/7/8/9 + DESIGN.md § 4.1(right→left 升级)。
 *
 * 四个 API(fix/slot-symmetry 起左右对称):
 * - openLeft(viewId, payload?) — 装 left slot
 * - openRight(viewId, payload?) — 装 right slot
 * - closeRight() — 关 right slot
 * - closeLeft() — 关 left slot;有 right 则升级 right→left,无 right 则拒绝(铁律 8)
 *
 * 铁律 7 修订:SlotArea 的 React key 已改为 `${viewId}:${slot}`(为支持同一 view
 * 左右双开),故 right→left 升级时实例**会**重建。详见 closeLeft / SlotArea 注释。
 */

import { ok, fail } from './bus-types';
import type { Result } from './bus-types';
import type { WorkspaceManager } from '@workspace/workspace-state/workspace-manager';

export class SlotControl {
  constructor(
    private wsId: string,
    private workspaceManager: WorkspaceManager,
  ) {}

  /**
   * 装 left slot — viewId 必填,payload 可选(fix/slot-symmetry)
   *
   * 铁律 5 原本禁止 openLeft(「主 view 锁」,唯一入口是 NavSide 点击)。该禁令
   * 的前提是"left 是主 view、right 是附属",而左右对称化之后这个前提不再成立 ——
   * 用户可以左右都装 Note 各看一篇。故解禁,与 openRight 完全对称。
   *
   * 注意:不触发铁律 9 的"切主 view 自动关 right" —— 那是 NavSide 切换的语义
   * (换主 view ⇒ 附属失去意义),而 openLeft 是显式装槽,不该连带清空另一侧。
   */
  openLeft(viewId: string, payload?: unknown): Result<void> {
    const ws = this.workspaceManager.get(this.wsId);
    if (!ws) return fail('workspace-not-found', { wsId: this.wsId });

    this.workspaceManager.update(
      this.wsId,
      {
        slotBinding: {
          ...ws.slotBinding,
          left: viewId,
          leftPayload: payload,
        },
      },
      { source: 'bus' },
    );
    return ok(undefined);
  }

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
   * - right !== null:升级 right → left
   * - right === null:拒绝(铁律 8 — 最后一个 view 不可关)
   *
   * fix/slot-same-view-both-slots:SlotArea 的 React key 已带 slot 维度
   * (`${viewId}:${slot}`),故升级**会**让该 view 实例重建 —— 原注释所说的
   * "view 实例不重建(SlotArea 按 viewId 缓存)"不再成立。这是 per-slot 身份的
   * 必然代价:要么实例按 viewId 唯一(左右无法双开),要么按槽唯一(升级需重建),
   * 二者不可兼得。选后者,状态保留改由 view 自身持久化兜住。
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
