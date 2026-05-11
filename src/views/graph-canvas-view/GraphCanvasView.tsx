/**
 * GraphCanvasView — view 主组件(L5-G3)
 *
 * G3 升级(从 G1 占位 → 接 Host ref):
 * - 通过 requireCapabilityApi('canvas-rendering') 拿 Host(W5 强制)
 * - 启动恢复:activeGraphId 变化 → library.load(id) → hostRef.loadDocument(doc)
 * - 切画板:旧画板 flushSave → 新画板 load(对齐 V1 onGraphOpenInView)
 * - 防抖保存:onInstancesChange / onViewportChange → 1s 防抖 → library.save
 *   (G3-8=A 对齐 V1)
 * - viewport 持久化:挂 doc_content.view(G3-7=A 对齐 V1 schema_version=2)
 *
 * **容器始终 mount**(memory feedback_canvas_container_must_always_render):
 * Host 内部决定空状态显示(activeGraphId == null 时 Host 卸载也无所谓 —
 * 用 conditional 不切 host 容器)— 但本 view 用 conditional render Host
 * 也安全,因为 Host 内部 ref 容器是 Host 自己的 <div>,view 切 activeGraphId
 * 时本 view 容器 div 始终 mount,只切内层 Host vs 空提示.
 *
 * LOC 红线(v0.2 plan + G3-13=A):≤ 150~200 行.本组件 ~170 行接近上限.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from 'react';
import { workspaceManager } from '@workspace/workspace-state/workspace-manager';
import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import type {
  CanvasRenderingApi,
  CanvasHostHandle,
  CanvasDocument,
  Viewport,
  Instance,
} from '@capabilities/canvas-rendering/types';
import type {
  GraphLibraryStoreApi,
  GraphCanvasRecord,
} from '@capabilities/graph-library-store/types';
import { getGraphCanvasWsState } from './data-model';
import { GraphCanvasToolbar } from './GraphCanvasToolbar';
import './graph-canvas-view.css';

interface GraphCanvasViewProps {
  workspaceId: string;
  payload?: unknown;
}

const SAVE_DEBOUNCE_MS = 1000; // G3-8=A 对齐 V1

export function GraphCanvasView({ workspaceId }: GraphCanvasViewProps) {
  const { Host } = useMemo(
    () => requireCapabilityApi<CanvasRenderingApi>('canvas-rendering'),
    [],
  );
  const library = useMemo(
    () => requireCapabilityApi<GraphLibraryStoreApi>('graph-library-store'),
    [],
  );

  const hostRef = useRef<CanvasHostHandle | null>(null);

  // ── per-ws state 订阅 ──
  const wsState = useSyncExternalStore(
    (cb) => workspaceManager.subscribe(cb),
    () => {
      const ws = workspaceManager.get(workspaceId);
      return ws ? getGraphCanvasWsState(ws) : null;
    },
  );
  const activeGraphId = wsState?.activeGraphId ?? null;

  // ── 持久化 refs(防 closure 过期)──
  /** 当前活跃画板 id 的 ref(防抖到点时 closure 读最新) */
  const activeIdRef = useRef<string | null>(null);
  /** 当前画板 title 的 ref(serialize 不带 title,save 需要 title 一并写入) */
  const titleRef = useRef<string>('Untitled Canvas');
  /** 防抖定时器 */
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** load 竞态保护:快速切画板时丢弃过期的 async 结果 */
  const loadSeqRef = useRef(0);

  // ── 实际保存(flush)──
  const flushSave = useCallback((): void => {
    if (saveTimerRef.current !== null) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    const id = activeIdRef.current;
    if (!id) return;
    const host = hostRef.current;
    if (!host) return;
    const doc = host.serialize();
    void library.save(id, doc, titleRef.current);
  }, [library]);

  /** 1s 防抖触发 save */
  const scheduleSave = useCallback((): void => {
    if (saveTimerRef.current !== null) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null;
      flushSave();
    }, SAVE_DEBOUNCE_MS);
  }, [flushSave]);

  // ── 切画板 / 启动恢复 ──
  useEffect(() => {
    activeIdRef.current = activeGraphId;
    const host = hostRef.current;
    if (!host) return;

    if (!activeGraphId) {
      // 切到"无画板":先 flush 旧的(若有挂起的防抖)
      flushSave();
      // Host 已渲染但容器空,清掉残留 — 加载空 document
      host.loadDocument(emptyDocument());
      titleRef.current = '';
      return;
    }

    // G3-9=A:先 flush 旧 → 再 load 新
    flushSave();
    const seq = ++loadSeqRef.current;
    void library
      .load(activeGraphId)
      .then((record: GraphCanvasRecord | null) => {
        // 竞态保护:快速切换时丢弃过期结果
        if (seq !== loadSeqRef.current) return;
        if (!record) return;
        titleRef.current = record.title;
        const doc = sanitizeDocument(record.doc_content);
        host.loadDocument(doc);
      })
      .catch((err) => {
        console.warn('[graph-canvas-view] load failed:', err);
      });
    // flushSave / library 引用稳定,故意只依赖 activeGraphId
  }, [activeGraphId]);

  // ── 订阅 onGraphListChanged 拿最新 title(rename 时同步标题用)──
  useEffect(() => {
    const off = library.onGraphListChanged((list) => {
      const id = activeIdRef.current;
      if (!id) return;
      const entry = list.find((e) => e.id === id);
      if (entry) titleRef.current = entry.title;
    });
    return off;
  }, [library]);

  // ── unmount 时 flush(避免数据丢失)──
  useEffect(() => {
    return () => flushSave();
  }, [flushSave]);

  // ── Host 回调 ──
  const handleInstancesChange = useCallback(
    (_instances: Instance[]): void => {
      scheduleSave();
    },
    [scheduleSave],
  );
  const handleViewportChange = useCallback(
    (_vp: Viewport): void => {
      scheduleSave();
    },
    [scheduleSave],
  );

  return (
    <div className="krig-graph-canvas-view">
      <GraphCanvasToolbar activeGraphId={activeGraphId} hostRef={hostRef} />
      <div className="krig-graph-canvas-view__body">
        {activeGraphId == null ? (
          <div className="krig-graph-canvas-view__empty">
            <div className="krig-graph-canvas-view__empty-title">
              🎨 还没有打开画板
            </div>
            <div className="krig-graph-canvas-view__empty-hint">
              在左侧选择已有画板,或点 NavSide 「+ 画板」新建
            </div>
          </div>
        ) : (
          <Host
            ref={hostRef}
            workspaceId={workspaceId}
            onInstancesChange={handleInstancesChange}
            onViewportChange={handleViewportChange}
          />
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// helpers
// ─────────────────────────────────────────────────────────

function emptyDocument(): CanvasDocument {
  return {
    schema_version: 3,
    view: { centerX: 0, centerY: 0, zoom: 1 },
    instances: [],
  };
}

/**
 * graph-library-store IPC 边界用 CanvasDocumentJson = unknown 透传;
 * view 这里做最小 sanitize 把 unknown 转成 CanvasDocument 形态.
 *
 * 兼容 V1 schema_version=1/2/3:
 * - v1: viewBox{x,y,w,h} → v2/v3 view{centerX,centerY,zoom}(简单兜底:中心 0,0
 *   zoom=1,viewport 持久化下一次保存时归一)
 * - v2/v3: 直接透传
 */
function sanitizeDocument(raw: unknown): CanvasDocument {
  if (!raw || typeof raw !== 'object') return emptyDocument();
  const r = raw as Record<string, unknown>;
  const instances = Array.isArray(r.instances) ? (r.instances as Instance[]) : [];
  const view = r.view as Viewport | undefined;
  return {
    schema_version: typeof r.schema_version === 'number' ? r.schema_version : 3,
    view:
      view &&
      typeof view.centerX === 'number' &&
      typeof view.centerY === 'number' &&
      typeof view.zoom === 'number'
        ? view
        : { centerX: 0, centerY: 0, zoom: 1 },
    instances,
    user_substances: Array.isArray(r.user_substances) ? r.user_substances : undefined,
  };
}
