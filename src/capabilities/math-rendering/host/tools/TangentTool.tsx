/**
 * host/tools/TangentTool — 切线渲染(capability 内部子组件)
 *
 * 1:1 迁自 V1 `src/plugins/note/blocks/math-visual/fullscreen/tools/TangentTool.tsx`,
 * **driver 0 接触 Mafs**:本组件挂在 MathHost 的 <Mafs> 内,driver 通过 overlays
 * props 传 TangentSpec[] 即可。
 */

import React from 'react';
import { Line, MovablePoint, Text } from 'mafs';
import type { TangentSpec } from '../../types';
import { derivative } from '../../compute/derivatives';

interface TangentToolProps {
  tangents: TangentSpec[];
  /** curveId → evalFn(由 MathHost 内部从 curves 提取 fnOfX 类型) */
  evalFns: Map<string, (x: number) => number>;
  /** curveId → fallback 颜色(spec.color 未设时取此值) */
  fnColors: Map<string, string>;
  /** 拖动切点 → 新 x 坐标(driver 写回 PM) */
  onMove?: (id: string, newX: number) => void;
}

export const TangentTool: React.FC<TangentToolProps> = ({
  tangents,
  evalFns,
  fnColors,
  onMove,
}) => {
  return (
    <>
      {tangents.map((tl) => {
        const fn = evalFns.get(tl.curveId);
        if (!fn) return null;

        const y = fn(tl.x);
        if (!isFinite(y)) return null;

        const slope = derivative(fn, tl.x);
        if (!isFinite(slope)) return null;

        const color = tl.color || fnColors.get(tl.curveId) || '#FF6B35';

        return (
          <React.Fragment key={tl.id}>
            <Line.PointSlope
              point={[tl.x, y]}
              slope={slope}
              color={color}
              style="dashed"
              opacity={0.7}
            />
            {!tl.fixed && onMove && (
              <MovablePoint
                point={[tl.x, y]}
                onMove={([newX]) => onMove(tl.id, newX)}
                color={color}
              />
            )}
            {tl.showSlope && (
              <Text
                x={tl.x}
                y={y + 0.5}
                attach="e"
                attachDistance={8}
                size={12}
                color={color}
              >
                {`k = ${slope.toFixed(3)}`}
              </Text>
            )}
          </React.Fragment>
        );
      })}
    </>
  );
};
