/**
 * GraphCanvasToolbar — view 顶部 toolbar(L5-G1 占位)
 *
 * G1 范围:仅显示当前打开的画板标题(从 graph-library-store 拉)。完整功能
 * (导航 / + 添加 / 缩放 / Open / SlotToggle / Combine 临时按钮)留 G4 + G5 段。
 *
 * G5 时,toolbar 内容会从 view 内组件改注册到 toolbarRegistry,本组件可能
 * 整体被替换;现在保留是为了"占位 + 调试"。
 */

import { useEffect, useMemo, useState } from 'react';
import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import type {
  GraphLibraryStoreApi,
  GraphCanvasListItem,
} from '@capabilities/graph-library-store/types';

interface GraphCanvasToolbarProps {
  activeGraphId: string | null;
}

export function GraphCanvasToolbar({
  activeGraphId,
}: GraphCanvasToolbarProps) {
  const library = useMemo(
    () => requireCapabilityApi<GraphLibraryStoreApi>('graph-library-store'),
    [],
  );

  const [title, setTitle] = useState<string>('');

  // 订阅当前画板 title — list 变化时刷新(对齐 ebook 模式)
  useEffect(() => {
    if (activeGraphId == null) {
      setTitle('');
      return;
    }
    let cancelled = false;
    const refresh = (): void => {
      void library
        .list()
        .then((list: GraphCanvasListItem[]) => {
          if (cancelled) return;
          const entry = list.find((e) => e.id === activeGraphId);
          setTitle(entry?.title ?? '');
        })
        .catch(() => {});
    };
    refresh();
    const off = library.onGraphListChanged(() => refresh());
    return () => {
      cancelled = true;
      off();
    };
  }, [activeGraphId, library]);

  return (
    <div className="krig-graph-canvas-toolbar">
      <div className="krig-graph-canvas-toolbar__title">
        {activeGraphId == null ? '画板' : title || 'Untitled Canvas'}
      </div>
      <div className="krig-graph-canvas-toolbar__placeholder-note">
        G1 占位 — 完整 toolbar 留 G5
      </div>
    </div>
  );
}
