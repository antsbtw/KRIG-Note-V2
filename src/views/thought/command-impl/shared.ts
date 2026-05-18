/**
 * thought-commands 共用工具(Phase 5 拆分自 thought-commands.ts)
 *
 * thought-view-port.md v0.5 §5.7 + §15.2 charter §1.4 体量审计:
 *   thought-commands.ts 468 行 → 仅留命令注册 + 表层 dispatch;业务实现拆 command-impl/。
 */

import { workspaceManager } from '@workspace/workspace-state/workspace-manager';
import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import type { ThoughtCapabilityApi, ThoughtType } from '@capabilities/thought/types';
import type { FolderCapabilityApi } from '@capabilities/folder/types';
import type { NoteDocEnvelope } from '@shared/ipc/note-folder-types';

export function thoughtCap(): ThoughtCapabilityApi {
  return requireCapabilityApi<ThoughtCapabilityApi>('thought');
}

export function folderCap(): FolderCapabilityApi {
  return requireCapabilityApi<FolderCapabilityApi>('folder');
}

export function emptyDoc(): NoteDocEnvelope {
  return {
    format: 'pm-doc-json',
    version: '0.1',
    payload: { type: 'doc', content: [{ type: 'paragraph' }] },
  };
}

export function ensureThoughtViewActive(wsId: string): void {
  const ws = workspaceManager.get(wsId);
  if (!ws) return;
  if (ws.slotBinding.left === 'thought-view') return;
  workspaceManager.update(wsId, {
    slotBinding: { ...ws.slotBinding, left: 'thought-view' },
  });
}

/** 同父级同名兜底(对齐 note/data-model.ts:nextAvailableFolderName) */
export function nextAvailableFolderName(
  base: string,
  existingTitles: string[],
): string {
  const taken = new Set(existingTitles);
  if (!taken.has(base)) return base;
  for (let n = 2; n < 10000; n++) {
    const candidate = `${base} ${n}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base} ${Date.now()}`;
}

/**
 * 先建 placeholder thought(unanchored,后续 updateAnchor 补)
 * — anchor=null 单步原子建 atom 拿 id 给 anchor 写 mark/frame/node attr 用。
 */
export async function preCreatePlaceholder(
  type: ThoughtType = 'thought',
  serviceId?: string,
): Promise<string | null> {
  try {
    const t = await thoughtCap().createThought({
      type,
      resolved: false,
      pinned: false,
      serviceId,
      doc: emptyDoc(),
      folderId: null,
      anchor: null,
    });
    return t.id;
  } catch (e) {
    console.warn('[thought-view] preCreatePlaceholder failed:', e);
    return null;
  }
}
