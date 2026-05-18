/**
 * useAllThoughts / useAllFolders('thought') hook(对齐 views/note/use-notes-folders.ts)
 *
 * W5 严格态:走 requireCapabilityApi(id) 间接路由(charter §5.4)。
 */

import { useEffect, useState } from 'react';
import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import type { ThoughtCapabilityApi, ThoughtInfo } from '@capabilities/thought/types';
import type { FolderCapabilityApi, FolderInfo } from '@capabilities/folder/types';

export function useAllThoughts(): ThoughtInfo[] {
  const [thoughts, setThoughts] = useState<ThoughtInfo[]>([]);
  useEffect(() => {
    const t = requireCapabilityApi<ThoughtCapabilityApi>('thought');
    let cancelled = false;
    void t.listThoughts().then((list) => {
      if (!cancelled) setThoughts(list);
    });
    const unsubscribe = t.onListChanged((list) => {
      if (!cancelled) setThoughts(list);
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);
  return thoughts;
}

export function useAllThoughtFolders(): FolderInfo[] {
  const [folders, setFolders] = useState<FolderInfo[]>([]);
  useEffect(() => {
    const folder = requireCapabilityApi<FolderCapabilityApi>('folder');
    let cancelled = false;
    void folder.listFolders('thought').then((list) => {
      if (!cancelled) setFolders(list);
    });
    const unsubscribe = folder.onListChanged(() => {
      void folder.listFolders('thought').then((list) => {
        if (!cancelled) setFolders(list);
      });
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);
  return folders;
}
