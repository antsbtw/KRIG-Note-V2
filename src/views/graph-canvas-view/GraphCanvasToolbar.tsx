/**
 * GraphCanvasToolbar — view 顶部 toolbar(L5-G3 升级)
 *
 * G1 占位 → G3 加最小可用工具:
 * - 当前画板标题(订阅 onGraphListChanged 刷新)
 * - Fit-to-content 按钮(调 hostRef.fitToContent)
 * - 缩放显示(占位级,完整 toolbar 留 G5 注册到 toolbarRegistry)
 *
 * G5 时,toolbar 内容会从 view 内组件改注册到 toolbarRegistry,本组件整体替换.
 */

import {
  type MutableRefObject,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import type {
  GraphLibraryStoreApi,
  GraphCanvasListItem,
} from '@capabilities/graph-library-store/types';
import type { CanvasHostHandle } from '@capabilities/canvas-rendering/types';

interface GraphCanvasToolbarProps {
  activeGraphId: string | null;
  /** Host ref(G3 加 — Fit-to-content 等命令调用入口) */
  hostRef: MutableRefObject<CanvasHostHandle | null>;
}

export function GraphCanvasToolbar({
  activeGraphId,
  hostRef,
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

  const handleFit = (): void => {
    hostRef.current?.fitToContent();
  };

  return (
    <div className="krig-graph-canvas-toolbar">
      <div className="krig-graph-canvas-toolbar__title">
        {activeGraphId == null ? '画板' : title || 'Untitled Canvas'}
      </div>
      <div className="krig-graph-canvas-toolbar__actions">
        {activeGraphId != null && (
          <button
            type="button"
            className="krig-graph-canvas-toolbar__btn"
            onClick={handleFit}
            title="适应内容(↔)"
          >
            ↔ Fit
          </button>
        )}
      </div>
      <div className="krig-graph-canvas-toolbar__placeholder-note">
        G3 占位 toolbar — 完整工具栏留 G5
      </div>
    </div>
  );
}
