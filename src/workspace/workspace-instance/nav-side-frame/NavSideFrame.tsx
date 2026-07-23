/**
 * NavSideFrame — 左侧 NavSide 容器(式样)
 *
 * 按 charter § 1.4:式样在本组件,内容由 navSideRegistry 通过 NavSideBinding 渲染。
 *
 * 宽度按 viewId 独立记忆(navSideWidths: Record<string, number>),
 * 切 view 时自动恢复该 view 上次的宽度,互不干扰。
 *
 * L5-B3.8:加右侧 divider 可拖拽改宽
 */

import { useCallback, useRef } from 'react';
import { DEFAULT_NAVSIDE_WIDTH } from '../../workspace-state/default-state';
import { workspaceManager } from '../../workspace-state/workspace-manager';
import { NavSideBinding } from '@slot/frame-bindings/NavSideBinding';
import './nav-side-frame.css';

const MIN_WIDTH = 160;
const MAX_WIDTH = 600;

interface NavSideFrameProps {
  workspaceId: string;
  /** NavSide 宽度字典(按 viewId 独立记忆) */
  navSideWidths: Record<string, number>;
  /** 当前 view ID */
  viewId: string | null;
}

export function NavSideFrame({ workspaceId, navSideWidths, viewId }: NavSideFrameProps) {
  const w = (viewId != null ? (navSideWidths ?? {})[viewId] : undefined) ?? DEFAULT_NAVSIDE_WIDTH;

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
            if (pendingWidthRef.current != null && viewId != null) {
              const ws = workspaceManager.get(workspaceId);
              if (!ws) return;
              workspaceManager.update(workspaceId, {
                navSideWidths: { ...(ws.navSideWidths ?? {}), [viewId]: pendingWidthRef.current },
              });
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
        if (pendingWidthRef.current != null && viewId != null) {
          const ws = workspaceManager.get(workspaceId);
          if (ws) {
            workspaceManager.update(workspaceId, {
              navSideWidths: { ...ws.navSideWidths, [viewId]: pendingWidthRef.current },
            });
          }
          pendingWidthRef.current = null;
        }
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    },
    [w, workspaceId, viewId],
  );

  return (
    <div className="krig-nav-side-frame" style={{ width: w }}>
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
