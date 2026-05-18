/**
 * host/tools/IntegralTool — 积分区域渲染 + 边界拖动(capability 内部子组件)
 *
 * 1:1 迁自 V1 `fullscreen/tools/IntegralTool.tsx`。100 步逼近函数曲线,
 * fillOpacity 0.2 + 描边 0.4 表示积分区域;两个 MovablePoint 控制 a/b 边界。
 *
 * 注:V1 IntegralPath 子组件用了 useTransformContext 但未使用 viewTransform —
 * 这里去除冗余 hook 调用。
 */

import React, { useMemo } from 'react';
import { MovablePoint, Text } from 'mafs';
import type { IntegralSpec } from '../../types';
import { integrate } from '../../compute/integrate';

interface IntegralToolProps {
  integrals: IntegralSpec[];
  evalFns: Map<string, (x: number) => number>;
  fnColors: Map<string, string>;
  onMove?: (id: string, key: 'a' | 'b', newX: number) => void;
}

/** 生成积分区域的 SVG path(函数曲线下方面积) */
function IntegralPath({
  fn, a, b, color,
}: {
  fn: (x: number) => number; a: number; b: number; color: string;
}) {
  const pathD = useMemo(() => {
    const steps = 100;
    const h = (b - a) / steps;
    const pts: string[] = [];
    pts.push(`M ${a} 0`);
    for (let i = 0; i <= steps; i++) {
      const x = a + i * h;
      const y = fn(x);
      if (isFinite(y)) pts.push(`L ${x} ${y}`);
    }
    pts.push(`L ${b} 0`);
    pts.push('Z');
    return pts.join(' ');
  }, [fn, a, b]);

  return (
    <path
      d={pathD}
      fill={color}
      fillOpacity={0.2}
      stroke={color}
      strokeWidth={1}
      strokeOpacity={0.4}
    />
  );
}

export const IntegralTool: React.FC<IntegralToolProps> = ({
  integrals,
  evalFns,
  fnColors,
  onMove,
}) => {
  return (
    <>
      {integrals.map((region) => {
        const fn = evalFns.get(region.curveId);
        if (!fn) return null;

        const color = region.color || fnColors.get(region.curveId) || '#2D7FF9';
        const a = Math.min(region.a, region.b);
        const b = Math.max(region.a, region.b);

        const area = integrate(fn, a, b);

        return (
          <React.Fragment key={region.id}>
            <IntegralPath fn={fn} a={a} b={b} color={color} />
            {onMove && (
              <>
                <MovablePoint
                  point={[region.a, 0]}
                  onMove={([newX]) => onMove(region.id, 'a', newX)}
                  color={color}
                />
                <MovablePoint
                  point={[region.b, 0]}
                  onMove={([newX]) => onMove(region.id, 'b', newX)}
                  color={color}
                />
              </>
            )}
            {region.showValue && isFinite(area) && (
              <Text
                x={(a + b) / 2}
                y={fn((a + b) / 2) / 2}
                size={13}
                color={color}
              >
                {`S = ${area.toFixed(4)}`}
              </Text>
            )}
          </React.Fragment>
        );
      })}
    </>
  );
};
