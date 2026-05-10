/**
 * GraphCanvasView — view 主组件(L5-G1 占位)
 *
 * G1 范围:仅展示当前 activeGraphId 的占位状态。Three.js 渲染管线 / 节点 /
 * 交互 / 浮层全部留 G3 + G4 段(三层架构 — view 是声明,实现在 capability)。
 *
 * 启动恢复:wsState.activeGraphId 通过 pluginStates 自动持久化(D-2=A);
 * mount 时直接读 — 不需要 IPC 拉(决策 G1-8)。
 *
 * LOC 红线(v0.2 plan § 3.1):≤ 150~200 行。本组件 ~80 行,远低于红线。
 */

import { useSyncExternalStore } from 'react';
import { workspaceManager } from '@workspace/workspace-state/workspace-manager';
import { getGraphCanvasWsState } from './data-model';
import { GraphCanvasToolbar } from './GraphCanvasToolbar';
import './graph-canvas-view.css';

interface GraphCanvasViewProps {
  workspaceId: string;
  payload?: unknown;
}

export function GraphCanvasView({ workspaceId }: GraphCanvasViewProps) {
  // G1:view 主体仅展示当前 activeGraphId 的占位状态;graph-library-store
  // 由 NavSide 内部消费(CanvasListPanel 直接 requireCapabilityApi)+ Toolbar 拉 title。
  // install: ['graph-library-store'] 由 register-view 时声明,与 view 主体是否
  // 直接调 requireCapabilityApi 无关(install-coverage 自检读的是 viewDefinition.install)。
  // G3 接 canvas-rendering Host 时,view 主体才需要拿 capability ref。

  const wsState = useSyncExternalStore(
    (cb) => workspaceManager.subscribe(cb),
    () => {
      const ws = workspaceManager.get(workspaceId);
      return ws ? getGraphCanvasWsState(ws) : null;
    },
  );
  const activeGraphId = wsState?.activeGraphId ?? null;

  return (
    <div className="krig-graph-canvas-view">
      <GraphCanvasToolbar activeGraphId={activeGraphId} />
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
          <div className="krig-graph-canvas-view__placeholder">
            <div className="krig-graph-canvas-view__placeholder-title">
              画板加载中(Three.js 渲染留 G3 段)
            </div>
            <div className="krig-graph-canvas-view__placeholder-hint">
              activeGraphId: <code>{activeGraphId}</code>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
