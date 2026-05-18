/**
 * thought-commands 共用工具
 */

import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import type { ThoughtCapabilityApi, ThoughtType } from '@capabilities/thought/types';
import type { NoteDocEnvelope } from '@shared/ipc/note-folder-types';

export function thoughtCap(): ThoughtCapabilityApi {
  return requireCapabilityApi<ThoughtCapabilityApi>('thought');
}

export function emptyDoc(): NoteDocEnvelope {
  return {
    format: 'pm-doc-json',
    version: '0.1',
    payload: { type: 'doc', content: [{ type: 'paragraph' }] },
  };
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
