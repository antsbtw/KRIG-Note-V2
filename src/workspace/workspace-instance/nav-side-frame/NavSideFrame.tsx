/**
 * NavSideFrame — 左侧 NavSide 容器(式样)
 *
 * 按 charter § 1.4:式样在本组件,内容由 navSideRegistry 通过 NavSideBinding 渲染。
 *
 * V1 vs V2:
 * - V1 NavSide 是 Shell 全局 WebContentsView,resize 走主进程 IPC(NAVSIDE_RESIZE_*)
 * - V2 NavSide 是每个 Workspace 自带的 React 组件 — resize 走纯 React mouse 事件,
 *   宽度持久化到 workspaceState.navSideWidth(per-ws)
 *
 * L5-B3.8:加右侧 divider 可拖拽改宽
 */

import { useCallback, useRef } from 'react';
import { DEFAULT_NAVSIDE_WIDTH } from '../../workspace-state/default-state';
import { workspaceManager } from '../../workspace-state/workspace-manager';
import { NavSideBinding } from '@slot/frame-bindings/NavSideBinding';
import { ViewSwitcherFrame } from '../view-switcher-frame/ViewSwitcherFrame';
import './nav-side-frame.css';

const MIN_WIDTH = 160;
const MAX_WIDTH = 600;

interface NavSideFrameProps {
  /** Workspace ID(给 ViewSwitcher 切 view 用)*/
  workspaceId: string;
  /** NavSide 宽度(null = 默认 224px)*/
  width: number | null;
  /** 当前 view ID(用于按 view 取 NavSide 内容 + 高亮 ViewSwitcher tab)*/
  viewId: string | null;
}

export function NavSideFrame({ workspaceId, width, viewId }: NavSideFrameProps) {
  const w = width ?? DEFAULT_NAVSIDE_WIDTH;

  // ── divider 拖拽 ──
  // mousedown 进入拖拽态;mousemove 实时改 width(throttle 由 requestAnimationFrame 保护);
  // mouseup 落库 + 移除 listener。拖拽期间 body class 改光标 / 禁文本选中。
  const startXRef = useRef(0);
  const startWidthRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const pendingWidthRef = useRef<number | null>(null);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      startXRef.current = e.clientX;
      startWidthRef.current = w;

      document.body.classList.add('krig-navside-resizing');

      const onMove = (ev: MouseEvent) => {
        const delta = ev.clientX - startXRef.current;
        const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidthRef.current + delta));
        pendingWidthRef.current = next;
        if (rafRef.current == null) {
          rafRef.current = requestAnimationFrame(() => {
            rafRef.current = null;
            if (pendingWidthRef.current != null) {
              workspaceManager.update(workspaceId, { navSideWidth: pendingWidthRef.current });
            }
          });
        }
      };

      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.body.classList.remove('krig-navside-resizing');
        if (rafRef.current != null) {
          cancelAnimationFrame(rafRef.current);
          rafRef.current = null;
        }
        if (pendingWidthRef.current != null) {
          workspaceManager.update(workspaceId, { navSideWidth: pendingWidthRef.current });
          pendingWidthRef.current = null;
        }
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    },
    [w, workspaceId],
  );

  return (
    <div className="krig-nav-side-frame" style={{ width: w }}>
      <ViewSwitcherFrame workspaceId={workspaceId} activeViewId={viewId} />
      <NavSideBinding viewId={viewId} />
      <div
        className="krig-nav-side-frame__divider"
        onMouseDown={handleMouseDown}
        title="拖拽调整 NavSide 宽度"
        aria-label="resize navside"
        role="separator"
      />
    </div>
  );
}
