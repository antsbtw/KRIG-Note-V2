/**
 * thought hooks(V1 形态对齐:per-source 过滤)
 *
 * useThoughtsBySource — 按 source/resourceId 过滤(ThoughtView 跟随 left slot 资源时用)
 * useAllThoughts — 全量(暂未消费,留接口对齐 thoughtCapability.onListChanged 广播)
 *
 * V1 形态删 useAllFolders('thought')(无 folder)。
 */

import { useEffect, useState } from 'react';
import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import type {
  ThoughtCapabilityApi,
  ThoughtInfo,
  ThoughtSource,
} from '@capabilities/thought/types';

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

/**
 * 按 source/resourceId 动态过滤(source/resourceId 任一变化重新拉)。
 * source=null 或 resourceId=null 时返空数组(ThoughtView 在 left slot 无资源时显空)。
 */
export function useThoughtsBySource(
  source: ThoughtSource | null,
  resourceId: string | null,
): ThoughtInfo[] {
  const [thoughts, setThoughts] = useState<ThoughtInfo[]>([]);
  useEffect(() => {
    if (!source || !resourceId) {
      setThoughts([]);
      return;
    }
    const t = requireCapabilityApi<ThoughtCapabilityApi>('thought');
    let cancelled = false;
    const refresh = (): void => {
      void t.listThoughtsBySource(source, resourceId).then((list) => {
        if (!cancelled) setThoughts(list);
      });
    };
    refresh();
    // 任何 thought 变化(create/update/delete)都重新拉,确保过滤后的列表最新
    const unsubscribe = t.onListChanged(refresh);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [source, resourceId]);
  return thoughts;
}
