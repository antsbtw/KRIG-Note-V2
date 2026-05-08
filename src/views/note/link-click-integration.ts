/**
 * link-click view 集成(L5-B3.4)
 *
 * driver 的 link-click plugin 需要 view 注入 onOpenNote / getCurrentNoteId,
 * 因为"如何切笔记"是 view 业务,driver 不该知道。
 *
 * 路由策略(对齐 V2 当前能力,降级 V1):
 * - V1:点 krig://note → 当前 ws 右栏 NoteView + 切右栏 activeNoteId(不动左栏)
 * - V2 当前:**没有 rightActiveNoteId 字段**(V2 故意暂缺,等 ActiveResourceManager 层)
 *   → 降级:点 krig://note → 切当前 ws activeNoteId(覆盖左栏当前笔记)
 *
 * 跨 ws 跳转 / 真右栏 routing 留 ActiveResourceManager 抽象到位后补。
 *
 * 同文档 anchor 滚动由 driver 内部处理(scrollToBlockAnchor),view 不参与。
 */

import { setLinkClickHandler } from '@drivers/text-editing-driver';
import { workspaceManager } from '@workspace/workspace-state/workspace-manager';
import { commandRegistry } from '@slot/command-registry/command-registry';
import { setActiveNote, getNoteWsState } from './data-model';
import { noteStore } from './note-store';
import {
  setCurrentNoteId,
  navigateToNote,
} from './note-navigation-history';

let pendingAnchor: string | null = null;

/**
 * 取当前待执行的 anchor(笔记加载完成后由 NoteView 调 flushPendingAnchor 滚到位)
 */
export function takePendingAnchor(): string | null {
  const a = pendingAnchor;
  pendingAnchor = null;
  return a;
}

export function registerLinkClickIntegration(): void {
  setLinkClickHandler({
    onOpenNote(noteId, blockAnchor) {
      const wsId = workspaceManager.getActiveId();
      if (!wsId) return;
      // 历史栈推进
      navigateToNote(noteId);
      // 切当前 ws 的活跃笔记(V2 当前能力 — 覆盖左栏)
      setActiveNote(wsId, noteId);
      // 留待笔记加载完成后由 NoteView 滚动 anchor
      pendingAnchor = blockAnchor ?? null;
    },
    getCurrentNoteId() {
      const wsId = workspaceManager.getActiveId();
      if (!wsId) return null;
      const ws = workspaceManager.get(wsId);
      if (!ws) return null;
      return getNoteWsState(ws).activeNoteId;
    },
    /**
     * L5-B3.12:noteLink NodeView 同步目标 title — driver 不直接 import note-store,
     * 通过 handler 反向取(返回 null = 目标已删除,NodeView 切"未找到"态)
     */
    resolveNoteTitle(noteId) {
      const target = noteStore.get(noteId);
      return target ? target.title : null;
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
  const wsId = workspaceManager.getActiveId();
  if (wsId) {
    const ws = workspaceManager.get(wsId);
    if (ws) {
      setCurrentNoteId(getNoteWsState(ws).activeNoteId);
    }
  }
}
