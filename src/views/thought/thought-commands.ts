/**
 * ThoughtView 命令注册(对齐 views/note/note-commands.ts 签名:register(id, handler))
 *
 * 业务命令(Phase 2):
 *   create-thought / set-active / delete-active / delete-by-tree-id
 *   create-folder / change-type / toggle-resolve / toggle-pinned
 *
 * Phase 3 增:add-from-note(跨 view 调,Note ⌘⇧M)
 * Phase 4 增:add-from-book(跨 view 调,ebook 高亮)
 */

import { commandRegistry } from '@slot/command-registry/command-registry';
import { workspaceManager } from '@workspace/workspace-state/workspace-manager';
import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import type {
  ThoughtCapabilityApi,
  ThoughtType,
} from '@capabilities/thought/types';
import type { FolderCapabilityApi } from '@capabilities/folder/types';
import type { NoteDocEnvelope } from '@shared/ipc/note-folder-types';
import { setActiveThought, setFolderExpanded, getThoughtWsState } from './data-model';
import { decodeTreeId } from './tree-builder';

function thoughtCap(): ThoughtCapabilityApi {
  return requireCapabilityApi<ThoughtCapabilityApi>('thought');
}
function folderCap(): FolderCapabilityApi {
  return requireCapabilityApi<FolderCapabilityApi>('folder');
}

function emptyDoc(): NoteDocEnvelope {
  return {
    format: 'pm-doc-json',
    version: '0.1',
    payload: { type: 'doc', content: [{ type: 'paragraph' }] },
  };
}

function ensureThoughtViewActive(wsId: string): void {
  const ws = workspaceManager.get(wsId);
  if (!ws) return;
  if (ws.slotBinding.left === 'thought-view') return;
  workspaceManager.update(wsId, {
    slotBinding: { ...ws.slotBinding, left: 'thought-view' },
  });
}

function nextAvailableFolderName(base: string, existingTitles: string[]): string {
  const taken = new Set(existingTitles);
  if (!taken.has(base)) return base;
  for (let n = 2; n < 10000; n++) {
    const candidate = `${base} ${n}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base} ${Date.now()}`;
}

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

  /** arg = { id, type } */
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
}
