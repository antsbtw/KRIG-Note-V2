/**
 * MindCanvas — diglot mind v0 渲染器
 *
 * ⭐⭐ **这里才是「拖了节点,文本跟着变」真正发生的地方。**
 *
 * 数据流(单向,一圈闭合):
 * ```
 * mind 文件 ──fileToSnapshot──→ {S, G}
 *                                 │
 *                    buildLayoutRequest → ELK(mrtree)
 *                                 │
 *                    projectToInstances(稀疏覆盖全量)
 *                                 ↓
 *                          CanvasHost 渲染
 *                                 ↓
 *                    用户拖动 → onInstancesChange
 *                                 ↓
 *                    ⭐ applyAction(canvas.dragNode) —— 落 G 层一条
 *                                 ↓
 *                    snapshotToFile → library.save
 * ```
 *
 * ⚠️ **不复用 GraphCanvasView**:那个 view 的真源是 `CanvasDocument`
 * (instances 就是本体),而 mind 的真源是 `{S, G}`,instances 是**派生物**。
 * 混在一起会让「谁是真源」变得含糊 —— 那正是双向同步最容易塌的地方。
 *
 * ⚠️ v0 只做**拖动钉坐标**这一条路径(三义中的落点①)。
 * 改父/转自由主题需要落点判定(01 §7.2),留下一步。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import type {
  CanvasHostHandle,
  CanvasRenderingApi,
  CanvasDocument,
  Instance,
} from '@capabilities/canvas-rendering/types';
import type { GraphLibraryStoreApi } from '@capabilities/graph-library-store/types';
import type { GraphLayoutApi } from '@capabilities/graph-layout/types';
import type { DiglotModelApi } from '@capabilities/diglot-model/types';
import type { DiglotSnapshot } from '@capabilities/diglot-model/engine-contract';

const SAVE_DEBOUNCE_MS = 1000;

export interface MindCanvasProps {
  readonly workspaceId: string;
  readonly graphId: string;
}

/** 派生物 → CanvasDocument(画布吃的形态)。 */
function toCanvasDocument(instances: Instance[], view: CanvasDocument['view']): CanvasDocument {
  return { schema_version: 3, view, instances };
}

