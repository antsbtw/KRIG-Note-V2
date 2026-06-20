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
  useState,
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
  AddModeSpec,
} from '@capabilities/canvas-rendering/types';
import type { CanvasTextNodeApi } from '@capabilities/canvas-text-node';
import type {
  GraphLibraryStoreApi,
  GraphCanvasRecord,
} from '@capabilities/graph-library-store/types';
import { getGraphCanvasWsState } from './data-model';
import { GraphCanvasToolbar } from './GraphCanvasToolbar';
import { GraphCanvasNodeToolbar } from './GraphCanvasNodeToolbar';
import './graph-canvas-view.css';

interface GraphCanvasViewProps {
  workspaceId: string;
  payload?: unknown;
}

const SAVE_DEBOUNCE_MS = 1000; // G3-8=A 对齐 V1

export function GraphCanvasView({ workspaceId }: GraphCanvasViewProps) {
  // FloatingInspector 砍掉 — v1.1+ 走 V1/Freeform 风格"shape 边缘跟随浮条",
  // 替代当前"右上角 Format Shape 浮窗"模式.capability 文件保留作历史参考.
  const { Host, LibraryPicker, CreateSubstanceDialog } = useMemo(
    () => requireCapabilityApi<CanvasRenderingApi>('canvas-rendering'),
    [],
  );
  const library = useMemo(
    () => requireCapabilityApi<GraphLibraryStoreApi>('graph-library-store'),
    [],
  );
  const textNode = useMemo(
    () => requireCapabilityApi<CanvasTextNodeApi>('canvas-text-node'),
    [],
  );
  const TextEditOverlay = textNode.EditOverlay;

  const hostRef = useRef<CanvasHostHandle | null>(null);

  // ── G4.4d UI 浮层状态(view 端拥有 open/anchor;capability 提供组件)──
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerAnchor, setPickerAnchor] = useState<DOMRect | null>(null);
  const [combineDialogOpen, setCombineDialogOpen] = useState(false);

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
  const titleRef = useRef<string>('');
  /** 防抖定时器 */
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** load 竞态保护:快速切画板时丢弃过期的 async 结果 */
  const loadSeqRef = useRef(0);
  /**
   * 已 load 完成的画板 id(防御性 — 避免 record 还没回来时 viewport / instance 推流
   * 触发 save 用空 doc + 默认 title 覆盖磁盘数据).
   * 只有 `loadedIdRef === activeIdRef` 时才允许 flushSave 真正写盘.
   */
  const loadedIdRef = useRef<string | null>(null);

  // ── 实际保存(flush)──
  const flushSave = useCallback((): void => {
    if (saveTimerRef.current !== null) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    const id = activeIdRef.current;
    if (!id) return;
    // 防御:record 还没 load 完时不 save(避免空 doc + 默认 title 擦磁盘真数据)
    if (loadedIdRef.current !== id) return;
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
      loadedIdRef.current = null;
      return;
    }

    // G3-9=A:先 flush 旧 → 再 load 新
    flushSave();
    // 新画板还没 load 完之前,标记未就绪,阻止 scheduleSave 误写
    loadedIdRef.current = null;
    titleRef.current = '';
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
        // load 成功后标记就绪 — 后续 scheduleSave 才允许真正写盘
        loadedIdRef.current = activeGraphId;
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

  // ── G4.5 P4:Host mount 后注入 canvas-text-node atom-bridge,文字节点真渲染 ──
  // 必须在 activeGraphId 改变后(loadDocument 触发 setInstances)再注入,否则首批
  // text 节点会用降级灰矩形.放在 activeGraphId 后的 effect 里,与 load 串行.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    host.setAtomBridge(textNode.atomBridge.atomsToSvgInput as Parameters<CanvasHostHandle['setAtomBridge']>[0]);
    return () => host.setAtomBridge(null);
  }, [textNode, activeGraphId]);

  // ── G4.5 P5:订阅文字编辑态,enter 时关其他浮层(Picker / Combine Dialog) ──
  // FloatingInspector 已砍,留 Picker 互斥(同时打开 Picker 进 addMode + popup 编辑文字
  // 在交互上没意义).
  useEffect(() => {
    return textNode.onEditingChange((editing) => {
      if (editing) {
        setPickerOpen(false);
        setCombineDialogOpen(false);
      }
    });
  }, [textNode]);

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
  const handleSelectionChange = useCallback((ids: string[]): void => {
    setSelectedIds(ids);
  }, []);

  // ── G4.4d UI 浮层 handlers ──
  const handlePickerOpen = useCallback((rect: DOMRect): void => {
    setPickerAnchor(rect);
    setPickerOpen(true);
  }, []);
  const handlePickerPick = useCallback((spec: AddModeSpec): void => {
    hostRef.current?.enterAddMode(spec);
    setPickerOpen(false);
  }, []);
  const handleCombineSubmit = useCallback(
    (result: { name: string; category: string; description: string }): void => {
      const r = hostRef.current?.combineSelected(result);
      setCombineDialogOpen(false);
      if (r) scheduleSave();
    },
    [scheduleSave],
  );

  // ── G4.5 P4 双击节点 → 文字节点进入编辑(其他节点暂忽略) ──
  const handleNodeDoubleClick = useCallback(
    (info: { instanceId: string; screenX: number; screenY: number; screenW: number; screenH: number }): void => {
      const inst = hostRef.current?.getInstance(info.instanceId);
      if (!inst) return;
      if (!textNode.atomBridge.isTextNodeRef(inst.ref)) return;
      textNode.enterEdit({
        instanceId: info.instanceId,
        initialDoc: inst.doc,
        screenX: info.screenX,
        screenY: info.screenY,
        width: info.screenW,
        height: info.screenH,
        backgroundColor: inst.style_overrides?.fill?.color,
        heightFixed: !!inst.size_lock?.h,
        workspaceId,
        viewId: 'graph-canvas-view',
        onExit: (id, newDoc) => {
          if (newDoc !== null) {
            hostRef.current?.updateInstance(id, { doc: newDoc } as Partial<Instance>);
            scheduleSave();
          }
        },
      });
    },
    [textNode, workspaceId, scheduleSave],
  );

  return (
    <div className="krig-graph-canvas-view">
      <GraphCanvasToolbar
        activeGraphId={activeGraphId}
        hostRef={hostRef}
        selectedCount={selectedIds.length}
        onAddClick={handlePickerOpen}
        onCombineClick={() => setCombineDialogOpen(true)}
      />
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
            onSelectionChange={handleSelectionChange}
            onNodeDoubleClick={handleNodeDoubleClick}
          />
        )}
        {/* G5 节点浮条(单选时贴选中框下方;view-agnostic node-toolbar capability) */}
        {activeGraphId != null && (
          <GraphCanvasNodeToolbar
            hostRef={hostRef}
            selectedIds={selectedIds}
            onChanged={scheduleSave}
          />
        )}
      </div>

      {/* G4.5 文字节点编辑浮层(挂在画板顶层,session-store 驱动渲染) */}
      <TextEditOverlay />

      {/* UI 浮层(画板内浮层归 capability,view 控 open/anchor) */}
      <LibraryPicker
        open={pickerOpen}
        anchorRect={pickerAnchor}
        onPick={handlePickerPick}
        onClose={() => setPickerOpen(false)}
      />
      <CreateSubstanceDialog
        open={combineDialogOpen}
        onCreate={handleCombineSubmit}
        onCancel={() => setCombineDialogOpen(false)}
      />
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
    user_substances: Array.isArray(r.user_substances)
      ? (r.user_substances as CanvasDocument['user_substances'])
      : undefined,
  };
}
