/**
 * useActiveNoteDocSync — NoteView 订阅同 noteId 的外部 doc 更新
 *
 * 职责单一:把 NOTE_DOC_CONTENT_CHANGED 广播翻译成"对当前打开的 note 触发回调"。
 *
 * 设计:
 * - 只关心当前 activeNoteId 的更新;其他 note 的广播忽略
 * - 不直接订阅 IPC,通过 noteCapability hook 间接路由(W5 严格态)
 * - origin='note-editor' + emitterId=本 renderer 的广播在 main 侧已被排除,
 *   本 hook 无需再过滤
 *
 * 关联:[[project-noteview-cursor-jump-fix]] + dual-channel-implementation.md §1.4
 */

import { useEffect } from 'react';
import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import type {
  NoteCapabilityApi,
  NoteDocEnvelope,
  NoteDocOrigin,
} from '@capabilities/note/types';

export function useActiveNoteDocSync(
  activeNoteId: string | null,
  onExternalChange: (doc: NoteDocEnvelope, origin: NoteDocOrigin) => void,
): void {
  useEffect(() => {
    if (!activeNoteId) return;
    const note = requireCapabilityApi<NoteCapabilityApi>('note');
    return note.onDocContentChanged((payload) => {
      if (payload.noteId !== activeNoteId) return;
      onExternalChange(payload.doc, payload.origin);
    });
  }, [activeNoteId, onExternalChange]);
}