export function MindCanvas({ workspaceId, graphId }: MindCanvasProps): ReactElement {
  const { Host } = useMemo(
    () => requireCapabilityApi<CanvasRenderingApi>('canvas-rendering'),
    [],
  );
  const library = useMemo(
    () => requireCapabilityApi<GraphLibraryStoreApi>('graph-library-store'),
    [],
  );
  const layoutApi = useMemo(() => requireCapabilityApi<GraphLayoutApi>('graph-layout'), []);
  /**
   * ⚠️ view 不直接 import capability 运行时值(W5 设计 §5,eslint 守着) ——
   * 走 requireCapabilityApi 间接路由;类型走 import type from .../types。
   */
  const diglot = useMemo(() => requireCapabilityApi<DiglotModelApi>('diglot-model'), []);

  const hostRef = useRef<CanvasHostHandle | null>(null);
  /** ⭐ 真源:{S, G}。instances 是派生物,**绝不反过来当真源**。 */
  const snapRef = useRef<DiglotSnapshot | null>(null);
  const titleRef = useRef<string>('');
  const loadedIdRef = useRef<string | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [error, setError] = useState<string | null>(null);

  // ── 保存(防抖)──
  const flushSave = useCallback((): void => {
    if (saveTimerRef.current !== null) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    const snap = snapRef.current;
    // ⚠️ 未 load 完不写盘(防止空模型擦掉真数据 —— 对齐 GraphCanvasView 的既有防御)
    if (!snap || loadedIdRef.current !== graphId) return;
    const file = diglot.snapshotToFile(snap) as { semantic: string; graphic: string };
    void library.mindSave(graphId, file.semantic, file.graphic, titleRef.current);
  }, [library, graphId, diglot]);

  const scheduleSave = useCallback((): void => {
    if (saveTimerRef.current !== null) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null;
      flushSave();
    }, SAVE_DEBOUNCE_MS);
  }, [flushSave]);

  /** {S,G} → 布局 → instances → 推给画布。 */
  const render = useCallback(
    async (snap: DiglotSnapshot): Promise<void> => {
      const host = hostRef.current;
      if (!host) return;
      const req = diglot.buildLayoutRequest(snap.s, snap.g);
      // ⭐ mrtree = graph-layout 文档里写明的 "Mind map 默认"
      const result = await layoutApi.computeLayout(req, {
        algorithm: 'mrtree',
        direction: 'RIGHT',
        spacing: { node: 24, layer: 60 },
      });
      const instances = diglot.projectToInstances(snap.s, snap.g, result) as unknown as Instance[];
      host.loadDocument(toCanvasDocument(instances, { centerX: 0, centerY: 0, zoom: 1 }));
      host.fitToContent(40);
    },
    [layoutApi, diglot],
  );

  // ── 加载 ──
  useEffect(() => {
    loadedIdRef.current = null;
    snapRef.current = null;
    setError(null);
    let cancelled = false;

    void library
      .mindLoad(graphId)
      .then((record) => {
        if (cancelled || !record) return;
        // ⭐ B1:两段纯文本直接从 mind_doc 读出来,不经 doc_content 那层拆解
        const parsed = diglot.fileToSnapshot({
          format: 'diglot-mind/v0',
          semantic: record.semantic,
          graphic: record.graphic,
        });
        if (!parsed.ok) {
          // ⭐ 坏档 fail loud:显示错误,**不加载也不保存**,保住磁盘上的原文
          setError(
            `导图文件解析失败(已保护原文件,不会覆盖):\n` +
              parsed.errors.map((e) => `  第 ${e.line} 行:${e.message}`).join('\n'),
          );
          return;
        }
        titleRef.current = record.title;
        snapRef.current = parsed.value;
        loadedIdRef.current = graphId;
        void render(parsed.value);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(`加载失败:${String(err)}`);
      });

    return () => {
      cancelled = true;
      // ⚠️ 卸载前 flush,别把最后一次拖动丢了
      flushSave();
    };
  }, [graphId, library, render, flushSave]);

  // ── ⭐⭐ 画布拖动 → 落 G 层 ──
  const handleInstancesChange = useCallback(
    (instances: Instance[]): void => {
      const snap = snapRef.current;
      if (!snap || loadedIdRef.current !== graphId) return;

      // ⭐ 找出位置与当前投影不一致的节点 → 每个发一条 dragNode action。
      //   ⚠️ 这里**只发 action**,模型由 applyAction 改 —— 与断言同一条路径。
      let next = snap;
      let changed = false;
      for (const inst of instances) {
        const node = snap.s.nodes.find((n) => n.id === inst.id);
        if (!node || !inst.position) continue;
        const cur = snap.g.get(inst.id)?.pos;
        const x = Math.round(inst.position.x);
        const y = Math.round(inst.position.y);
        if (cur && cur.x === x && cur.y === y) continue;
        next = diglot.applyAction(next, { kind: 'canvas.dragNode', id: inst.id, x, y });
        changed = true;
      }
      if (!changed) return;
      snapRef.current = next;
      scheduleSave();
    },
    [graphId, scheduleSave, diglot],
  );

  // ── 常驻 timer 必须有停止调用(铁律)──
  useEffect(
    () => () => {
      if (saveTimerRef.current !== null) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
    },
    [],
  );

  if (error) {
    return (
      <div style={{ padding: 24, color: '#c0392b', whiteSpace: 'pre-wrap', fontSize: 13 }}>
        {error}
      </div>
    );
  }

  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <Host
        ref={hostRef}
        workspaceId={workspaceId}
        onInstancesChange={handleInstancesChange}
      />
    </div>
  );
}
