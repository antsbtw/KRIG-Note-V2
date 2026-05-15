/**
 * useNoteList — capability 端公共 hook,订阅 NoteCapabilityApi 笔记列表
 *
 * 为 LinkPanel(C4)/ NoteLinkSearchPanel(C6)/ 未来 thought-view 共用提供单一来源。
 *
 * N-1 合规:同一订阅逻辑一份实现(原 LinkPanel 内联版 C6 改 import 本 hook)
 * N-2 合规:不依赖 @views/note/use-notes-folders;走 capability API 直连
 *
 * 形态与原 view-layer useAllNotes 一致:
 * - 首次 listNotes() 拿到 [] → setState 触发重渲
 * - 后续靠 onListChanged 增量推送
 */

import { useEffect, useState } from 'react';
import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import type { NoteCapabilityApi, NoteInfo } from '@capabilities/note/types';

export function useNoteList(): NoteInfo[] {
  const [notes, setNotes] = useState<NoteInfo[]>([]);
  useEffect(() => {
    const noteCap = requireCapabilityApi<NoteCapabilityApi>('note');
    let cancelled = false;
    void noteCap.listNotes().then((list) => {
      if (!cancelled) setNotes(list);
    });
    const unsubscribe = noteCap.onListChanged((list) => {
      if (!cancelled) setNotes(list);
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);
  return notes;
}
