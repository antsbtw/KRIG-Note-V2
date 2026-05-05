/**
 * WorkspaceBus — 三类管道组合
 *
 * 见 PROTOCOL.md 三类管道 + 9 条铁律 + DESIGN.md § 2 / § 3。
 *
 * 用法(渲染层 React):
 *   const bus = useWorkspaceBus();
 *   bus.channels.emit('note.selection.changed', payload);
 *   const result = await bus.requests.request('ai.summarize', input);
 *   bus.slot.openRight('graph', { nodeId: 'n1' });
 *
 * 生命周期:
 * - 每 Workspace 一实例,挂在 WorkspaceManager.buses Map
 * - workspaceManager.close(id) 时调 dispose 释放
 */

import { ChannelHub } from './channel';
import { RequestHub } from './request';
import { SlotControl } from './slot-control';
import type { WorkspaceManager } from '@workspace/workspace-state/workspace-manager';

export class WorkspaceBus {
  readonly channels: ChannelHub;
  readonly requests: RequestHub;
  readonly slot: SlotControl;

  constructor(wsId: string, manager: WorkspaceManager) {
    this.channels = new ChannelHub();
    this.requests = new RequestHub();
    this.slot = new SlotControl(wsId, manager);
  }

  /** 销毁 — Workspace close 时调,清空 channel/request,SlotControl 无状态无需清 */
  dispose(): void {
    this.channels.dispose();
    this.requests.dispose();
  }
}
