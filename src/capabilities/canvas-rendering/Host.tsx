/**
 * CanvasHost — canvas-rendering capability 主组件(L5-G3)
 *
 * forwardRef + 命令式 API:view 通过 ref 调用 loadDocument / serialize / setViewport
 * / fitToContent / zoomTo / deleteSelected / clearSelection 等.
 * 内部装 SceneManager(Three.js 底座)+ NodeRenderer(instance → mesh)+ DotGrid
 * (网格底)+ InteractionController(鼠标 / 键盘交互);view 不直 import three.
 *
 * 数据通路:
 *   view 通过 ref.loadDocument(doc) → Host 内 SceneManager.setView + NodeRenderer.setInstances
 *   InteractionController 鼠标拖动 → NodeRenderer.setPosition → mouseup 推 onInstancesChange
 *   pan / zoom → onViewportChange
 *
 * view 端只感知 props/callbacks/ref,不感知 three 的存在(P1-1 严格版屏障核心).
 *
 * 见 docs/RefactorV2/stages/L5G3-canvas-rendering-design.md v0.3 § 1.1.
 */

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
} from 'react';
import type {
  AddModeSpec,
  CanvasDocument,
  CanvasHostHandle,
  CanvasHostProps,
  Instance,
  Viewport,
} from './types';
import { SceneManager } from './scene/SceneManager';
import { NodeRenderer } from './scene/NodeRenderer';
import { HandlesOverlay } from './scene/HandlesOverlay';
import { InteractionController } from './interaction/InteractionController';
import { combineSelectedToSubstance } from './combine';
import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import type { ShapeLibraryApi, SubstanceDef } from '@capabilities/shape-library/types';
import './styles.css';

