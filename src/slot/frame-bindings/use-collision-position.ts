/**
 * useCollisionPosition — 浮层位置 viewport 边界碰撞检测
 *
 * 设计取舍(用户拍板 Q1=A / Q2=A / Q3=A / Q4=A):
 * - **边界**:viewport(window.innerWidth × window.innerHeight)— 浮层用 position: fixed,
 *   语义上属于 viewport 上下文。Workspace 隔离由"哪个 ContextMenuFrame mount 了 binding"保证。
 * - **策略**:flip(右溢则左展开,下溢则上展开)— 经典做法,V1 也这么做。
 * - **共用**:4 大 menu binding(ContextMenu / Slash / Handle / FloatingToolbar)共享此 hook,
 *   将来 Submenu / Tooltip 也用。
 * - **测量时机**:useLayoutEffect — React 18+ 在 commit 后 / paint 前测,无闪烁。
 *
 * 用法:
 *   const ref = useRef<HTMLDivElement>(null);
 *   const { x, y } = useCollisionPosition(ref, anchorX, anchorY);
 *   <div ref={ref} style={{ left: x, top: y, position: 'fixed' }}>...</div>
 *
 * L4 阶段不实测(Registry 0 命中,浮层不弹)— 由 L5 第一个真菜单实测。
 */

import { useLayoutEffect, useState, RefObject } from 'react';

interface CollisionResult {
  x: number;
  y: number;
}

/**
 * 边界外溢时翻转浮层位置。
 *
 * @param ref       浮层 DOM ref(用于测自身尺寸)
 * @param anchorX   光标 / 选区给的 x(默认 right 展开,即浮层 left = anchorX)
 * @param anchorY   光标 / 选区给的 y(默认 down 展开,即浮层 top = anchorY)
 * @param margin    浮层与 viewport 边的最小留白(默认 8px)
 */
export function useCollisionPosition(
  ref: RefObject<HTMLElement | null>,
  anchorX: number,
  anchorY: number,
  margin = 8,
): CollisionResult {
  // 初值 = anchor;effect 测量后必要时再改
  const [pos, setPos] = useState<CollisionResult>({ x: anchorX, y: anchorY });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) {
      // 没 mount,至少同步 anchor(切菜单 anchor 跳变时不留旧值)
      setPos({ x: anchorX, y: anchorY });
      return;
    }

    const rect = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let nextX = anchorX;
    let nextY = anchorY;

    // X 方向:右溢则翻转(浮层 right edge 贴近 anchor)
    if (anchorX + rect.width + margin > vw) {
      nextX = anchorX - rect.width;
      if (nextX < margin) nextX = margin; // 翻后还溢左 → clamp
    }

    // Y 方向:下溢则翻转
    if (anchorY + rect.height + margin > vh) {
      nextY = anchorY - rect.height;
      if (nextY < margin) nextY = margin;
    }

    setPos({ x: nextX, y: nextY });
  }, [ref, anchorX, anchorY, margin]);

  return pos;
}
