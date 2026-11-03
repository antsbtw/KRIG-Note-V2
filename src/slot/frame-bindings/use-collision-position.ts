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

/** 纯计算(便于单测):右溢左翻、下溢上翻;上翻时浮层底边贴 flipAnchorY */
export function computeCollisionPosition(
  size: { width: number; height: number },
  viewport: { width: number; height: number },
  anchorX: number,
  anchorY: number,
  margin: number,
  flipAnchorY: number,
): CollisionResult {
  let x = anchorX;
  let y = anchorY;

  // X 方向:右溢则翻转(浮层 right edge 贴近 anchor)
  if (anchorX + size.width + margin > viewport.width) {
    x = anchorX - size.width;
    if (x < margin) x = margin; // 翻后还溢左 → clamp
  }

  // Y 方向:下溢则翻转
  if (anchorY + size.height + margin > viewport.height) {
    y = flipAnchorY - size.height;
    if (y < margin) y = margin;
  }

  return { x, y };
}

/**
 * 边界外溢时翻转浮层位置。
 *
 * @param ref       浮层 DOM ref(用于测自身尺寸)
 * @param anchorX   光标 / 选区给的 x(默认 right 展开,即浮层 left = anchorX)
 * @param anchorY   光标 / 选区给的 y(默认 down 展开,即浮层 top = anchorY)
 * @param margin    浮层与 viewport 边的最小留白(默认 8px)
 * @param flipAnchorY 下溢上翻时浮层底边贴的 y(默认 = anchorY)。anchorY 是锚点行**下方**时
 *                  (slash 菜单),必须传该行顶边,否则上翻后浮层盖住锚点那一行
 */
export function useCollisionPosition(
  ref: RefObject<HTMLElement | null>,
  anchorX: number,
  anchorY: number,
  margin = 8,
  flipAnchorY: number = anchorY,
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

    // 计算位置(根据当前 popup rect 与 viewport 碰撞决定 anchor / flip)
    const compute = () => {
      const rect = el.getBoundingClientRect();
      setPos(computeCollisionPosition(
        { width: rect.width, height: rect.height },
        { width: window.innerWidth, height: window.innerHeight },
        anchorX, anchorY, margin, flipAnchorY,
      ));
    };

    compute();

    // popup 内部内容变化(slash 过滤项数 / 菜单展开)导致尺寸跳变时重算
    // 漏挂会让 effect 用首次 render 的 stale rect → flip 判断错误(过滤后视觉只 1 项但
    // 算的是过滤前 15 项的高度,误触发上翻)
    const observer = new ResizeObserver(compute);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, anchorX, anchorY, margin, flipAnchorY]);

  return pos;
}
