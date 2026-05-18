/**
 * host/tools/HoverCoords — 鼠标悬停坐标提示(capability 内部子组件)
 *
 * 1:1 迁自 V1 `fullscreen/tools/HoverCoords.tsx`。**用 useTransformContext** 反算
 * 鼠标 SVG 像素 → 数学坐标,在最近曲线上找 y 值显示。
 *
 * 内部维护 hoverPoint state(运行时态,无外部回调)。
 */

import React, { useState, useCallback } from 'react';
import { useTransformContext, Point, Text } from 'mafs';

interface HoverCoordsProps {
  evalFns: Map<string, (x: number) => number>;
  fnColors: Map<string, string>;
  visibleFnIds: Set<string>;
}

export const HoverCoords: React.FC<HoverCoordsProps> = ({
  evalFns,
  fnColors,
  visibleFnIds,
}) => {
  const [hoverPoint, setHoverPoint] = useState<{ x: number; y: number; color: string } | null>(null);
  const { viewTransform } = useTransformContext();

  const handleMouseMove = useCallback((e: React.MouseEvent<SVGGElement>) => {
    const svg = (e.target as SVGElement).ownerSVGElement;
    if (!svg) return;

    const rect = svg.getBoundingClientRect();
    const svgX = e.clientX - rect.left;
    const svgY = e.clientY - rect.top;

    const scaleX = viewTransform[0];
    const scaleY = viewTransform[3];
    const tx = viewTransform[4];
    const ty = viewTransform[5];

    if (Math.abs(scaleX) < 1e-10) return;
    const mathX = (svgX - tx) / scaleX;
    const mathY = (svgY - ty) / scaleY;

    let bestY = NaN;
    let bestDist = Infinity;
    let bestColor = '#FF6B35';

    for (const [fnId, evalFn] of evalFns) {
      if (!visibleFnIds.has(fnId)) continue;
      const y = evalFn(mathX);
      if (!isFinite(y)) continue;
      const dist = Math.abs(y - mathY);
      if (dist < bestDist) {
        bestDist = dist;
        bestY = y;
        bestColor = fnColors.get(fnId) || '#FF6B35';
      }
    }

    const viewHeight = Math.abs(rect.height / scaleY);
    if (isFinite(bestY) && bestDist < viewHeight * 0.1) {
      setHoverPoint({ x: mathX, y: bestY, color: bestColor });
    } else {
      setHoverPoint(null);
    }
  }, [evalFns, fnColors, visibleFnIds, viewTransform]);

  const handleMouseLeave = useCallback(() => setHoverPoint(null), []);

  return (
    <>
      <g
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        style={{ pointerEvents: 'all' }}
      >
        <rect x={-1e6} y={-1e6} width={2e6} height={2e6} fill="transparent" />
      </g>
      {hoverPoint && (
        <>
          <Point x={hoverPoint.x} y={hoverPoint.y} color={hoverPoint.color} svgCircleProps={{ r: 4 }} />
          <Text
            x={hoverPoint.x}
            y={hoverPoint.y}
            attach="s"
            attachDistance={12}
            size={11}
            color={hoverPoint.color}
          >
            {`(${hoverPoint.x.toFixed(3)}, ${hoverPoint.y.toFixed(3)})`}
          </Text>
        </>
      )}
    </>
  );
};
