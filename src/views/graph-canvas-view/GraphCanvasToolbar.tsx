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
  useRef,
  useState,
} from 'react';
import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import type {
  GraphLibraryStoreApi,
} from '@capabilities/graph-library-store/types';
import type { CanvasHostHandle } from '@capabilities/canvas-rendering/types';

interface GraphCanvasToolbarProps {
  activeGraphId: string | null;
  /** Host ref(G3 加 — Fit-to-content 等命令调用入口) */
  hostRef: MutableRefObject<CanvasHostHandle | null>;
  /**
   * ⭐ 当前是否为导图(B1)。
   * ⚠️ 导图由 MindCanvas 自己的 Host 渲染,本组件的 hostRef **恒为 null** ——
   * 画板专属按钮(添加/Fit/Combine)打过去是**静默无效**,故隐藏而非留着骗人。
   */
  isMind?: boolean;
  /** 选区数(G4.4d):0 隐 Combine,1+ 显;Combine 仅 ≥2 才可点 */
  selectedCount: number;
  /** "+添加"按钮点击 — view 端打开 LibraryPicker(传 anchorRect) */
  onAddClick: (rect: DOMRect) => void;
  /** Combine 按钮点击 — view 端打开 CreateSubstanceDialog */
  onCombineClick: () => void;
}

export function GraphCanvasToolbar({
  activeGraphId,
  hostRef,
  isMind = false,
  selectedCount,
  onAddClick,
  onCombineClick,
}: GraphCanvasToolbarProps) {
  const addBtnRef = useRef<HTMLButtonElement>(null);
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
    // ⭐ B1:标题可能来自两张表 —— 画板在 graph_canvas,导图在 mind_doc。
    //    只查画板表的话,打开导图时标题会退成空(真机实测:显示 'Untitled Canvas')。
    const refresh = (): void => {
      void Promise.all([library.list(), library.mindList()])
        .then(([canvasList, mindList]) => {
          if (cancelled) return;
          const hit =
            canvasList.find((e) => e.id === activeGraphId) ??
            mindList.find((e) => e.id === activeGraphId);
          setTitle(hit?.title ?? '');
        })
        .catch(() => {});
    };
    refresh();
    // ⚠️ 两个推流都要订阅,否则改了名标题不刷新
    const offGraph = library.onGraphListChanged(() => refresh());
    const offMind = library.onMindListChanged(() => refresh());
    return () => {
      cancelled = true;
      offGraph();
      offMind();
    };
  }, [activeGraphId, library]);

  const handleFit = (): void => {
    hostRef.current?.fitToContent();
  };

  const handleAdd = (): void => {
    const rect = addBtnRef.current?.getBoundingClientRect();
    if (rect) onAddClick(rect);
  };

  return (
    <div className="krig-graph-canvas-toolbar">
      <div className="krig-graph-canvas-toolbar__title">
        {activeGraphId == null ? '画板' : title || (isMind ? '未命名导图' : 'Untitled Canvas')}
      </div>
      <div className="krig-graph-canvas-toolbar__actions">
        {activeGraphId != null && !isMind && (
          <>
            <button
              ref={addBtnRef}
              type="button"
              className="krig-graph-canvas-toolbar__btn"
              onClick={handleAdd}
              title="添加 shape / substance"
            >
              + 添加
            </button>
            <button
              type="button"
              className="krig-graph-canvas-toolbar__btn"
              onClick={handleFit}
              title="适应内容(↔)"
            >
              ↔ Fit
            </button>
            {selectedCount >= 2 && (
              <button
                type="button"
                className="krig-graph-canvas-toolbar__btn"
                onClick={onCombineClick}
                title="Combine to Substance(多选)"
              >
                ⊟ Combine
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