export const CanvasHost = forwardRef<CanvasHostHandle, CanvasHostProps>(
  function CanvasHost(props, ref) {
    const { onViewportChange, onSelectionChange, onInstancesChange, onAddModeChange, onNodeDoubleClick } = props;
    const containerRef = useRef<HTMLDivElement>(null);
    const sceneRef = useRef<SceneManager | null>(null);
    const nodeRendererRef = useRef<NodeRenderer | null>(null);
    const handlesRef = useRef<HandlesOverlay | null>(null);
    const interactionRef = useRef<InteractionController | null>(null);
    /** 防抖 / 节流 onViewportChange — RAF 内多次调用合并 */
    const viewportDirtyRef = useRef(false);

    // ── 装配:容器始终 mount(memory feedback_canvas_container_must_always_render)──

    useEffect(() => {
      const container = containerRef.current;
      if (!container) return;

      const scene = new SceneManager(container);
      const nodeRenderer = new NodeRenderer(scene);
      const handles = new HandlesOverlay(scene);
      // size_lock 反查给 HandlesOverlay(文字节点 size_lock 维度隐藏对应 handle)
      handles.setInstanceLookup((id) => {
        const inst = nodeRenderer.getInstance(id);
        return inst?.size_lock ? { size_lock: inst.size_lock } : undefined;
      });
      const interaction = new InteractionController({
        container,
        sceneManager: scene,
        nodeRenderer,
        handlesOverlay: handles,
        getInstance: (id) => nodeRenderer.getInstance(id),
        onSelectionChange: (ids) => onSelectionChange?.(ids),
        onInstancesChange: () => onInstancesChange?.(nodeRenderer.listInstances()),
        onViewportChange: () => {
          viewportDirtyRef.current = true;
        },
        onAddModeChange: (spec) => onAddModeChange?.(spec),
        onNodeDoubleClick: (info) => onNodeDoubleClick?.(info),
      });
      sceneRef.current = scene;
      nodeRendererRef.current = nodeRenderer;
      handlesRef.current = handles;
      interactionRef.current = interaction;

      // [G4.3 dev hook] 暴露给 DevTools 手测 enterAddMode(picker 还没接,G4.4 才有)
      if (import.meta.env.DEV) {
        const w = window as unknown as { __krig?: Record<string, unknown> };
        w.__krig = { ...(w.__krig ?? {}), canvasInteraction: interaction };
      }

      // viewport change 推送(RAF 内节流,避免每次 wheel 都触发持久化保存)
      let rafId: number | null = null;
      const tickViewport = (): void => {
        if (viewportDirtyRef.current) {
          viewportDirtyRef.current = false;
          const v = scene.getView();
          onViewportChange?.({ centerX: v.centerX, centerY: v.centerY, zoom: v.zoom });
        }
        rafId = requestAnimationFrame(tickViewport);
      };
      rafId = requestAnimationFrame(tickViewport);

      return () => {
        if (rafId !== null) cancelAnimationFrame(rafId);
        interaction.dispose();
        handles.dispose();
        nodeRenderer.clear();
        scene.dispose();
        sceneRef.current = null;
        nodeRendererRef.current = null;
        handlesRef.current = null;
        interactionRef.current = null;
      };
    // onViewportChange / onSelectionChange / onInstancesChange 故意不放入 deps —
    // 这些是 view 端 callback,可能每次 render 都换引用;真正捕获在闭包中(view
    // 一般使用 useCallback 稳定),我们只在 mount 时绑一次,unmount 时清.若 view
    // 端真要换 callback,unmount/remount Host 即可.
    }, []);

    // ── 命令式 API ──

    const loadDocument = useCallback((doc: CanvasDocument): void => {
      const scene = sceneRef.current;
      const renderer = nodeRendererRef.current;
      if (!scene || !renderer) return;
      // 1) **先**注册 user_substances 到 SubstanceRegistry,renderer.setInstances
      //    在 G4.5 user_substances 修复;否则 substance 实例 ref 查不到 def 不渲染
      //    (V1 deserialize.ts:101-107 直迁顺序)
      if (Array.isArray(doc.user_substances) && doc.user_substances.length > 0) {
        try {
          const api = requireCapabilityApi<ShapeLibraryApi>('shape-library');
          for (const def of doc.user_substances) {
            if (!def?.id || !Array.isArray(def.components)) continue;
            // 已注册的跳过(防 register 报"already registered")
            if (api.substances.get(def.id)) continue;
            api.substances.register(def);
          }
        } catch (e) {
          console.warn('[canvas-rendering/Host] user_substances register failed', e);
        }
      }
      // 2) 视口
      if (doc.view) {
        scene.setView(doc.view.centerX, doc.view.centerY, doc.view.zoom);
      }
      // 3) 节点
      renderer.setInstances(doc.instances ?? []);
    }, []);

    const serialize = useCallback((): CanvasDocument => {
      const scene = sceneRef.current;
      const renderer = nodeRendererRef.current;
      if (!scene || !renderer) {
        // 兜底:返回最小可序列化结构
        return {
          schema_version: 3,
          view: { centerX: 0, centerY: 0, zoom: 1 },
          instances: [],
        };
      }
      const v = scene.getView();
      const instances = renderer.listInstances();

      // 收集 user_substances(V1 serialize.ts:51-60 直迁):
      // 扫所有 substance 实例的 ref → SubstanceRegistry → source='user' 的入文档
      // 用户在画板创建的 substance(combineSelectedToSubstance)随画板写盘
      let userSubstances: SubstanceDef[] | undefined;
      try {
        const api = requireCapabilityApi<ShapeLibraryApi>('shape-library');
        const userRefs = new Set<string>();
        for (const inst of instances) {
          if (inst.type === 'substance') userRefs.add(inst.ref);
        }
        const collected: SubstanceDef[] = [];
        for (const ref of userRefs) {
          const def = api.substances.get(ref);
          if (def && def.source === 'user') collected.push(def);
        }
        if (collected.length > 0) userSubstances = collected;
      } catch (e) {
        console.warn('[canvas-rendering/Host] user_substances collect failed', e);
      }

      return {
        schema_version: 3,
        view: { centerX: v.centerX, centerY: v.centerY, zoom: v.zoom },
        instances,
        user_substances: userSubstances,
      };
    }, []);

    const setViewport = useCallback((vp: Viewport): void => {
      sceneRef.current?.setView(vp.centerX, vp.centerY, vp.zoom);
      viewportDirtyRef.current = true;
    }, []);

    const fitToContent = useCallback((padding = 0.1): boolean => {
      const renderer = nodeRendererRef.current;
      if (!renderer) return false;
      const ok = renderer.fitAll(padding);
      if (ok) viewportDirtyRef.current = true;
      return ok;
    }, []);

    const zoomTo = useCallback((percent: number): void => {
      const scene = sceneRef.current;
      if (!scene) return;
      const v = scene.getView();
      const z = Math.max(10, Math.min(2000, percent)) / 100;
      scene.setView(v.centerX, v.centerY, z);
      viewportDirtyRef.current = true;
    }, []);

    const deleteSelected = useCallback((): void => {
      interactionRef.current?.deleteSelected();
    }, []);

    const clearSelection = useCallback((): void => {
      interactionRef.current?.clearSelection();
    }, []);

    const getInstance = useCallback((id: string): Instance | null => {
      return nodeRendererRef.current?.getInstance(id) ?? null;
    }, []);

    const getInstances = useCallback((): Instance[] => {
      return nodeRendererRef.current?.listInstances() ?? [];
    }, []);

    const enterAddMode = useCallback((spec: AddModeSpec): void => {
      interactionRef.current?.enterAddMode(spec);
    }, []);

    const exitAddMode = useCallback((): void => {
      interactionRef.current?.exitAddMode();
    }, []);

    const isAddMode = useCallback((): boolean => {
      return interactionRef.current?.isAddMode() ?? false;
    }, []);

    /**
     * 注入 canvas-text-node atomBridge — 文字节点真渲染依赖.
     * 类型用 Promise<unknown[]> 是因为 SerializerAtom 在 canvas-text-node 内部,
     * NodeRenderer 内 cast 成 Atom[](运行时 atom-bridge 返回的就是 SerializerAtom).
     */
    const setAtomBridge = useCallback(
      (fn: ((doc: unknown) => Promise<unknown[]>) | null): void => {
        const renderer = nodeRendererRef.current;
        if (!renderer) return;
        // SerializerAtom == AtomBridgeHook 输出 — cast 走 atom-serializers Atom 形态
        renderer.setAtomBridge(fn as Parameters<typeof renderer.setAtomBridge>[0]);
        // 注入后:重新渲染所有带 doc 的节点(让降级灰矩形升级为真 SVG mesh)。
        // L5-G6c 统一范式:文字层 = 带 doc 的 shape,不再特判 ref === 'krig.text.label'。
        const list = renderer.listInstances();
        for (const inst of list) {
          if (inst.doc !== undefined) renderer.update(inst);
        }
      },
      [],
    );

    /**
     * Inspector / view 端 patch Instance:浅合并 + 重渲染.
     * style_overrides 走深合并(fill/line/arrow 分别合并字段),否则 fill 改了 color
     * 会丢掉 type.
     */
    const combineSelected = useCallback(
      (params: { name: string; category: string; description: string }) => {
        const renderer = nodeRendererRef.current;
        const interaction = interactionRef.current;
        if (!renderer || !interaction) return null;
        const selectedIds = interaction.getSelection();
        if (selectedIds.length < 2) return null;
        const result = combineSelectedToSubstance(renderer, { selectedIds, ...params });
        if (!result) return null;
        // 替换选区为新 substance 实例
        interaction.setSelection([result.newInstanceId]);
        onInstancesChange?.(renderer.listInstances());
        return result;
      },
      [onInstancesChange],
    );

    const updateInstance = useCallback((id: string, patch: Partial<Instance>): void => {
      const renderer = nodeRendererRef.current;
      if (!renderer) return;
      const current = renderer.getInstance(id);
      if (!current) return;
      const next: Instance = {
        ...current,
        ...patch,
        // style_overrides 嵌套合并:fill / line / arrow 各自合并
        style_overrides: patch.style_overrides
          ? {
              fill: { ...current.style_overrides?.fill, ...patch.style_overrides.fill },
              line: { ...current.style_overrides?.line, ...patch.style_overrides.line },
              arrow: { ...current.style_overrides?.arrow, ...patch.style_overrides.arrow },
            }
          : current.style_overrides,
      };
      renderer.update(next);
      onInstancesChange?.(renderer.listInstances());
    }, [onInstancesChange]);

    /**
     * 选中节点的屏幕 AABB(容器内 CSS 像素).node-toolbar(L5-G5)用它把浮条
     * 贴到选中框正下方居中.单选 / 多选都取并集 AABB;无选中 / 拿不到 mesh 返 null.
     *
     * 走 SceneManager.projectMeshToScreenAABB(已处理旋转 OBB),view 在
     * onSelectionChange / onViewportChange 时拉一次重定位.
     */
    const getSelectedScreenAABB = useCallback((): {
      x: number;
      y: number;
      w: number;
      h: number;
    } | null => {
      const scene = sceneRef.current;
      const renderer = nodeRendererRef.current;
      const interaction = interactionRef.current;
      if (!scene || !renderer || !interaction) return null;
      const ids = interaction.getSelection();
      if (ids.length === 0) return null;
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const id of ids) {
        const rn = renderer.get(id);
        if (!rn) continue;
        const aabb = scene.projectMeshToScreenAABB(rn.group);
        minX = Math.min(minX, aabb.minX);
        minY = Math.min(minY, aabb.minY);
        maxX = Math.max(maxX, aabb.maxX);
        maxY = Math.max(maxY, aabb.maxY);
      }
      if (!Number.isFinite(minX)) return null;
      return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
    }, []);

    useImperativeHandle(
      ref,
      () => ({
        loadDocument,
        serialize,
        setViewport,
        fitToContent,
        zoomTo,
        deleteSelected,
        clearSelection,
        getInstance,
        getInstances,
        enterAddMode,
        exitAddMode,
        isAddMode,
        updateInstance,
        combineSelected,
        setAtomBridge,
        getSelectedScreenAABB,
      }),
      [
        loadDocument,
        serialize,
        setViewport,
        fitToContent,
        zoomTo,
        deleteSelected,
        clearSelection,
        getInstance,
        getInstances,
        enterAddMode,
        exitAddMode,
        isAddMode,
        updateInstance,
        combineSelected,
        setAtomBridge,
        getSelectedScreenAABB,
      ],
    );

    return <div ref={containerRef} className="krig-canvas-host" tabIndex={0} />;
  },
);
