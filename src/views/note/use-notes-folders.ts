/**
 * useAllNotes / useAllFolders — view 层订阅 hook (decision 012 §3.5 设计师批复)
 *
 * 把"初始 fetch + onListChanged 订阅"模式封装为 React hook,避免每个 view 组件
 * 重复造轮子 (NavSide / LinkPanel / NoteLinkSearch / NoteView 共用)。
 *
 * 模式 (与 V2 ebook-library 等 capability 同构):
 *   const notes = useAllNotes();
 *   const folders = useAllFolders();
 *
 * 首次渲染拿到 [],await IPC 后 setState 触发重渲;后续靠 onListChanged 增量推送。
 *
 * W5 严格态:走 requireCapabilityApi(id) 间接路由 (charter § 5.4)。
 */

import { useEffect, useState } from 'react';
import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import type { NoteCapabilityApi, NoteInfo } from '@capabilities/note/types';
import type {
  FolderCapabilityApi,
  FolderInfo,
  FolderViewType,
} from '@capabilities/folder/types';

export function useAllNotes(): NoteInfo[] {
  const [notes, setNotes] = useState<NoteInfo[]>([]);
  useEffect(() => {
    const note = requireCapabilityApi<NoteCapabilityApi>('note');
    let cancelled = false;
    void note.listNotes().then((list) => {
      if (!cancelled) setNotes(list);
    });
    const unsubscribe = note.onListChanged((list) => {
      if (!cancelled) setNotes(list);
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);
  return notes;
}

/**
 * decision 021 §10.B-2 偏离:useAllFolders 加 viewType 入参 (broadcast 设计盲点 + hook 签名扩).
 *
 * 方案 C 实施:onListChanged callback 字面不动 (FolderInfo[] 入参),
 * 但 hook 内 callback 收到任一 view 广播都重新调 listFolders(viewType) 拉自己 view 的 folder,
 * 避免对端 view 的广播污染本 view 状态.
 */
export function useAllFolders(viewType: FolderViewType): FolderInfo[] {
  const [folders, setFolders] = useState<FolderInfo[]>([]);
  useEffect(() => {
    const folder = requireCapabilityApi<FolderCapabilityApi>('folder');
    let cancelled = false;
    void folder.listFolders(viewType).then((list) => {
      if (!cancelled) setFolders(list);
    });
    const unsubscribe = folder.onListChanged(() => {
      void folder.listFolders(viewType).then((list) => {
        if (!cancelled) setFolders(list);
      });
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [viewType]);
  return folders;
}
