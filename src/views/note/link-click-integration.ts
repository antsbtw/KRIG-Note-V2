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
import { setActiveNote, getNoteWsState } from './data-model';
import { noteStore } from './note-store';
import { setWebUrl } from '@views/web/data-model';
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
     * L5-B4:点 http(s):// 链接 → 当前 ws 右栏开 web view + 设 url
     *
     * 路径:
     * 1. setWebUrl(wsId, url):写 pluginStates['web'].currentUrl(WebView 订阅会刷新)
     * 2. workspaceManager.update slotBinding.right = 'web-view':切右栏到 web view
     *
     * 跨 ws 跳转留 ActiveResourceManager 抽象后(同 onOpenNote 降级)
     */
    /**
     * L5-B3.12:noteLink NodeView 同步目标 title — driver 不直接 import note-store,
     * 通过 handler 反向取(返回 null = 目标已删除,NodeView 切"未找到"态)
     */
    resolveNoteTitle(noteId) {
      const target = noteStore.get(noteId);
      return target ? target.title : null;
    },
    onOpenWebUrl(url) {
      const wsId = workspaceManager.getActiveId();
      if (!wsId) return;
      const ws = workspaceManager.get(wsId);
      if (!ws) return;
      // 1. 写 web view 的 currentUrl(per-ws 持久化)
      setWebUrl(wsId, url);
      // 2. 把右栏切到 web view(若已是 web-view 则 update 不会触发额外重渲)
      if (ws.slotBinding.right !== 'web-view') {
        workspaceManager.update(wsId, {
          slotBinding: { ...ws.slotBinding, right: 'web-view' },
        });
      }
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
