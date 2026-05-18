/**
 * ThoughtView 命令注册(对齐 views/note/note-commands.ts 签名:register(id, handler))
 *
 * 本文件仅做命令注册 + 表层 dispatch;业务实现拆 command-impl/:
 *   - add-from-note.ts  :⌘⇧M / 💭 三态 anchor 识别
 *   - ask-ai.ts         :🤖 AI response 状态机(mock)
 *   - scroll-to-source.ts:Thought → Note/Book 跨槽跳转
 *   - shared.ts         :capability getter + emptyDoc + preCreatePlaceholder
 *
 * Phase 5 §1 charter §1.4 体量审计落地:thought-commands.ts 468→<200 行。
 */

import { commandRegistry } from '@slot/command-registry/command-registry';
import { workspaceManager } from '@workspace/workspace-state/workspace-manager';
import type { ThoughtType } from '@capabilities/thought/types';
import { setActiveThought, setFolderExpanded, getThoughtWsState } from './data-model';
import { decodeTreeId } from './tree-builder';
import {
  thoughtCap,
  folderCap,
  emptyDoc,
  ensureThoughtViewActive,
  nextAvailableFolderName,
} from './command-impl/shared';
import { addThoughtFromNote } from './command-impl/add-from-note';
import { askAiFromNote } from './command-impl/ask-ai';
import { scrollToSource } from './command-impl/scroll-to-source';

export function registerThoughtCommands(): void {
  // ── thought CRUD ──

  commandRegistry.register('thought-view.create-thought', (folderId: unknown) => {
    const wsId = workspaceManager.getActiveId();
    if (!wsId) return;
    const fid = typeof folderId === 'string' && folderId ? folderId : null;
    void (async () => {
      const t = await thoughtCap().createThought({
        type: 'thought',
        resolved: false,
        pinned: false,
        doc: emptyDoc(),
        folderId: fid,
        anchor: null,
      });
      setActiveThought(wsId, t.id);
      if (fid) setFolderExpanded(wsId, fid, true);
      ensureThoughtViewActive(wsId);
    })();
  });

  commandRegistry.register('thought-view.set-active', (thoughtId: unknown) => {
    if (typeof thoughtId !== 'string') return;
    const wsId = workspaceManager.getActiveId();
    if (!wsId) return;
    setActiveThought(wsId, thoughtId);
    ensureThoughtViewActive(wsId);
  });

  commandRegistry.register('thought-view.delete-active', () => {
    const wsId = workspaceManager.getActiveId();
    if (!wsId) return;
    const ws = workspaceManager.get(wsId);
    if (!ws) return;
    const id = getThoughtWsState(ws).activeThoughtId;
    if (!id) return;
    void (async () => {
      await thoughtCap().deleteThought(id);
      setActiveThought(wsId, null);
    })();
  });

  commandRegistry.register('thought-view.delete-by-tree-id', (treeId: unknown) => {
    if (typeof treeId !== 'string') return;
    const decoded = decodeTreeId(treeId);
    void (async () => {
      if (decoded.type === 'thought') {
        await thoughtCap().deleteThought(decoded.id);
      } else {
        await folderCap().deleteFolder(decoded.id);
      }
    })();
  });

  // ── folder ──

  commandRegistry.register('thought-view.create-folder', (parentId: unknown) => {
    const wsId = workspaceManager.getActiveId();
    if (!wsId) return;
    const pid = typeof parentId === 'string' && parentId ? parentId : null;
    void (async () => {
      const all = await folderCap().listFolders('thought');
      const siblings = all.filter((f) => f.parentId === pid);
      const title = nextAvailableFolderName('新建文件夹', siblings.map((s) => s.title));
      await folderCap().createFolder(title, pid, 'thought');
      if (pid) setFolderExpanded(wsId, pid, true);
    })();
  });

  // ── thought 状态切换 ──

  commandRegistry.register('thought-view.change-type', (arg: unknown) => {
    if (!arg || typeof arg !== 'object') return;
    const { id, type } = arg as { id?: unknown; type?: unknown };
    if (typeof id !== 'string' || typeof type !== 'string') return;
    void thoughtCap().updateThought(id, { type: type as ThoughtType });
  });

  commandRegistry.register('thought-view.toggle-resolve', (id: unknown) => {
    if (typeof id !== 'string') return;
    void (async () => {
      const cur = await thoughtCap().getThought(id);
      if (!cur) return;
      await thoughtCap().updateThought(id, { resolved: !cur.resolved });
    })();
  });

  commandRegistry.register('thought-view.toggle-pinned', (id: unknown) => {
    if (typeof id !== 'string') return;
    void (async () => {
      const cur = await thoughtCap().getThought(id);
      if (!cur) return;
      await thoughtCap().updateThought(id, { pinned: !cur.pinned });
    })();
  });

  // ── 跨 view 命令(Note/eBook 调) ──

  commandRegistry.register('thought-view.add-from-note', () => {
    void addThoughtFromNote();
  });

  commandRegistry.register('thought-view.ask-ai-from-note', () => {
    void askAiFromNote();
  });

  commandRegistry.register('thought-view.scroll-to-source', (thoughtId: unknown) => {
    if (typeof thoughtId !== 'string') return;
    void scrollToSource(thoughtId);
  });
}
