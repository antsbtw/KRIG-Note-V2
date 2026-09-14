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
  useCallback,
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
import { GraphCanvasZoomControl } from './GraphCanvasZoomControl';

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
  /** 导图:被钉住的节点数(0 时按钮置灰 —— 别让用户点空)。 */
  mindPinnedCount?: number;
  /** 导图:恢复自动布局(清空全部 pos)。 */
  onMindReleaseAll?: () => void;
  /** 选区数(G4.4d):0 隐 Combine,1+ 显;Combine 仅 ≥2 才可点 */
  selectedCount: number;
  /** "+添加"按钮点击 — view 端打开 LibraryPicker(传 anchorRect) */
  onAddClick: (rect: DOMRect) => void;
  /** Combine 按钮点击 — view 端打开 CreateSubstanceDialog */
  onCombineClick: () => void;
  /**
   * 订阅视口变化(滚轮 / pinch / 快捷键缩放时通知 toolbar 刷新百分比).
   * ⚠️ 必须返回退订函数.
   */
  subscribeViewport: (onChange: () => void) => () => void;
}

export function GraphCanvasToolbar({
  activeGraphId,
  hostRef,
  isMind = false,
  mindPinnedCount = 0,
  onMindReleaseAll,
  selectedCount,
  onAddClick,
  onCombineClick,
  subscribeViewport,
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

  // ── 缩放控件的宿主适配(⭐ 控件本身不认识 hostRef,只认这三个函数)──
  const getZoom = useCallback(
    (): number | null => hostRef.current?.getViewport()?.zoom ?? null,
    [hostRef],
  );
  const zoomTo = useCallback(
    (percent: number): void => hostRef.current?.zoomTo(percent),
    [hostRef],
  );
  const zoomFit = useCallback(
    (): boolean => hostRef.current?.fitToContent() ?? false,
    [hostRef],
  );

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
        {/* ⭐ 导图专属:恢复自动布局(Alt+拖自由摆位的必要配套,01 §7.5) */}
        {activeGraphId != null && isMind && (
          <button
            type="button"
            className="krig-graph-canvas-toolbar__btn"
            onClick={onMindReleaseAll}
            disabled={mindPinnedCount === 0}
            title={
              mindPinnedCount === 0
                ? '没有被钉住的节点(全部已是自动布局)'
                : `恢复自动布局:释放 ${mindPinnedCount} 个被钉住的节点`
            }
          >
            ⟲ 恢复自动布局{mindPinnedCount > 0 ? ` (${mindPinnedCount})` : ''}
          </button>
        )}
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
            {/*
              ⭐ 缩放控件。⚠️ 只在画板显示 —— 导图走 MindCanvas 自己的 Host,
              本组件的 hostRef 在导图下**恒为 null**(见上方 isMind 注释),
              挂上去会是「显示不动、点了没反应」的死控件。
              导图侧的接线是下一轮的事(控件本身已按可继承的形态写:
              只依赖 getZoom / zoomTo / fitToContent / subscribe)。
            */}
            <GraphCanvasZoomControl
              getZoom={getZoom}
              zoomTo={zoomTo}
              fitToContent={zoomFit}
              subscribe={subscribeViewport}
            />
          </>
        )}
      </div>
    </div>
  );
}
