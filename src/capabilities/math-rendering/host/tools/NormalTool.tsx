/**
 * host/tools/NormalTool — 法线渲染(capability 内部子组件)
 *
 * 1:1 迁自 V1 `fullscreen/tools/NormalTool.tsx`。法线斜率 = -1/切线斜率;
 * 切线接近水平时(|f'(x)| < 1e-10)用 ±1e10 近似垂直线。
 */

import React from 'react';
import { Line, MovablePoint, Text } from 'mafs';
import type { NormalSpec } from '../../types';
import { derivative } from '../../compute/derivatives';

interface NormalToolProps {
  normals: NormalSpec[];
  evalFns: Map<string, (x: number) => number>;
  fnColors: Map<string, string>;
  onMove?: (id: string, newX: number) => void;
}

export const NormalTool: React.FC<NormalToolProps> = ({
  normals,
  evalFns,
  fnColors,
  onMove,
}) => {
  return (
    <>
      {normals.map((nl) => {
        const fn = evalFns.get(nl.curveId);
        if (!fn) return null;

        const y = fn(nl.x);
        if (!isFinite(y)) return null;

        const tangentSlope = derivative(fn, nl.x);
        if (!isFinite(tangentSlope)) return null;

        const normalSlope = Math.abs(tangentSlope) < 1e-10
          ? 1e10 * (tangentSlope >= 0 ? -1 : 1)
          : -1 / tangentSlope;

        const color = nl.color || fnColors.get(nl.curveId) || '#00D4AA';

        return (
          <React.Fragment key={nl.id}>
            <Line.PointSlope
              point={[nl.x, y]}
              slope={normalSlope}
              color={color}
              style="dashed"
              opacity={0.7}
            />
            {!nl.fixed && onMove && (
              <MovablePoint
                point={[nl.x, y]}
                onMove={([newX]) => onMove(nl.id, newX)}
                color={color}
              />
            )}
            {nl.showSlope && (
              <Text
                x={nl.x}
                y={y - 0.5}
                attach="w"
                attachDistance={8}
                size={12}
                color={color}
              >
                {`k⊥ = ${normalSlope.toFixed(3)}`}
              </Text>
            )}
          </React.Fragment>
        );
      })}
    </>
  );
};
