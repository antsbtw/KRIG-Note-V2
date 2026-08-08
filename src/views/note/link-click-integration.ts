/**
 * link-click view 集成(L5-B3.4)
 *
 * driver 的 link-click plugin 需要 view 注入 onOpenNote / getCurrentNoteId,
 * 因为"如何切笔记"是 view 业务,driver 不该知道。
 *
 * 路由策略(fix/slot-per-slot-active-note 起恢复 V1 语义):
 * - 点 krig://note → 装右栏 NoteView + 切**右栏** activeNoteId,**不动左栏**
 * - 依赖:rightActiveNoteId 字段已补回(data-model.ts),右栏能独立显示另一篇
 *
 * 历史:V2 初期砍掉 rightActiveNoteId,此处曾降级为"覆盖左栏当前笔记"。
 * 左右双开落地后该降级取消 —— 点内链不该把用户正在读的左栏顶掉。
 *
 * 跨 ws 跳转仍留 ActiveResourceManager 抽象到位后补。
 *
 * 同文档 anchor 滚动由 driver 内部处理(scrollToBlockAnchor),view 不参与。
 */

import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import type { TextEditingApi } from '@capabilities/text-editing/types';
import { workspaceManager } from '@workspace/workspace-state/workspace-manager';
import { getActiveWorkspaceIdSync } from '@workspace/workspace-instance/use-workspace';
import { commandRegistry } from '@slot/command-registry/command-registry';
import { setActiveNote, getNoteWsState, getActiveNoteId, type NoteSlot } from './data-model';
import { getActiveSlot } from '@workspace/workspace-state/active-slot';
import { startNoteCache, getNoteTitle } from './note-cache';
import {
  setCurrentNoteId,
  navigateToNote,
} from './note-navigation-history';

/**
 * 待执行的滚动 anchor,**带目标槽**(fix/slot-per-slot-active-note)。
 *
 * 原先是裸 `string | null` 模块单例。左右双开后两个 NoteView 实例都会在
 * activeNoteId 变化时调 takePendingAnchor() —— 谁先跑谁拿走,另一个拿到 null,
 * 表现为"右栏跳到笔记但不滚到锚点,左栏反而莫名其妙滚动"。
 * 加 slot 后按槽认领,不是自己的不取走。
 */
let pendingAnchor: { slot: NoteSlot; anchor: string | null } | null = null;

/**
 * 取**本槽**待执行的 anchor(笔记加载完成后由 NoteView 滚到位)。
 * 不是本槽的留着不动,交给目标槽那个实例认领。
 */
export function takePendingAnchor(slot: NoteSlot): string | null {
  if (!pendingAnchor || pendingAnchor.slot !== slot) return null;
  const a = pendingAnchor.anchor;
  pendingAnchor = null;
  return a;
}

export function registerLinkClickIntegration(): void {
  // L7-sub2 (设计师批复 L2):view 层私有 sync cache,给 driver resolveNoteTitle 守约
  startNoteCache();

  const textEditing = requireCapabilityApi<TextEditingApi>('text-editing');
  textEditing.setLinkClickHandler({
    onOpenNote(noteId, blockAnchor) {
      const wsId = getActiveWorkspaceIdSync();
      if (!wsId) return;
      // 历史栈推进
      navigateToNote(noteId);
      // V1 语义:装右栏 + 切右栏活跃笔记,不动左栏
      const bus = workspaceManager.getBus(wsId);
      bus?.slot.openRight('note-view');
      setActiveNote(wsId, noteId, 'right');
      // 留待笔记加载完成后由右栏 NoteView 滚动 anchor
      pendingAnchor = { slot: 'right', anchor: blockAnchor ?? null };
    },
    /**
     * "当前笔记"用于 driver 判断同文档跳转(同文档 → 当场滚动,不开右栏)。
     *
     * feat/slot-navside-follow-active:槽的判定改走 activeSlot 单一来源。
     *
     * 原实现用**聚焦的 PM 实例**反推槽(`instanceId === ${wsId}::slot:right`)。
     * 那是第三种"当前是哪个槽"的算法,且恰恰在最需要它准的场合不准 ——
     * PM 焦点会被工具栏 preventDefault、浮层、非编辑区点击等打断,而 activeSlot
     * 由容器捕获维护,不受这些影响。
     */
    getCurrentNoteId() {
      const wsId = getActiveWorkspaceIdSync();
      if (!wsId) return null;
      const ws = workspaceManager.get(wsId);
      if (!ws) return null;
      const slot: NoteSlot = getActiveSlot(wsId);
      return getActiveNoteId(getNoteWsState(ws), slot);
    },
    /**
     * L5-B3.12:noteLink NodeView 同步目标 title — driver 不直接 import noteCapability,
     * 通过 handler 反向取(返回 null = 目标已删除 / 启动 cache 未就绪,NodeView 切"未找到"态)
     * L7-sub2:走 view 层私有 sync cache (note-cache.ts),启动后由 onListChanged 增量更新
     */
    resolveNoteTitle(noteId) {
      return getNoteTitle(noteId);
    },
    /**
     * L5-B4:点 http(s):// 链接 → 走命令路由,note 不直接 import @views/web
     * (charter § 1.2 + audit Wave 3.2)
     */
    onOpenWebUrl(url) {
      commandRegistry.execute('web-view.open-url', url);
    },
  });

  // 当前 active note id 同步到历史栈(初始化时取一次,后续靠 navigateToNote 更新)
  const wsId = getActiveWorkspaceIdSync();
  if (wsId) {
    const ws = workspaceManager.get(wsId);
    if (ws) {
      setCurrentNoteId(getNoteWsState(ws).activeNoteId);
    }
  }
}
