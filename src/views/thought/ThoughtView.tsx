/**
 * ThoughtView — V1 形态对齐(右槽伴随面板)
 *
 * 见 V1 src/plugins/thought/components/ThoughtView.tsx:
 *   - toolbar (💭 Thoughts {N} ×)
 *   - ThoughtPanel(纵向列卡片,按 anchor.locator.pos 排)
 *
 * source-aware:跟随 left slot 资源动态过滤
 *   left='note-view'  → source='note', resourceId=activeNoteId
 *   left='ebook-view' → source='book', resourceId=activeBookId
 *   其他 view         → 空(显空态)
 *
 * 跨槽通信:监听 bus.channels 'thought.activate' 切 activeId(Note ⌘⇧M / eBook
 * 高亮 / NavSide 等触发后高亮对应卡片)。
 */

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { workspaceManager } from '@workspace/workspace-state/workspace-manager';
import type { ThoughtSource } from '@capabilities/thought/types';
import { useThoughtsBySource } from './use-thoughts';
import { ThoughtPanel } from './ThoughtPanel';
import './thought.css';

interface ThoughtViewProps {
  workspaceId: string;
}

/** 从 workspace state 派生当前 left slot 的 thought source(V1 思路:跟随主视图)*/
function deriveSourceFromLeft(
  leftViewId: string | null,
  ws: ReturnType<typeof workspaceManager.get> | undefined,
): { source: ThoughtSource | null; resourceId: string | null } {
  if (!ws) return { source: null, resourceId: null };
  if (leftViewId === 'note-view') {
    const s = ws.pluginStates['note'] as { activeNoteId?: string } | undefined;
    return { source: 'note', resourceId: s?.activeNoteId ?? null };
  }
  if (leftViewId === 'ebook-view') {
    const s = ws.pluginStates['ebook'] as { activeBookId?: string } | undefined;
    return { source: 'book', resourceId: s?.activeBookId ?? null };
  }
  return { source: null, resourceId: null };
}

export function ThoughtView({ workspaceId }: ThoughtViewProps) {
  // 订阅 workspace 变化(left slot 切换 / activeNoteId 变 / activeBookId 变都重渲)
  const ws = useSyncExternalStore(
    (cb) => workspaceManager.subscribe(cb),
    () => workspaceManager.get(workspaceId),
  );

  const { source, resourceId } = useMemo(
    () => deriveSourceFromLeft(ws?.slotBinding.left ?? null, ws),
    [ws],
  );

  const thoughts = useThoughtsBySource(source, resourceId);

  // active thought id(跨槽 thought.activate 触发后高亮)
  const [activeId, setActiveId] = useState<string | null>(null);
  /**
   * push-pull 双向契约(memory feedback_module_push_pull_both):右槽 ThoughtView
   * 已 mount 后,新的右键"💭 加思考"/AI 命令仍要能切 activeId;若 emit 发生在
   * mount 前,subscribe 会错过 → getLastValue 兜底拉一次。
   *
   * emittedAt 去重:lastHandledAtRef 记录上次处理时间戳,防止 mount 时 getLastValue
   * 拿到老 emit 误重放(workspace 切换 / hot reload / SlotArea 重 mount 等场景)。
   */
  const lastHandledAtRef = useRef(0);
  useEffect(() => {
    const bus = workspaceManager.getBus(workspaceId);
    if (!bus) return;
    const handle = (payload: unknown): void => {
      const p = (payload ?? {}) as { thoughtId?: string; emittedAt?: number };
      if (typeof p.thoughtId !== 'string') return;
      const ts = typeof p.emittedAt === 'number' ? p.emittedAt : Date.now();
      if (ts <= lastHandledAtRef.current) return;
      lastHandledAtRef.current = ts;
      setActiveId(p.thoughtId);
    };
    // 1. last-known pull(若 emit 已在 mount 前发生)
    const last = bus.channels.getLastValue('thought.activate');
    if (last) handle(last);
    // 2. 后续 emit 走 subscribe
    const unsub = bus.channels.subscribe('thought.activate', handle);
    return unsub;
  }, [workspaceId]);

  const handleClose = (): void => {
    const bus = workspaceManager.getBus(workspaceId);
    bus?.slot.closeRight();
  };

  return (
    <div className="thought-view">
      <div className="thought-view__toolbar">
        <span className="thought-view__toolbar-title">💭 Thoughts</span>
        <span className="thought-view__toolbar-count">{thoughts.length}</span>
        <div style={{ flex: 1 }} />
        <button
          className="thought-view__close-btn"
          onClick={handleClose}
          title="关闭此面板"
        >
          ×
        </button>
      </div>
      <ThoughtPanel
        thoughts={thoughts}
        activeId={activeId}
        onActivate={setActiveId}
        source={source}
        resourceId={resourceId}
      />
    </div>
  );
}
